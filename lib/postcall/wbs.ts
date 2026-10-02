/**
 * Lane 2 · WBS scoring engine (Optimisation Brief v1.1, sections 3 and 6).
 *
 * Claude extracts the WBS field set with an evidence tag and a source per
 * field. Everything else is decided here, in code, so the logic is the same
 * every run:
 *
 *  - Config: an unsigned WBS Playbook config scores nothing. Every gate and
 *    dimension returns UNSCORED and the verdict is UNSCORED, never KILL.
 *  - Gates H1-H9, in order, stop at the first FAIL. A gate can only FAIL on
 *    evidence carrying one of its required tags AND admissible for the run
 *    type. ESTIMATED / ASSUMPTION never produce a FAIL: the gate stays OPEN.
 *  - Dimensions D1-D7 score 0-100 by linear interpolation between the
 *    config's end-points (unknown inputs sit at mid-band 50 and lower the
 *    confidence), weighted to 100 with the sub-sector shift applied.
 *  - Verdict: any FAIL → KILL + reason code; any OPEN/UNSCORED → PROVISIONAL
 *    + indicative band; all PASS → band (≥75 ADVANCE, 55-74 PRICE/CONDITION,
 *    40-54 HOLD, <40 DECLINE).
 *  - LOI blocker: deferred_income_missing replaces debtors_missing when the
 *    cash model is consumer-paid.
 *  - Schedule A: ranked open asks from the lane question bank, ≤ 12; seller-
 *    only and behavioural fields go to the second-call agenda instead.
 */
import { z } from "zod";
import {
  ADMISSIBLE_EVIDENCE, B2C_CASH_MODELS, EVIDENCE_TAGS, SUBSECTOR_SHIFTS, UNFUNDABLE_CASH_MODELS,
  WBS_DIMENSIONS, WBS_FIELDS, WBS_FIELD_KEYS, WBS_GATES, bandFor,
  type BrokerEmail, type EvidenceTag, type LoiBlocker, type RunType, type ScheduleAItem,
  type WbsDimension, type WbsDimId, type WbsField, type WbsGate, type WbsGateDef, type WbsGateId,
  type WbsMetricScore, type WbsScorecard, type WbsSubsector, type WbsThresholds, type WbsVerdict, type WbsWeights,
} from "../../src/lib/acp/wbsSpec.js";
import { containsFiguresOrStructure, numberLines, sourceResolves } from "./scorecard.js";

// ─── What Claude must return ───────────────────────────────────────────────
const claudeWbsFieldSchema = z
  .object({
    value: z.unknown(),
    status: z.enum(EVIDENCE_TAGS),
    source: z.string().nullable(),
    next_action: z.string().nullable(),
  })
  .strict();

export const claudeWbsSchema = z
  .object({
    fields: z.object(Object.fromEntries(WBS_FIELD_KEYS.map((k) => [k, claudeWbsFieldSchema.optional()]))).strict(),
    /** The sellers / principals named on the call, first names as used. */
    principals: z.array(z.string()).max(6),
  })
  .strict();
export type ClaudeWbs = z.infer<typeof claudeWbsSchema>;

/** The WBS playbook_config row the engine scores against. */
export interface WbsConfig {
  version: number;
  thresholds: WbsThresholds;
  weights: WbsWeights;
  signed_by: string | null;
  signed_at: string | null;
}

export interface WbsEngineInput {
  dealId: string;
  dealName: string;
  /** Broker's reference for the deal (KBS number), used in the subject line. */
  brokerRef: string | null;
  /** Broker contact's first name, for the greeting. */
  recipientName: string | null;
  subsector: WbsSubsector | null;
  runType: RunType;
  raw: ClaudeWbs;
  config: WbsConfig;
  inputKind: "transcript" | "notes";
  inputText: string;
  precallBriefId: string | null;
  dscrSanctioned: boolean;
  /** Deal columns some metrics read (distance_rm11_miles, indicative_dscr). */
  dealColumns: Record<string, unknown>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[£,\s%x]/gi, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const known = (f: WbsField | undefined): f is WbsField => Boolean(f && f.status !== "unknown");

function getPath(value: unknown, path: string[]): unknown {
  let cur = value;
  for (const p of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** 100 at `full`, 0 at `zero`, linear between, clamped. Works in either direction. */
export function linearScore(value: number, full: number, zero: number): number {
  if (full === zero) return value >= full ? 100 : 0;
  const t = (value - zero) / (full - zero);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

/** Effective weights: config weights plus the sub-sector shift, floored at 0. */
export function effectiveWeights(weights: WbsWeights, subsector: WbsSubsector | null): WbsWeights {
  const out = { ...weights };
  const shift = subsector ? SUBSECTOR_SHIFTS[subsector] : undefined;
  if (shift) for (const [d, delta] of Object.entries(shift)) out[d as WbsDimId] = Math.max(0, out[d as WbsDimId] + (delta ?? 0));
  return out;
}

/** How many of the 7 dimensions have every linear end-point set. */
export function thresholdsSet(t: WbsThresholds): number {
  return WBS_DIMENSIONS.filter((d) =>
    d.metrics.every((m) => m.kind !== "linear" || (t.metrics[m.key]?.full != null && t.metrics[m.key]?.zero != null)),
  ).length;
}

// ─── Engine ────────────────────────────────────────────────────────────────
export function buildWbsScorecard(input: WbsEngineInput): WbsScorecard {
  const { lineCount } = numberLines(input.inputText);
  const srcCtx = { inputText: input.inputText, lineCount, hasBrief: Boolean(input.precallBriefId) };
  const fieldAdjustments: WbsScorecard["field_adjustments"] = [];
  const signed = Boolean(input.config.signed_at);
  const cfg = input.config.thresholds;

  // 1. Fields — no resolving source means no value.
  const fields: Record<string, WbsField> = {};
  for (const def of WBS_FIELDS) {
    const r = input.raw.fields[def.key];
    const f: WbsField = r
      ? { value: r.value ?? null, status: r.status, source: r.source?.trim() || null, next_action: r.next_action?.trim() || null }
      : { value: null, status: "unknown", source: null, next_action: null };
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

  // 2. Gates.
  const gates = evaluateGates(fields, cfg, input.runType, signed);

  // 3. Dimensions + total.
  const weights = effectiveWeights(input.config.weights, input.subsector);
  const dimensions = scoreDimensions(fields, cfg, weights, input.dealColumns, signed);
  const totalScore = signed ? Math.round(dimensions.reduce((s, d) => s + (d.points ?? 0), 0)) : null;
  const confidencePct = confidence(dimensions, weights, fields);

  // 4. Verdict.
  const firstFail = gates.find((g) => g.result === "fail") ?? null;
  const anyOpen = gates.some((g) => g.result === "open" || g.result === "unscored");
  let verdict: WbsVerdict;
  let band = totalScore == null ? null : bandFor(totalScore);
  let reason: string;
  if (!signed) {
    verdict = "UNSCORED";
    band = null;
    reason = "Playbook Config WBS is unsigned: no gate or dimension is scored until Dami signs it.";
  } else if (firstFail) {
    verdict = "KILL";
    reason = `${firstFail.id} ${firstFail.name} failed on admissible evidence: ${firstFail.reason}`;
  } else if (anyOpen) {
    verdict = "PROVISIONAL";
    const open = gates.filter((g) => g.result !== "pass").map((g) => g.id);
    reason = `No gate failed on admissible evidence. ${open.join(" and ")} open. Score is indicative.`;
  } else {
    verdict = band!;
    reason = "All nine gates pass. The weighted score prices the deal.";
  }

  // 5. Completeness.
  const required = WBS_FIELDS.length;
  const knownCount = WBS_FIELDS.filter((d) => known(fields[d.key])).length;

  // 6. LOI blockers.
  const cashModel = known(fields.cash_model) ? String(fields.cash_model.value) : null;
  const consumerPaid = cashModel != null && (B2C_CASH_MODELS as string[]).includes(cashModel);
  const loiBlockers: LoiBlocker[] = [];
  if (!input.dscrSanctioned) loiBlockers.push("dscr_sanction_missing");
  if (verdict === "KILL") loiBlockers.push("verdict_kill");
  if (consumerPaid) {
    if (!known(fields.deferred_income_gbp)) loiBlockers.push("deferred_income_missing");
  } else if (!known(fields.debtors_aged)) {
    loiBlockers.push("debtors_missing");
  }

  // 7. Schedule A, second-call agenda, broker email.
  const scheduleA = rankScheduleA(fields);
  const secondCall = WBS_FIELDS
    .filter((d) => d.sellerOnly && (!known(fields[d.key]) || fields[d.key].status === "vendor"))
    .map((d) => d.question);
  const principals = input.raw.principals.map((p) => p.trim()).filter(Boolean);
  const brokerEmail = infoRequestEmail({
    brokerRef: input.brokerRef,
    dealName: input.dealName,
    recipientName: input.recipientName,
    principals,
    asks: scheduleA.map((a) => a.ask),
    figuresAllowed: input.dscrSanctioned,
  });

  return {
    spec: "acp-postcall-wbs-v1",
    lane: "lane_2_wbs",
    subsector: input.subsector,
    run_type: input.runType,
    deal_id: input.dealId,
    playbook_version: input.config.version,
    config_signed: signed,
    config_signed_by: input.config.signed_by,
    config_signed_at: input.config.signed_at,
    thresholds_set: thresholdsSet(cfg),
    input_kind: input.inputKind,
    precall_brief_id: input.precallBriefId,
    verdict,
    band,
    reason,
    kill_reason: firstFail?.id ?? null,
    gates,
    dimensions,
    total_score: totalScore,
    confidence_pct: confidencePct,
    fields,
    completeness: { known: knownCount, required, pct: Math.round((knownCount / required) * 100) },
    schedule_a: scheduleA,
    second_call_agenda: secondCall,
    loi_ready: loiBlockers.length === 0,
    loi_blockers: loiBlockers,
    earnout_flag: known(fields.earnout_ask) && fields.earnout_ask.value === true,
    principals,
    broker_email: brokerEmail,
    field_adjustments: fieldAdjustments,
  };
}

// ─── Gates ─────────────────────────────────────────────────────────────────
export function evaluateGates(
  fields: Record<string, WbsField>,
  cfg: WbsThresholds,
  runType: RunType,
  signed: boolean,
): WbsGate[] {
  const out: WbsGate[] = [];
  let stopped = false;

  for (const def of WBS_GATES) {
    if (!signed) {
      out.push({ id: def.id, name: def.name, result: "unscored", qualifier: null, reason: "Config unsigned", adjustments: ["config_unsigned"] });
      continue;
    }
    if (stopped) {
      out.push({ id: def.id, name: def.name, result: "unscored", qualifier: null, reason: "Not evaluated: an earlier gate failed", adjustments: ["stopped_at_first_fail"] });
      continue;
    }
    const g = evaluateGate(def, fields, cfg, runType);
    out.push(g);
    if (g.result === "fail") stopped = true;
  }
  return out;
}

function evaluateGate(def: WbsGateDef, fields: Record<string, WbsField>, cfg: WbsThresholds, runType: RunType): WbsGate {
  const adjustments: string[] = [];
  const gate = (result: WbsGate["result"], reason: string, qualifier: WbsGate["qualifier"] = null): WbsGate =>
    ({ id: def.id, name: def.name, result, qualifier, reason, adjustments });

  /** FAIL if the deciding field's evidence allows it, else OPEN with the reason recorded. */
  const failOn = (field: WbsField, reason: string): WbsGate => {
    const tag = field.status as EvidenceTag;
    if (tag === "estimated" || tag === "assumption") {
      adjustments.push("estimated_cannot_fail");
      return gate("open", `${reason} (${tag.toUpperCase()} evidence cannot fail a gate)`);
    }
    if (!def.failNeeds.includes(tag)) {
      adjustments.push("evidence_tag_insufficient");
      return gate("open", `${reason} (needs ${def.failNeeds.map((t) => t.toUpperCase()).join(" / ")} evidence, have ${tag.toUpperCase()})`);
    }
    if (!ADMISSIBLE_EVIDENCE[runType].includes(tag)) {
      adjustments.push("evidence_inadmissible_for_run_type");
      return gate("open", `${reason} (${tag.toUpperCase()} is not admissible on this run type)`);
    }
    return gate("fail", reason);
  };

  const f = (k: string) => fields[k];
  const isTrue = (k: string) => known(f(k)) && f(k).value === true;
  const isFalse = (k: string) => known(f(k)) && f(k).value === false;

  switch (def.id) {
    case "H1": {
      const filed = f("ebitda_filed_y1_y3");
      const rows = known(filed) && Array.isArray(filed.value) ? (filed.value as Array<Record<string, unknown>>) : [];
      const latest = rows.length ? num(rows[rows.length - 1]?.ebitda_gbp) : null;
      if (latest == null) return gate("open", "Filed EBITDA not yet seen");
      if (latest <= 0) return failOn(filed, "Latest filed EBITDA is not positive");
      return gate("pass", "Filed EBITDA > 0");
    }
    case "H2": {
      const cm = f("cash_model");
      if (!known(cm)) return gate("open", "Cash model not confirmed");
      if ((UNFUNDABLE_CASH_MODELS as string[]).includes(String(cm.value))) return failOn(cm, `Cash model is ${String(cm.value).replace(/_/g, " ")}`);
      return gate("pass", String(cm.value).replace(/_/g, " "));
    }
    case "H3": {
      if (!cfg.h3_conditions.length) {
        adjustments.push("conditions_not_configured");
        return gate("open", "Playbook patient-facing conditions not yet supplied as config text");
      }
      const pf = f("patient_facing_conditions");
      const rows = known(pf) && Array.isArray(pf.value) ? (pf.value as Array<{ condition?: string; met?: boolean | null }>) : [];
      const failed = rows.find((r) => r.met === false);
      if (failed) return failOn(pf, `Condition not met: ${failed.condition ?? "unnamed"}`);
      if (rows.length >= cfg.h3_conditions.length && rows.every((r) => r.met === true)) return gate("pass", "All Playbook conditions met");
      return gate("open", "Playbook five conditions not all confirmed");
    }
    case "H4": {
      if (isTrue("enforcement")) return failOn(f("enforcement"), "Unresolved enforcement");
      const reg = f("regulator_registrations");
      const missing = known(reg) ? getPath(reg.value, ["missing_required"]) : undefined;
      const openMatters = known(reg) ? getPath(reg.value, ["open_matters"]) : undefined;
      if (missing === true) return failOn(reg, "Required registration missing");
      if (isFalse("enforcement") && missing === false && openMatters !== true) return gate("pass", "Registrations in place, no enforcement");
      return gate("open", "Registrations and any open matters not yet confirmed");
    }
    case "H5": {
      const acc = f("accreditations");
      if (!known(acc) || !Array.isArray(acc.value)) return gate("open", "Registration holders not yet confirmed");
      const critical = (acc.value as Array<Record<string, unknown>>).filter((a) => a.holder === "person" && a.revenue_critical !== false);
      if (!critical.length) return gate("pass", "No owner-held critical registration");
      if (isTrue("holder_12m_stay")) return gate("pass", "Personal holder commits to a 12-month stay");
      if (isFalse("holder_12m_stay")) return failOn(f("holder_12m_stay"), "Owner holds a revenue-critical registration with no 12-month stay");
      return gate("open", "Owner-held registration: 12-month stay not confirmed");
    }
    case "H6": {
      const ip = f("ip_owned_by_company");
      if (!known(ip)) return gate("open", "Ownership of systems and patient data not confirmed");
      if (ip.value === "refused") return failOn(ip, "Seller refuses ownership or a long-term licence");
      if (ip.value === "rolling_licence") return gate("open", "Systems licensed month to month from the sellers", "condition");
      return gate("pass", ip.value === "owned" ? "IP owned by the company" : "Long-term licence");
    }
    case "H7": {
      const top = known(f("top_practitioner_rev_pct")) ? num(f("top_practitioner_rev_pct").value) : null;
      const payer = known(f("insurer_corporate_share")) ? num(f("insurer_corporate_share").value) : null;
      if (cfg.h7_practitioner_max_pct == null || cfg.h7_payer_max_pct == null) {
        adjustments.push("threshold_unset");
        return gate("open", "Concentration band not set in the config");
      }
      if (top != null && top > cfg.h7_practitioner_max_pct) return failOn(f("top_practitioner_rev_pct"), "Top practitioner above the Playbook band");
      if (payer != null && payer > cfg.h7_payer_max_pct) return failOn(f("insurer_corporate_share"), "Single payer above the Playbook band");
      if (top != null && payer != null) return gate("pass", "Practitioner and payer within band");
      return gate("open", "Practitioner and payer shares not yet seen");
    }
    case "H8": {
      for (const k of ["sic_hard_stop", "insolvency", "litigation"]) {
        if (isTrue(k)) return failOn(f(k), k === "sic_hard_stop" ? "SIC hard stop" : k === "insolvency" ? "Insolvency" : "Continuity-threatening litigation");
      }
      if (["sic_hard_stop", "insolvency", "litigation"].every(isFalse)) return gate("pass", "No SIC stop, insolvency or litigation");
      return gate("open", "Eligibility checks not complete");
    }
    case "H9": {
      if (isTrue("misrepresentation")) return failOn(f("misrepresentation"), "Material IM vs evidence conflict");
      if (isFalse("misrepresentation")) return gate("pass", "No material conflict found");
      return gate("open", "IM not yet reconciled to evidence");
    }
  }
}

// ─── Dimensions ────────────────────────────────────────────────────────────
function metricValue(
  source: string,
  fields: Record<string, WbsField>,
  dealColumns: Record<string, unknown>,
): { value: number | string | boolean | null; tag: EvidenceTag | null } {
  if (source.startsWith("deal:")) {
    const v = dealColumns[source.slice(5)];
    const n = num(v);
    return { value: n, tag: n == null ? null : "verified" };
  }
  if (source === "premises_tenure") {
    const f = fields.premises_tenure;
    if (!known(f)) return { value: null, tag: null };
    const type = getPath(f.value, ["type"]);
    const years = num(getPath(f.value, ["years_remaining"]));
    if (type === "rolling") return { value: 0, tag: f.status };
    if (type === "freehold") return { value: 99, tag: f.status };
    return { value: years, tag: years == null ? null : f.status };
  }
  const [key, ...path] = source.split(".");
  const f = fields[key];
  if (!known(f)) return { value: null, tag: null };
  const raw = path.length ? getPath(f.value, path) : f.value;
  if (typeof raw === "boolean" || typeof raw === "string") {
    const n = typeof raw === "string" ? num(raw) : null;
    return { value: n ?? raw, tag: f.status };
  }
  const n = num(raw);
  return { value: n, tag: n == null ? null : f.status };
}

function scoreDimensions(
  fields: Record<string, WbsField>,
  cfg: WbsThresholds,
  weights: WbsWeights,
  dealColumns: Record<string, unknown>,
  signed: boolean,
): WbsDimension[] {
  return WBS_DIMENSIONS.map((dim) => {
    const metrics: WbsMetricScore[] = dim.metrics.map((m) => {
      const { value } = metricValue(m.source, fields, dealColumns);
      let score: number | null = null;
      if (value != null) {
        if (m.kind === "linear") {
          const t = cfg.metrics[m.key];
          const n = typeof value === "number" ? value : num(value);
          if (n != null && t?.full != null && t?.zero != null) score = linearScore(n, t.full, t.zero);
        } else if (m.kind === "categorical") {
          const s = m.map?.[String(value)];
          if (s != null) score = s;
        } else if (m.kind === "boolean_good" && typeof value === "boolean") {
          score = value ? 100 : 0;
        } else if (m.kind === "boolean_bad" && typeof value === "boolean") {
          score = value ? 0 : 100;
        }
      }
      // Unknown inputs sit at mid-band: they neither reward nor punish, and
      // they lower the confidence figure instead.
      return { key: m.key, label: m.label, value, score: score ?? 50, known: score != null };
    });

    const weight = weights[dim.id];
    if (!signed) return { id: dim.id, name: dim.name, weight, score: null, points: null, driver: "Config unsigned", metrics };

    const score = Math.round(metrics.reduce((s, m) => s + m.score, 0) / metrics.length);
    return {
      id: dim.id,
      name: dim.name,
      weight,
      score,
      points: Math.round(score * weight) / 100,
      driver: driverFor(metrics),
      metrics,
    };
  });
}

function driverFor(metrics: WbsMetricScore[]): string {
  const knownOnes = metrics.filter((m) => m.known);
  if (!knownOnes.length) return "Inputs unknown: mid-band";
  const worst = knownOnes.reduce((a, b) => (b.score < a.score ? b : a));
  const unknownCount = metrics.length - knownOnes.length;
  const shown = typeof worst.value === "boolean" ? (worst.value ? "yes" : "no") : String(worst.value).replace(/_/g, " ");
  return `${worst.label}: ${shown}${unknownCount ? ` · ${unknownCount} input${unknownCount > 1 ? "s" : ""} unknown` : ""}`;
}

/**
 * Share of the weighted score resting on real evidence: each metric carries
 * its dimension's weight split evenly, and counts when its input is known and
 * not ESTIMATED / ASSUMPTION.
 */
function confidence(dimensions: WbsDimension[], weights: WbsWeights, fields: Record<string, WbsField>): number {
  let total = 0;
  let solid = 0;
  for (const dim of dimensions) {
    const def = WBS_DIMENSIONS.find((d) => d.id === dim.id)!;
    const share = weights[dim.id] / def.metrics.length;
    def.metrics.forEach((m, i) => {
      total += share;
      if (!dim.metrics[i].known) return;
      const key = m.source.startsWith("deal:") ? null : m.source.split(".")[0];
      const tag = key ? fields[key]?.status : "verified";
      if (tag !== "estimated" && tag !== "assumption") solid += share;
    });
  }
  return total ? Math.round((solid / total) * 100) : 0;
}

// ─── Schedule A (section 6d) ───────────────────────────────────────────────
const MAX_ASKS = 12;

export function rankScheduleA(fields: Record<string, WbsField>): ScheduleAItem[] {
  const dimWeight = Object.fromEntries(WBS_DIMENSIONS.map((d) => [d.id, d.weight])) as Record<string, number>;

  const priorityOf = (def: (typeof WBS_FIELDS)[number]) => {
    const dims = def.feeds.filter((x) => x.startsWith("D"));
    const dimensionWeight = dims.length ? Math.max(...dims.map((d) => dimWeight[d])) : 10;
    const feedsGate = def.feeds.some((x) => x.startsWith("H"));
    const gateFactor = feedsGate ? 3 : def.feeds.includes("loi") ? 2 : 1;
    // The next stage is LOI: earnings and LOI inputs are what it needs.
    const stageFactor = def.feeds.some((x) => x === "H1" || x === "D2" || x === "loi") ? 1.5 : 1;
    return dimensionWeight * gateFactor * stageFactor;
  };

  const askable = WBS_FIELDS
    .map((def, order) => ({ def, order }))
    .filter(({ def }) => !def.sellerOnly && !def.key.startsWith("hapi_"));
  const isCandidate = (key: string) => {
    const s = fields[key]?.status ?? "unknown";
    return s === "unknown" || s === "vendor";
  };

  // Fields sharing a source document become one ask. The ask exists when any
  // of its fields is still open, and is weighted by everything the document
  // evidences: asking for the accounts covers filed EBITDA too.
  const merged = new Map<string, { ask: string; fields: string[]; priority: number; order: number; open: boolean }>();
  for (const { def, order } of askable) {
    const key = def.doc ?? def.key;
    const g = merged.get(key) ?? { ask: def.question, fields: [], priority: 0, order, open: false };
    g.priority = Math.max(g.priority, priorityOf(def));
    g.order = Math.min(g.order, order);
    if (isCandidate(def.key)) {
      g.open = true;
      g.fields.push(def.key);
    }
    merged.set(key, g);
  }

  return [...merged.values()]
    .filter((g) => g.open)
    .sort((a, b) => b.priority - a.priority || a.order - b.order)
    .slice(0, MAX_ASKS)
    .map(({ ask, fields: f, priority }) => ({ ask, fields: f, priority }));
}

// ─── Info request email (section 6g subject formula) ───────────────────────
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function infoRequestSubject(brokerRef: string | null, dealName: string, principals: string[]): string {
  const ref = brokerRef?.trim() ? `${brokerRef.trim()} ` : "";
  const withWhom = principals.length ? ` with ${joinNames(principals)}` : "";
  return `${ref}${dealName}: information request following our call${withWhom}`;
}

export function infoRequestEmail(opts: {
  brokerRef: string | null;
  dealName: string;
  recipientName: string | null;
  principals: string[];
  asks: string[];
  figuresAllowed: boolean;
}): BrokerEmail {
  const asks = opts.asks.filter((a) => opts.figuresAllowed || !containsFiguresOrStructure(a));
  const first = opts.recipientName?.trim().split(/\s+/)[0];
  const thanks = opts.principals.length
    ? `Thank you for arranging the call. Please pass on our thanks to ${joinNames(opts.principals)} for their time.`
    : "Thank you for arranging the call.";
  const body = [
    `Dear ${first || "all"},`,
    "",
    thanks,
    "",
    "To prepare a proposal on numbers that will hold through diligence, could you share the items below? Documents in whatever form is easiest.",
    "",
    ...asks.map((a, i) => `${i + 1}. ${a}`),
    "",
    "We would welcome a second call once we have the priority items.",
    "",
    "Kind regards,",
  ].join("\n");
  return {
    subject: infoRequestSubject(opts.brokerRef, opts.dealName, opts.principals),
    body,
    figures_allowed: opts.figuresAllowed,
    withheld: opts.asks.length - asks.length,
  };
}

export const WBS_GATE_IDS: WbsGateId[] = WBS_GATES.map((g) => g.id);
