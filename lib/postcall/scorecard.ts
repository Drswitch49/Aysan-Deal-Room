/**
 * Post-call scorecard engine — applies the spec's rules to Claude's output.
 *
 * Claude extracts fields and gives a first read on each gate. Everything the
 * spec states as a rule is enforced here, deterministically, so a prompt slip
 * can never loosen it:
 *
 *  - Source required: a field whose source doesn't resolve to a line of the
 *    input, a timestamp that appears in it, or the supplied pre-call brief is
 *    forced to unknown with a null value.
 *  - Gates: a gate can't pass without its inputs or with its Playbook threshold
 *    unset; numeric thresholds are checked here and can only escalate to fail.
 *    Founder dependency goes to Price, not Kill, where a manager is installable.
 *  - Verdict: any gate at fail is Kill. A score never overrides a kill.
 *  - Completeness, info request, LOI flag and the broker email are derived,
 *    and the email may not carry £, percentages or structure before the DSCR
 *    sanction.
 */
import { z } from "zod";
import {
  FIELD_BOXES, FIELD_STATUSES, GATE_RESULTS, GATES, POSTCALL_FIELDS, FIELD_KEYS,
  type FieldBox, type GateResult, type PlaybookConfig, type Scorecard,
  type ScorecardField, type ScorecardGate, type Verdict,
} from "../../src/lib/acp/postcallSpec.js";

// ─── What Claude must return (strict: nothing outside the schema) ──────────
const claudeFieldSchema = z
  .object({
    value: z.unknown(),
    status: z.enum(FIELD_STATUSES),
    source: z.string().nullable(),
    box: z.enum(FIELD_BOXES),
    next_action: z.string().nullable(),
  })
  .strict();

export const claudeScorecardSchema = z
  .object({
    fields: z.object(Object.fromEntries(FIELD_KEYS.map((k) => [k, claudeFieldSchema.optional()]))).strict(),
    gates: z.array(z.object({ id: z.number().int().min(1).max(8), result: z.enum(GATE_RESULTS) }).strict()),
  })
  .strict();
export type ClaudeScorecard = z.infer<typeof claudeScorecardSchema>;

// ─── Input numbering (what sources cite) ───────────────────────────────────
/** Prefix each line with `L<n>:` so Claude can cite note lines exactly. */
export function numberLines(text: string): { numbered: string; lineCount: number } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return { numbered: lines.map((l, i) => `L${i + 1}: ${l}`).join("\n"), lineCount: lines.length };
}

const LINE_REF = /^L(\d+)(?:\s*[-–]\s*L?(\d+))?$/i;
const TIMESTAMP_REF = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?$/;
const BRIEF_REF = /^brief:\S+/i;

/** True when every reference in `source` resolves against the run's inputs. */
export function sourceResolves(
  source: string | null | undefined,
  ctx: { inputText: string; lineCount: number; hasBrief: boolean },
): boolean {
  if (!source || !source.trim()) return false;
  const refs = source.split(/[,;]|\s+and\s+/i).map((r) => r.trim()).filter(Boolean);
  if (!refs.length) return false;
  return refs.every((ref) => {
    const line = LINE_REF.exec(ref);
    if (line) {
      const a = Number(line[1]);
      const b = line[2] ? Number(line[2]) : a;
      return a >= 1 && b >= a && b <= ctx.lineCount;
    }
    const ts = TIMESTAMP_REF.exec(ref);
    if (ts) return ctx.inputText.includes(ts[1]);
    if (BRIEF_REF.test(ref)) return ctx.hasBrief;
    return false;
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[£,\s%]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const known = (f: ScorecardField | undefined) => Boolean(f && f.status !== "unknown");

/** Numeric value of a known field, else null. */
function knownNum(fields: Record<string, ScorecardField>, key: string): number | null {
  const f = fields[key];
  return known(f) ? num(f.value) : null;
}

/**
 * Figures and structure that may not reach a broker before the DSCR sanction:
 * currency, percentages, money shorthand and deal-structure terms.
 */
const FIGURES_OR_STRUCTURE =
  /[£$€%]|\bper\s?cent\b|\bGBP\b|\b\d[\d,.]*\s*(?:k|m|bn|x)\b|\b(?:earn[\s-]?outs?|vendor loans?|loan notes?|VLN|deferred consideration|deferred payment|multiples?|enterprise value|valuation|cash at (?:close|completion)|leverage|DSCR|debt service|senior debt|equity split|price|offer)\b/i;

export function containsFiguresOrStructure(text: string): boolean {
  return FIGURES_OR_STRUCTURE.test(text);
}

// ─── Engine ────────────────────────────────────────────────────────────────
export interface EngineInput {
  dealId: string;
  companyName: string;
  recipientName?: string | null;
  raw: ClaudeScorecard;
  config: PlaybookConfig;
  institutionalBandPct: number | null;
  inputKind: "transcript" | "notes";
  inputText: string;
  precallBriefId: string | null;
  dscrSanctioned: boolean;
}

export function buildScorecard(input: EngineInput): Scorecard {
  const { lineCount } = numberLines(input.inputText);
  const srcCtx = { inputText: input.inputText, lineCount, hasBrief: Boolean(input.precallBriefId) };
  const fieldAdjustments: Scorecard["field_adjustments"] = [];

  // 1. Fields — every catalogue field present; no source means no value.
  const fields: Record<string, ScorecardField> = {};
  for (const def of POSTCALL_FIELDS) {
    const r = input.raw.fields[def.key];
    const f: ScorecardField = r
      ? { value: r.value ?? null, status: r.status, source: r.source?.trim() || null, box: r.box, next_action: r.next_action?.trim() || null }
      : { value: null, status: "unknown", source: null, box: "none", next_action: null };
    if (!r) fieldAdjustments.push({ field: def.key, code: "not_returned" });

    if (f.status !== "unknown" && !sourceResolves(f.source, srcCtx)) {
      fieldAdjustments.push({ field: def.key, code: f.source ? "source_unresolved" : "source_missing" });
      f.status = "unknown";
    }
    if (f.status !== "unknown" && (f.value === null || f.value === undefined || f.value === "")) {
      fieldAdjustments.push({ field: def.key, code: "value_missing" });
      f.status = "unknown";
    }
    if (f.status === "unknown") {
      f.value = null;
      if (!f.next_action) f.next_action = def.question;
    }
    fields[def.key] = f;
  }

  // 2. Gates — Claude's read, then the rules, in spec order.
  const cfg = input.config;
  const inst = input.institutionalBandPct;
  const gates: ScorecardGate[] = GATES.map((def) => {
    const claude: GateResult = input.raw.gates.find((g) => g.id === def.id)?.result ?? "unknown";
    let result = claude;
    const adjustments: string[] = [];
    const set = (next: GateResult, code: string) => {
      if (next !== result) {
        result = next;
        adjustments.push(code);
      }
    };

    // A gate can't pass (or pass on the seller's word) without its inputs.
    if ((result === "pass" || result === "vendor") && !def.passNeeds.every((group) => group.some((k) => known(fields[k])))) {
      set("unknown", "inputs_unknown");
    }

    // Numeric threshold checks. Unset thresholds block a pass; a breach fails.
    if (def.id === 2) {
      if (cfg.recurring_gate_pct == null && (result === "pass" || result === "vendor")) set("unknown", "threshold_unset");
      const c = knownNum(fields, "rev_contracted_gbp"), s = knownNum(fields, "rev_scheduled_gbp"), o = knownNum(fields, "rev_oneoff_gbp");
      if (cfg.recurring_gate_pct != null && c != null && s != null && o != null && c + s + o > 0) {
        if (((c + s) / (c + s + o)) * 100 < cfg.recurring_gate_pct) set("fail", "below_recurring_gate");
      }
      const b2b = knownNum(fields, "b2b_share");
      if (b2b != null && b2b < 50) set("fail", "mainly_b2c");
    }
    if (def.id === 3) {
      if ((cfg.ebitda_band_min_gbp == null || cfg.ebitda_band_max_gbp == null) && (result === "pass" || result === "vendor")) set("unknown", "threshold_unset");
      const m = knownNum(fields, "maintainable_ebitda_gbp");
      if (m != null && m <= 0) set("fail", "loss_making");
      else if (m != null && cfg.ebitda_band_min_gbp != null && m < cfg.ebitda_band_min_gbp) set("fail", "below_ebitda_band");
      else if (m != null && cfg.ebitda_band_max_gbp != null && m > cfg.ebitda_band_max_gbp) set("fail", "above_ebitda_band");
    }
    if (def.id === 4) {
      const bandsSet = cfg.concentration_largest_pct != null && cfg.concentration_top3_pct != null;
      if (!bandsSet && inst == null && (result === "pass" || result === "vendor")) set("unknown", "threshold_unset");
      const largest = knownNum(fields, "largest_pct"), top3 = knownNum(fields, "top3_pct");
      // A breach is only knowable once the Playbook bands are set.
      if (bandsSet && largest != null && top3 != null) {
        const withinBands = largest <= cfg.concentration_largest_pct! && top3 <= cfg.concentration_top3_pct!;
        const withinInstitutional = inst != null && largest <= inst;
        if (!withinBands && !withinInstitutional) set("fail", "above_concentration_bands");
      }
    }
    if (def.id === 5) {
      if (cfg.manager_install_days == null && (result === "pass" || result === "vendor")) set("unknown", "threshold_unset");
      // Founder dependency is priced, not killed, where a manager is installable.
      if (result === "fail" && known(fields.manager_installable_90d) && fields.manager_installable_90d.value === true) {
        set("pass", "founder_dependency_priced");
        for (const k of ["key_persons", "second_tier_manager", "breaks_in_90_days"]) {
          if (known(fields[k]) && fields[k].box !== "price") {
            fields[k].box = "price";
            fieldAdjustments.push({ field: k, code: "founder_dependency_priced" });
          }
        }
      }
    }
    if (def.id === 8) {
      const confirmed = def.inputs.some((k) => known(fields[k]) && fields[k].value === true);
      if (confirmed) set("fail", "hard_kill_confirmed");
    }

    return { id: def.id, name: def.name, result, claude_result: claude, adjustments };
  });

  // 3. Verdict — gates decide; any fail is Kill.
  const killGates = gates.filter((g) => g.result === "fail").map((g) => g.id);
  const boxes = new Set<FieldBox>(Object.values(fields).map((f) => f.box));
  const verdict: Verdict = killGates.length
    ? "Kill"
    : boxes.has("price")
      ? "Price"
      : boxes.has("condition")
        ? "Condition"
        : "Proceed to info request";

  // 4. Completeness + info request.
  const required = POSTCALL_FIELDS.length;
  const knownCount = POSTCALL_FIELDS.filter((d) => known(fields[d.key])).length;
  const infoRequest = POSTCALL_FIELDS
    .filter((d) => fields[d.key].status === "unknown")
    .map((d) => ({ field: d.key, question: fields[d.key].next_action ?? d.question }));

  // 5. LOI flag — false until the DSCR sanction; debtors missing also blocks.
  const loiBlockers: Scorecard["loi_blockers"] = [];
  if (!input.dscrSanctioned) loiBlockers.push("dscr_sanction_missing");
  if (verdict === "Kill") loiBlockers.push("verdict_kill");
  if (!known(fields.debtors_aged)) loiBlockers.push("debtors_missing");

  // 6. Broker email — the info request, minus anything carrying figures or
  //    structure until the DSCR is sanctioned.
  const figuresAllowed = input.dscrSanctioned;
  const emailQuestions = infoRequest.map((q) => q.question).filter((q) => figuresAllowed || !containsFiguresOrStructure(q));
  const withheld = infoRequest.length - emailQuestions.length;

  return {
    spec: "acp-postcall-v1",
    deal_id: input.dealId,
    playbook_version: cfg.version,
    playbook: cfg,
    institutional_band_pct: inst,
    input_kind: input.inputKind,
    precall_brief_id: input.precallBriefId,
    verdict,
    kill_gates: killGates,
    gates,
    fields,
    completeness: { known: knownCount, required, pct: Math.round((knownCount / required) * 100) },
    info_request: infoRequest,
    loi_ready: loiBlockers.length === 0,
    loi_blockers: loiBlockers,
    earnout_flag: known(fields.earnout_ask) && fields.earnout_ask.value === true,
    broker_email: {
      ...brokerEmail(input.companyName, input.recipientName, emailQuestions, figuresAllowed),
      figures_allowed: figuresAllowed,
      withheld,
    },
    field_adjustments: fieldAdjustments,
  };
}

function brokerEmail(company: string, recipient: string | null | undefined, questions: string[], figuresAllowed: boolean) {
  const subject = `${company}: follow-up questions from our call`;
  const greeting = `Dear ${recipient?.trim() || "all"},`;
  const list = questions.length
    ? questions.map((q, i) => `${i + 1}. ${q}`).join("\n")
    : "We have what we need for now and will be in touch shortly with next steps.";
  const body = [
    greeting,
    "",
    "Thank you for your time on the call. To help us progress our review, could you come back to us on the following:",
    "",
    list,
    "",
    "Documents can be shared in whatever form is easiest.",
    "",
    "Kind regards,",
  ].join("\n");
  // Belt and braces: the template itself must never carry a figure pre-sanction.
  if (!figuresAllowed && containsFiguresOrStructure(subject)) {
    return { subject: "Follow-up questions from our call", body };
  }
  return { subject, body };
}
