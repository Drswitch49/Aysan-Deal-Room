/**
 * Deal Intelligence tab generation (Optimisation Brief v1.1, s4-s7).
 *
 * Stage A (job "intelligence-run"):  sections 2-10, then BLUF (1) and
 *                                    Actions (11) written from them.
 * Stage B (job "negotiation-run"):   P-089, sections 12-19: classify (model)
 *                                    → select / rank / map (code) → draft
 *                                    (model, span-tagged) → lint + gate check
 *                                    (code) → technique map (code).
 *
 * Locked sections survive regeneration: they are never overwritten. Missing
 * data renders as an open item, never invented.
 *
 * The brief's own prompt texts (P-061, P-024 and P-089 at library pin v3.7)
 * are not in this repository; the prompts below implement the brief's stated
 * contract for each section and are versioned in `prompt_versions` so the
 * library text can replace them without a schema change.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows are untyped here, as in lib/jobs/handlers.ts. */
import { z } from "zod";
import { adminClient } from "../data/supabase/client.js";
import { askClaudeJson } from "../ai/client.js";
import { enqueue } from "../jobs/queue.js";
import {
  BRIEF_KEYS, SUMMARY_KEYS,
  type SectionCard, type SectionContent, type SectionKey,
} from "../../src/lib/acp/intelligence.js";
import {
  BLOCKS, MOVE_TYPES, MOVE_TYPE_LABELS, TECHNIQUE_BY_CODE,
  type Block, type Diagnosis, type TechniqueCode,
} from "../../src/lib/acp/negotiation.js";
import { laneBadge, laneFromDeal, type Lane } from "../../src/lib/acp/wbsSpec.js";
import { deriveOutputs, lintDraft, mapBlocks, selectTechniques, type EngineContext, type TaggedDraft } from "../negotiation/engine.js";
import { rankBrokerAsks } from "../postcall/scorecard.js";

export const PROMPT_VERSIONS = {
  brief: "P-061 → P-024 → bridge/DSCR → BLUF · spec-derived v1 (library text pending)",
  p089: "P-089 · spec-derived v1 from brief 5a-5e (library pin v3.7 pending)",
};

const db = () => adminClient();

// ─── Schemas ───────────────────────────────────────────────────────────────
const TAGS = ["FILED", "MGMT", "VERIFIED", "VENDOR", "ESTIMATED", "ASSUMPTION", "UNKNOWN"] as const;
const contentSchema = z.object({
  bullets: z.array(z.object({ text: z.string(), tags: z.array(z.enum(TAGS)).optional() })).optional(),
  table: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())) }).optional(),
  note: z.string().optional(),
  open_items: z.array(z.string()).optional(),
  evidence: z.array(z.object({ tag: z.enum(TAGS), source: z.string() })).optional(),
});

const briefSchema = z.object(Object.fromEntries(BRIEF_KEYS.map((k) => [k, contentSchema]))) as z.ZodType<Record<string, SectionContent>>;
const summarySchema = z.object({ "1": contentSchema, "11": contentSchema }) as z.ZodType<Record<string, SectionContent>>;

const diagnosisSchema = z.object({
  move_primary: z.enum([...MOVE_TYPES, "pre_negotiation"] as [string, ...string[]]),
  move_secondary: z.enum(MOVE_TYPES).nullable(),
  temperature: z.enum(["low", "medium", "high"]),
  stated_position: z.string(),
  underlying_interest: z.string(),
  concessions: z.array(z.string()),
  anchors: z.array(z.object({ figure: z.string(), tag: z.string(), source: z.string() })),
  contradictions: z.array(z.string()),
  decision_unit: z.array(z.string()),
  batna_theirs: z.string(),
  batna_acp_internal: z.string(),
  milestone_available: z.boolean(),
  interests_map: z.array(z.object({ theirs: z.string(), acps: z.string(), shared: z.string(), tradeable: z.string() })),
});

const draftSchema = z.object({
  subject: z.string(),
  greeting: z.string(),
  blocks: z.array(z.object({ block: z.number().int().min(1).max(9), text: z.string() })),
  sign_off: z.string(),
  verbal_only: z.array(z.string()),
  second_call_agenda: z.array(z.string()),
  predicted_replies: z.array(z.object({
    scenario: z.enum(["Yes", "Partial", "No", "Silence"]),
    wording: z.string(),
    next_move: z.string(),
    techniques: z.array(z.string()),
  })),
  log_next_move: z.string(),
});

// ─── Context ───────────────────────────────────────────────────────────────
interface Ctx {
  intel: Record<string, any>;
  run: Record<string, any>;
  deal: Record<string, any>;
  lane: Lane;
  scorecard: Record<string, any>;
  imText: string;
  log: Array<Record<string, any>>;
  learning: Partial<Record<TechniqueCode, number>>;
}

async function loadCtx(intelligenceRunId: string): Promise<Ctx> {
  const { data: intel, error } = await db().from("intelligence_runs").select("*").eq("id", intelligenceRunId).single();
  if (error || !intel) throw new Error(`intelligence run ${intelligenceRunId} not found`);
  const { data: run } = await db().from("postcall_briefs").select("*").eq("id", intel.run_id).single();
  if (!run) throw new Error(`post-call run ${intel.run_id} not found`);
  const { data: deal } = await db().from("deals").select("*").eq("id", intel.deal_id).single();
  if (!deal) throw new Error(`deal ${intel.deal_id} not found`);

  let imText = "";
  try {
    const m = await import("../osint/providers/imDocuments.js");
    imText = m.formatImDocumentsForPrompt(await m.loadImDocumentText(intel.deal_id));
  } catch {
    imText = "";
  }
  const { data: log } = await db().from("negotiation_exchanges").select("*").eq("deal_id", intel.deal_id).order("exchange_no");
  const { data: techs } = await db().from("negotiation_techniques").select("code, learning_score");
  const learning = Object.fromEntries((techs ?? []).map((t) => [t.code, t.learning_score])) as Partial<Record<TechniqueCode, number>>;

  return {
    intel,
    run,
    deal,
    lane: (run.lane ?? laneFromDeal(deal.lane)) as Lane,
    scorecard: (run.brief_data ?? {}) as Record<string, any>,
    imText,
    log: log ?? [],
    learning,
  };
}

/** Merge new cards into the run, never touching locked ones. */
async function saveSections(id: string, cards: Partial<Record<SectionKey, SectionCard>>, extra: Record<string, unknown> = {}) {
  const { data: cur } = await db().from("intelligence_runs").select("sections, locked_sections, stale_sections").eq("id", id).single();
  const locked = new Set<string>(cur?.locked_sections ?? []);
  const sections = { ...(cur?.sections ?? {}) } as Record<string, unknown>;
  const written: string[] = [];
  for (const [k, card] of Object.entries(cards)) {
    if (locked.has(k) || !card) continue;
    sections[k] = card;
    written.push(k);
  }
  const stale = (cur?.stale_sections ?? []).filter((k: string) => !written.includes(k));
  await db().from("intelligence_runs").update({ sections, stale_sections: stale, updated_at: new Date().toISOString(), ...extra }).eq("id", id);
}

function dealLabel(deal: Record<string, any>) {
  const name = deal.company_name || deal.deal_name || "the business";
  return { name, acpRef: deal.acp_ref_no ?? "", brokerRef: deal.ref_no ?? "" };
}

function scorecardDigest(ctx: Ctx): string {
  const sc = ctx.scorecard;
  const fields = Object.entries(sc.fields ?? {})
    .filter(([, f]: [string, any]) => f?.status && f.status !== "unknown")
    .map(([k, f]: [string, any]) => `  ${k}: ${JSON.stringify(f.value)} [${String(f.status).toUpperCase()} · ${f.source ?? "no source"}]`)
    .join("\n");
  const open = Object.entries(sc.fields ?? {}).filter(([, f]: [string, any]) => !f?.status || f.status === "unknown").map(([k]) => k);
  const gates = (sc.gates ?? []).map((g: any) => `  ${g.id} ${g.name}: ${String(g.result).toUpperCase()}${g.qualifier ? ` · ${g.qualifier}` : ""}${g.reason ? ` (${g.reason})` : ""}`).join("\n");
  const dims = (sc.dimensions ?? []).map((d: any) => `  ${d.id} ${d.name}: ${d.score ?? "UNSCORED"}/100 · weight ${d.weight} · ${d.driver}`).join("\n");
  return `LANE: ${laneBadge(ctx.lane, ctx.deal.wbs_subsector)}
VERDICT: ${sc.verdict}${sc.band ? ` · band ${sc.band}` : ""}${sc.total_score != null ? ` · WBS score ${sc.total_score}/100` : ""}${sc.confidence_pct != null ? ` · confidence ${sc.confidence_pct}%` : ""}
REASON: ${sc.reason ?? ""}
LOI READY: ${sc.loi_ready ? "yes" : "no"} · blockers: ${(sc.loi_blockers ?? []).join(", ") || "none"}
DSCR SANCTION: ${ctx.deal.dscr_sanctioned_at ? `recorded (${ctx.deal.dscr_sanction_note ?? "no note"})` : "not recorded"}

GATES:
${gates}
${dims ? `\nDIMENSIONS:\n${dims}\n` : ""}
KNOWN FIELDS (value [TAG · source]):
${fields || "  none"}

OPEN (UNKNOWN) FIELDS: ${open.join(", ") || "none"}`;
}

const STYLE = `STYLE RULES (checked in code; a breach blocks the tab):
- Plain British English. No dashes used as pauses: use a colon or a full stop.
- Never use: private equity, micro PE, fund, LP, exit, permanent, forever.
- No earn-out or performance-linked terms anywhere.
- Every figure carries its evidence tag (FILED, MGMT, VERIFIED, VENDOR, ESTIMATED, ASSUMPTION, UNKNOWN) and a source.
- Missing data is written as an open item (in "open_items"), never invented or estimated without the ESTIMATED tag.`;

const CONTENT_SHAPE = `Each section is an object: { "bullets"?: [{ "text": string, "tags"?: [TAG] }], "table"?: { "columns": [string], "rows": [[string]] }, "note"?: string, "open_items"?: [string], "evidence"?: [{ "tag": TAG, "source": string }] }. Use a table where the section names columns; otherwise bullets.`;

// ─── Stage A: Intelligence Brief ───────────────────────────────────────────
export async function generateBrief(intelligenceRunId: string, only?: SectionKey[]) {
  const ctx = await loadCtx(intelligenceRunId);
  const { name, acpRef, brokerRef } = dealLabel(ctx.deal);
  const want = (keys: SectionKey[]) => keys.filter((k) => !only || only.includes(k));

  if (want(BRIEF_KEYS).length) {
    const brief = await askClaudeJson(briefSchema, {
      system: `You write the Intelligence Brief for Aysan Capital Partners (ACP), sections 2 to 10 of the Deal Intelligence tab, for ${name} (${acpRef}${brokerRef ? ` · broker ref ${brokerRef}` : ""}).
Run P-061 (document read: what the documents say, findings, contradictions), then P-024 (Kill / Price / Condition boxes), then the maintainable EBITDA bridge and the structure / DSCR solve.

SECTIONS (return every key):
"2" What the documents say: bullets, one fact each, tagged, with the document and page or call line as evidence.
"3" Findings, impact, red flags: table [Finding, Impact, Red flag (Yes/No), Tag].
"4" Contradictions: table [Claim, Conflicting evidence, Why it matters]. Name each conflict between the IM, the filed accounts and the call.
"5" Value creation, confidence: table [Lever, What it is worth, Confidence, Tag].
"6" Order of work: table [#, Gate, Result, Tag, Category]: the hard gates and priced dimensions that decide the next step, in the order to resolve them (Result is PASS, OPEN, CONDITION or PRICE).
"7" Maintainable EBITDA bridge (£k): table [Line, Conservative, Base, Upside]: anchor (adjusted, as stated), each deduction in brackets, ending with a "Maintainable" row. Tag the anchor's source in the note.
"8" Structure, DSCR, EV (partners only, never exported): bullets on the debt the maintainable EBITDA supports at the DSCR floor, the supportable EV range, and the structure. Internal only.
"9" Kill / Price / Condition: table [Item, Box, Reason, Tag].
"10" Power map: table [Person, Role, Influence, What they want, Approach].

${CONTENT_SHAPE}

${STYLE}`,
      maxTokens: 14_000,
      effort: "high",
      messages: [{
        role: "user",
        content: `${scorecardDigest(ctx)}

CALL INPUT (${ctx.run.input_kind ?? "notes"}):
${String(ctx.run.input_text ?? "").slice(0, 30_000)}

${ctx.imText || "No IM or attachment text available."}

Return JSON with keys "2" to "10".`,
      }],
    });
    const now = new Date().toISOString();
    await saveSections(intelligenceRunId, Object.fromEntries(want(BRIEF_KEYS).map((k) => [k, { content: brief[k], generated_at: now }])));
  }

  if (want(SUMMARY_KEYS).length) {
    const fresh = await loadCtx(intelligenceRunId);
    const s = fresh.intel.sections ?? {};
    const summary = await askClaudeJson(summarySchema, {
      system: `You write the BLUF (section 1) and Actions (section 11) of ACP's Deal Intelligence tab for ${name}, from sections 2 to 10 below. Written last, so it reflects them exactly.
"1" BLUF: at most five bullets. Start each with a bold lead in **double asterisks** (e.g. "**Not LOI-ready. Not a kill.** Stay in at minimal cost"). Cover the verdict, earnings (with tags), the structural risk, the cash model and the asymmetry.
"11" Actions: table [Action, Owner, By when, Unblocks].
${CONTENT_SHAPE}
${STYLE}`,
      maxTokens: 4_000,
      effort: "medium",
      messages: [{ role: "user", content: `${scorecardDigest(fresh)}\n\nSECTIONS 2-10:\n${JSON.stringify(Object.fromEntries(BRIEF_KEYS.map((k) => [k, s[k]?.content])), null, 1).slice(0, 40_000)}\n\nReturn JSON with keys "1" and "11".` }],
    });
    const now = new Date().toISOString();
    await saveSections(intelligenceRunId, Object.fromEntries(want(SUMMARY_KEYS).map((k) => [k, { content: summary[k], generated_at: now }])));
  }
}

// ─── Stage B: Negotiation Engine · P-089 ───────────────────────────────────
export interface P089Options {
  inbound?: string | null;
  counterpartyRole?: "broker" | "seller" | "lender" | "adviser";
  recipientName?: string | null;
}

/** Counterparty figures may be quoted with their source (6f; pending Ayo's approval). */
const QUOTE_COUNTERPARTY_FIGURES = process.env.QUOTE_COUNTERPARTY_FIGURES !== "off";
const SIGNATORY = process.env.NEGOTIATION_SIGNATORY || "Ayo Oyesanya, Managing Partner, Aysan Capital Partners";

export async function generateP089(intelligenceRunId: string, opts: P089Options = {}) {
  const ctx = await loadCtx(intelligenceRunId);
  const { name, acpRef, brokerRef } = dealLabel(ctx.deal);
  const role = opts.counterpartyRole ?? (brokerRef || ctx.deal.broker ? "broker" : "seller");
  const inbound = opts.inbound?.trim() || null;
  const lastOutbound = [...ctx.log].reverse().find((r) => r.direction === "outbound");
  const sanctioned = Boolean(ctx.deal.dscr_sanctioned_at);

  // Step 1 · classify (model).
  const diag = (await askClaudeJson(diagnosisSchema, {
    system: `You run step 1 of ACP's P-089 negotiation engine: classify the counterparty's position for ${name}.
Move types (pick a primary and an optional secondary): ${MOVE_TYPES.map((m) => `"${m}" (${MOVE_TYPE_LABELS[m]})`).join(", ")}.
If no counterparty message is supplied, set move_primary "pre_negotiation".
temperature: low / medium / high. concessions: what they have already given or disclosed (each specific). anchors: figures they lean on, each with its tag and source. contradictions: conflicts between their documents, filings and what was said. decision_unit: who decides, by name and role. batna_theirs vs batna_acp_internal (internal only, never written to them). milestone_available: true when a verifiable milestone exists that value could be tied to (a licence signed, a lease granted). interests_map: rows of theirs / ACP's / shared / tradeable.
Use only the evidence supplied. ${STYLE}`,
    maxTokens: 4_000,
    effort: "medium",
    messages: [{ role: "user", content: `${scorecardDigest(ctx)}\n\nCOUNTERPARTY: ${role}${opts.recipientName ? ` (${opts.recipientName})` : ""}\nCOUNTERPARTY MESSAGE: ${inbound ?? "none: pre-negotiation run"}\nACP LAST POSITION: ${lastOutbound ? `${lastOutbound.move_type ?? ""} · next move ${lastOutbound.next_move ?? ""}` : "none"}\n\nCALL INPUT:\n${String(ctx.run.input_text ?? "").slice(0, 20_000)}\n\n${ctx.imText.slice(0, 20_000)}` }],
  })) as Diagnosis;

  // Steps 2-5 · select, rank, map (code).
  const hardened = ctx.log.filter((r) => r.moved === "hardened").slice(-1).flatMap((r) => (r.techniques ?? []) as TechniqueCode[]);
  const engineCtx: EngineContext = { channel: "email", dscrSanctioned: sanctioned, counterpartyRole: role, preNegotiation: !inbound, learning: ctx.learning, hardened };
  const selection = selectTechniques(diag, engineCtx);
  const { techniques, plan } = mapBlocks(selection.selected, diag, selection.dropped.map((d) => d.code));

  // Schedule A: the run's ranked asks.
  const schedule: string[] = ctx.scorecard.schedule_a
    ? (ctx.scorecard.schedule_a as Array<{ ask: string }>).map((a) => a.ask)
    : rankBrokerAsks(ctx.scorecard.info_request ?? []).map((q) => q.question);

  // Step 6 · draft (model), span-tagged.
  const planText = BLOCKS.map(({ block, name: bName }) => {
    const codes = plan[block];
    if (!codes.length) return `  Block ${block} · ${bName}: OMIT`;
    return `  Block ${block} · ${bName}: ${codes.map((c) => { const t = TECHNIQUE_BY_CODE[c]; return `${c} ${t.name} — render: ${t.render_rule}${t.example ? ` e.g. "${t.example}"` : ""}; never: ${t.anti_patterns.join(", ")}`; }).join(" | ")}`;
  }).join("\n");
  const recipient = opts.recipientName?.trim().split(/\s+/)[0] || "";
  const subjectRule = inbound
    ? `"Re: ${brokerRef ? `${brokerRef} ` : ""}${name}: <their subject or topic>"`
    : `"${brokerRef ? `${brokerRef} ` : ""}${name}: information request following our call with <principals>"`;

  const rawDraft = await askClaudeJson(draftSchema, {
    system: `You run step 6 of ACP's P-089 negotiation engine: write the email to the ${role}${recipient ? ` (${recipient})` : ""} for ${name}, in nine blocks, ≤ 650 words excluding Schedule A.

BLOCK PLAN (decided in code; use exactly these techniques, nothing else):
${planText}

SPAN TAGS: wrap the sentence(s) that carry each technique in [[Txx]]…[[/Txx]]; when one sentence carries two, use [[T01,T05]]…[[/T01,T05]]. Every planned technique must appear in a span. Untagged connective sentences are allowed.

ADDRESSING (6c): ${role === "broker" ? "Address the broker by first name; name the principals in the body; ask the broker to share; never imply contact with the principals directly." : role === "seller" ? "Warm founder-to-founder, by first name; no lender or capital partner names." : role === "lender" ? "Business financials only; never price, stack or competing lenders." : "Requests only; no negotiation content."}
SUBJECT: ${subjectRule}. Never blank, never a money figure.
FIGURES (6f): ${sanctioned ? "The DSCR sanction is recorded: ACP figures may appear if needed." : "No ACP figure of any kind (EV, cash, stack, multiple, price): the DSCR sanction is not recorded."} ${QUOTE_COUNTERPARTY_FIGURES ? "Counterparty figures may be quoted only in the block-4 table, one per row as \"| <figure, written c.£…> | <document and page or 'Seller call'> |\"." : "Do not quote any figures."}
BLOCK 4: the objective basis as a table of their own figures with sources, then the label sentence when a contradiction exists. Exclude any disputed figure from ACP's own text.
BLOCK 5: what ACP cannot do, stated once, without apology.
BLOCK 6: exactly two numbered options "(1) … (2) …", both acceptable to ACP.
BLOCK 7: milestone only (licence signed, lease granted); never earn-out, target or performance.${diag.milestone_available ? "" : " There is no milestone: OMIT block 7."}
BLOCK 8: at most two questions, each starting How or What, put to the decision unit through the counterparty. Never Why.
BLOCK 9: one concrete next step with "[ACP calendar link]" or a date, framed as their benefit.
Never mention other targets, deals or alternatives (T14 is internal only). VLN and deferred consideration are verbal only: never write them.
sign_off: "Kind regards, ${SIGNATORY}".
verbal_only: points for the call, never written (cash-free/debt-free, VLN vs deferred, licence terms, introducer arrangement…).
second_call_agenda: 3 to 6 numbered topics.
predicted_replies: four rows (Yes, Partial, No, Silence) with likely wording, ACP's next move and technique codes (Silence: one nudge at 5 working days, T16, T11).
log_next_move: the next move for the Negotiation Log, no figures.
${STYLE}`,
    maxTokens: 8_000,
    effort: "high",
    messages: [{ role: "user", content: `${scorecardDigest(ctx)}\n\nDIAGNOSIS:\n${JSON.stringify(diag, null, 1)}\n\nCOUNTERPARTY MESSAGE: ${inbound ?? "none: pre-negotiation run"}\n\nSCHEDULE A (attach verbatim, in order): ${schedule.join(" · ")}` }],
  });

  const draft: TaggedDraft = {
    subject: rawDraft.subject,
    greeting: rawDraft.greeting,
    blocks: rawDraft.blocks.map((b) => ({ block: b.block as Block, text: b.text })),
    sign_off: rawDraft.sign_off,
    schedule,
  };

  // Step 7 · lint + gate check (code). Step 8 · derive (code).
  const lint = lintDraft(draft, techniques, diag, { ...engineCtx, quoteCounterpartyFigures: QUOTE_COUNTERPARTY_FIGURES, mpRelease: false });
  const { text, map } = deriveOutputs(lint.draft);
  const now = new Date().toISOString();
  const usedCodes = [...new Set(map.flatMap((m) => m.codes))];
  const exchangeNo = ctx.log.length + 1;

  const cards: Partial<Record<SectionKey, SectionCard>> = {
    "12": {
      generated_at: now,
      data: { diagnosis: diag },
      content: {
        table: {
          columns: ["Item", "Read"],
          rows: [
            ["Move type", diag.move_primary === "pre_negotiation" ? `Pre-negotiation (read as ${MOVE_TYPE_LABELS.broker_anchor.toLowerCase()} + stall)` : `${MOVE_TYPE_LABELS[diag.move_primary as keyof typeof MOVE_TYPE_LABELS]}${diag.move_secondary ? ` + ${MOVE_TYPE_LABELS[diag.move_secondary]}` : ""}`],
            ["Stated position", diag.stated_position],
            ["Underlying interest", diag.underlying_interest],
            ["Concessions made", diag.concessions.join("; ") || "None"],
            ["Anchors", diag.anchors.map((a) => `${a.figure} (${a.tag}, ${a.source})`).join("; ") || "None"],
            ["Contradictions", diag.contradictions.join("; ") || "None"],
            ["Decision unit", diag.decision_unit.join(", ")],
            ["BATNA", `Theirs: ${diag.batna_theirs}. ACP (internal only): ${diag.batna_acp_internal}`],
            ["Temperature", diag.temperature],
          ],
        },
      },
    },
    "13": {
      generated_at: now,
      content: { table: { columns: ["Theirs", "ACP's", "Shared", "Tradeable"], rows: diag.interests_map.map((r) => [r.theirs, r.acps, r.shared, r.tradeable]) } },
    },
    "14": {
      generated_at: now,
      data: { selected: techniques, dropped: selection.dropped, internal: selection.internal, plan },
      content: {
        table: {
          columns: ["Technique", "Block", "Reason (tied to diagnosis)"],
          rows: techniques.map((t) => [`${t.code} ${TECHNIQUE_BY_CODE[t.code].name}`, t.block ? String(t.block) : "verbal", t.block_default ? `Default for block ${t.block}` : t.reason]),
        },
        note: `T14 Silent BATNA is held internally and never rendered.${selection.dropped.length ? ` Dropped: ${[...new Map(selection.dropped.map((d) => [d.code, d])).values()].map((d) => `${d.code} (${d.why})`).join(", ")}.` : ""}`,
      },
    },
    "15": {
      generated_at: now,
      data: { subject: lint.draft.subject, text, tagged: lint.draft, word_count: text.split(/\s+/).length, send_enabled: lint.send_enabled },
      content: { note: `Subject: ${lint.draft.subject}` },
    },
    "16": {
      generated_at: now,
      data: { map },
      content: { table: { columns: ["Technique", "Source", "Line in draft"], rows: map.map((m) => [m.codes.join(", "), m.source, m.line]) } },
    },
    "17": {
      generated_at: now,
      data: { gate_check: lint.gate_check, technique_lint: lint.technique_lint, style: lint.style, send_enabled: lint.send_enabled },
      content: { table: { columns: ["Gate", "Result"], rows: lint.gate_check.map((r) => [r.label, r.result === "PASS" ? r.detail.startsWith("PASS") ? r.detail : "PASS" : `FAIL: ${r.detail}`]) } },
    },
    "18": {
      generated_at: now,
      data: { verbal_only: rawDraft.verbal_only, second_call_agenda: rawDraft.second_call_agenda },
      content: {
        table: {
          columns: ["Verbal only (never written)", "Second-call agenda"],
          rows: Array.from({ length: Math.max(rawDraft.verbal_only.length, rawDraft.second_call_agenda.length) }, (_, i) => [rawDraft.verbal_only[i] ?? "", rawDraft.second_call_agenda[i] ? `${i + 1} ${rawDraft.second_call_agenda[i].replace(/^\d+[.)]?\s*/, "")}` : ""]),
        },
      },
    },
    "19": {
      generated_at: now,
      data: {
        predicted_replies: rawDraft.predicted_replies,
        log_row: {
          exchange_no: exchangeNo,
          direction: "outbound",
          deal_ref: [acpRef, brokerRef ? `KBS ${brokerRef}` : ""].filter(Boolean).join(" / "),
          counterparty: `${opts.recipientName || ctx.deal.broker || "Counterparty"} / ${role}${role === "broker" ? " (principals: owners)" : ""}`,
          counterparty_role: role,
          move_type: diag.move_primary === "pre_negotiation" ? "Broker anchor + stall" : MOVE_TYPE_LABELS[diag.move_primary as keyof typeof MOVE_TYPE_LABELS],
          techniques: usedCodes.sort(),
          moved: "pending",
          next_move: stripFigures(rawDraft.log_next_move),
          live_figures: "None (H-08)",
        },
      },
      content: {
        table: { columns: ["Scenario", "Likely wording", "Next move", "Techniques"], rows: rawDraft.predicted_replies.map((r) => [r.scenario, r.wording, r.next_move, r.techniques.join(", ")]) },
      },
    },
  };

  await saveSections(intelligenceRunId, cards, { status: "done", generated_at: now, error: null });
}

// ─── Negotiation Log (H-08: no live figures) ───────────────────────────────
const FIGURE_TEXT = /(?:£|\$|€)\s?\d[\d,.]*\s*(?:k|m|bn)?|\b\d[\d,.]*\s*(?:k|m|bn|x)\b|\b\d+(?:\.\d+)?\s*%/gi;
export const stripFigures = (s: string) => (s ?? "").replace(FIGURE_TEXT, "[figure withheld]");

/** Start (or restart) generation for a run: Stage A, then Stage B. */
export async function startIntelligenceRun(opts: { dealId: string; runId: string; createdBy: string; inbound?: string | null; counterpartyRole?: P089Options["counterpartyRole"]; recipientName?: string | null }) {
  const { data, error } = await db().from("intelligence_runs").insert({
    deal_id: opts.dealId,
    run_id: opts.runId,
    status: "queued",
    prompt_versions: PROMPT_VERSIONS,
    created_by: opts.createdBy,
  }).select("*").single();
  if (error) throw new Error(`intelligence_runs.insert: ${error.message}`);
  const jobId = await enqueue("intelligence-run", {
    intelligence_run_id: data.id,
    p089: { inbound: opts.inbound ?? null, counterpartyRole: opts.counterpartyRole, recipientName: opts.recipientName ?? null },
  }, { createdBy: opts.createdBy });
  return { intelligence_run: data, job_id: jobId };
}
