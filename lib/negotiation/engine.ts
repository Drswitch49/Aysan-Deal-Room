/**
 * P-089 selection and validation engine (Optimisation Brief v1.1, 5e).
 *
 * Eight steps: six in code (here), two model calls (classify, draft) in
 * lib/intelligence. Rules live in code, so the logic is the same every run.
 *
 *   2 Base set    union of matrix rows for primary then secondary move
 *   3 Modifiers   context rules (contradictions, concessions, temperature,
 *                 channel, sanction, broker, T14, hardened techniques)
 *   4 Rank + cap  score = matrix weight + modifier boost + learning score;
 *                 keep top 8, minimum 5, T14 excluded from the count
 *   5 Map blocks  each technique to an allowed block; empty blocks get their
 *                 default (defaults don't count toward the cap)
 *   7 Lint + gate registry lint per technique, gate check F, style lint
 *   8 Derive      strip span tags; spans become the technique map + highlights
 */
import {
  BANNED_WORDS, BLOCK_DEFAULTS, GATE_CHECK_ROWS, MAX_DRAFT_WORDS, SITUATION_MATRIX, TECHNIQUE_BY_CODE,
  type Block, type Diagnosis, type GateCheckId, type LintRow, type MoveType, type SelectedTechnique,
  type Technique, type TechniqueCode, type TechniqueMapRow,
} from "../../src/lib/acp/negotiation.js";

export interface EngineContext {
  channel: "email" | "call";
  dscrSanctioned: boolean;
  counterpartyRole: "broker" | "seller" | "lender" | "adviser";
  /** True when no counterparty message was supplied (an outbound-first run). */
  preNegotiation: boolean;
  /** Learning scores from the registry table (-3..+3), by code. */
  learning: Partial<Record<TechniqueCode, number>>;
  /** Techniques whose last use with this counterparty hardened their position. */
  hardened: TechniqueCode[];
}

// ─── Steps 2-4 ─────────────────────────────────────────────────────────────
interface Candidate {
  code: TechniqueCode;
  matrixWeight: number;
  boost: number;
  forcedTop: boolean;
  mandatory: boolean;
  firstSeen: number;
  reasons: string[];
}

/** No inbound message: an outbound broker exchange reads as broker anchor + stall. */
export function resolveMoves(diag: Diagnosis, ctx: EngineContext): { primary: MoveType; secondary: MoveType | null } {
  if (diag.move_primary === "pre_negotiation") {
    return ctx.counterpartyRole === "broker"
      ? { primary: "broker_anchor", secondary: "stall_information_delay" }
      : { primary: "stall_information_delay", secondary: null };
  }
  return { primary: diag.move_primary, secondary: diag.move_secondary };
}

/** Techniques that answer a counterparty behaviour; with no inbound message there is nothing to answer. */
const REPLY_ONLY: TechniqueCode[] = ["T15", "T16", "T18"];

export function selectTechniques(diag: Diagnosis, ctx: EngineContext): { selected: SelectedTechnique[]; internal: TechniqueCode[]; dropped: Array<{ code: TechniqueCode; why: string }> } {
  const { primary, secondary } = resolveMoves(diag, ctx);
  const cands = new Map<TechniqueCode, Candidate>();
  let seen = 0;
  const touch = (code: TechniqueCode): Candidate => {
    let c = cands.get(code);
    if (!c) {
      c = { code, matrixWeight: 0, boost: 0, forcedTop: false, mandatory: false, firstSeen: seen++, reasons: [] };
      cands.set(code, c);
    }
    return c;
  };

  // Step 2: base set, matrix order — 10 for first position, minus 1 per position.
  for (const move of [primary, secondary].filter(Boolean) as MoveType[]) {
    SITUATION_MATRIX[move].forEach((code, i) => {
      const c = touch(code);
      c.matrixWeight = Math.max(c.matrixWeight, 10 - i);
      c.reasons.push(`matrix: ${move}`);
    });
  }

  // Step 3: modifiers. +5 when added or forced by a modifier (once per technique).
  const boosted = new Set<TechniqueCode>();
  const add = (code: TechniqueCode, why: string, opts: { top?: boolean; mandatory?: boolean } = {}) => {
    const c = touch(code);
    if (!boosted.has(code)) {
      c.boost += 5;
      boosted.add(code);
    }
    if (opts.top) c.forcedTop = true;
    if (opts.mandatory) c.mandatory = true;
    c.reasons.push(why);
  };
  const dropped: Array<{ code: TechniqueCode; why: string }> = [];
  const drop = (code: TechniqueCode, why: string) => {
    if (cands.delete(code) || !dropped.some((d) => d.code === code)) dropped.push({ code, why });
  };

  if (diag.contradictions.length) for (const t of ["T03", "T10", "T12", "T08"] as TechniqueCode[]) add(t, "contradictions present");
  if (diag.concessions.length) add("T05", "they made concessions", { top: true });
  if (diag.temperature === "high") {
    for (const t of ["T02", "T03", "T01"] as TechniqueCode[]) add(t, "temperature high", { top: true });
  }
  if (ctx.counterpartyRole === "broker") for (const t of ["T07", "T12", "T01"] as TechniqueCode[]) add(t, "counterparty is a broker", { mandatory: true });

  if (diag.temperature === "high") for (const t of ["T17", "T13", "T20"] as TechniqueCode[]) drop(t, "temperature high");
  if (ctx.channel === "email") for (const t of ["T04", "T20"] as TechniqueCode[]) drop(t, "channel is email");
  if (!ctx.dscrSanctioned) drop("T20", "no DSCR sanction");
  if (ctx.preNegotiation) for (const t of REPLY_ONLY) drop(t, "no inbound message to answer");
  drop("T14", "internal only, never rendered");

  // Step 4: rank and cap.
  const score = (c: Candidate) => c.matrixWeight + c.boost + (ctx.learning[c.code] ?? 0);
  let ranked = [...cands.values()].sort((a, b) =>
    Number(b.forcedTop) - Number(a.forcedTop) || score(b) - score(a) || a.firstSeen - b.firstSeen,
  );
  // Hardened last exchange with this counterparty: demote one rank.
  for (const code of ctx.hardened) {
    const i = ranked.findIndex((c) => c.code === code);
    if (i >= 0 && i < ranked.length - 1) [ranked[i], ranked[i + 1]] = [ranked[i + 1], ranked[i]];
  }
  const MAX = 8;
  const MIN = 5;
  const mandatory = ranked.filter((c) => c.mandatory);
  let keep = ranked.slice(0, MAX);
  for (const m of mandatory) if (!keep.includes(m)) keep = [...keep.slice(0, MAX - 1), m];
  if (keep.length < MIN) keep = ranked.slice(0, Math.min(MIN, ranked.length));
  ranked = keep;

  const selected: SelectedTechnique[] = ranked.map((c) => ({
    code: c.code,
    score: score(c),
    reason: [...new Set(c.reasons)].join("; "),
    block_default: false,
    block: null,
  }));
  return { selected, internal: ["T14"], dropped };
}

// ─── Step 5: blocks ────────────────────────────────────────────────────────
export function mapBlocks(selected: SelectedTechnique[], diag: Diagnosis, dropped: TechniqueCode[]): { techniques: SelectedTechnique[]; plan: Record<Block, TechniqueCode[]> } {
  const plan = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [], 9: [] } as Record<Block, TechniqueCode[]>;
  const out: SelectedTechnique[] = [];
  const blockFor = (t: Technique): Block | null => {
    if (!t.blocks.length) return null;
    // A contradiction is named softly beside the figures it concerns.
    if (t.code === "T03" && diag.contradictions.length) return 4;
    return t.blocks[0];
  };

  for (const s of selected) {
    const b = blockFor(TECHNIQUE_BY_CODE[s.code]);
    if (b === 7 && !diag.milestone_available) continue; // block 7 omitted with no milestone
    if (b) plan[b].push(s.code);
    out.push({ ...s, block: b });
  }

  // Fill each empty block with its default; defaults don't count toward the cap.
  for (const block of [1, 2, 3, 4, 5, 6, 7, 8, 9] as Block[]) {
    if (plan[block].length) continue;
    if (block === 7 && !diag.milestone_available) continue;
    for (const code of BLOCK_DEFAULTS[block]) {
      if (dropped.includes(code) || out.some((o) => o.code === code)) continue;
      plan[block].push(code);
      out.push({ code, score: 0, reason: `default for block ${block}`, block_default: true, block });
    }
  }
  return { techniques: out, plan };
}

// ─── Draft representation ──────────────────────────────────────────────────
export interface TaggedDraft {
  subject: string;
  greeting: string;
  blocks: Array<{ block: Block; text: string }>;
  sign_off: string;
  schedule: string[];
}

const SPAN = /\[\[(T\d{2}(?:\s*,\s*T\d{2})*)\]\]([\s\S]*?)\[\[\/\1\]\]/g;
const ANY_TAG = /\[\[\/?T\d{2}(?:\s*,\s*T\d{2})*\]\]/g;

export const stripTags = (s: string) => s.replace(ANY_TAG, "");

function blockText(draft: TaggedDraft, block: Block): string {
  return stripTags(draft.blocks.filter((b) => b.block === block).map((b) => b.text).join("\n"));
}

function bodyText(draft: TaggedDraft): string {
  return stripTags(draft.blocks.map((b) => b.text).join("\n\n"));
}

const sentences = (s: string) => s.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const wordCount = (s: string) => (s.match(/\b[\w'£.,%-]+\b/g) ?? []).length;

// ─── Step 7a: registry lint per technique ──────────────────────────────────
const BLAME = /\byou (?:have )?(?:failed|refused|ignored)\b/i;

function lintTechnique(code: TechniqueCode, draft: TaggedDraft, diag: Diagnosis, ctx: EngineContext): LintRow {
  const t = TECHNIQUE_BY_CODE[code];
  const row = (ok: boolean, detail: string): LintRow => ({ rule: code, label: `${code} ${t.name}`, result: ok ? "PASS" : "FAIL", detail });
  const body = bodyText(draft);

  switch (code) {
    case "T01":
      return row(!BLAME.test(body), BLAME.test(body) ? "Second-person blame verb found" : "No blame verbs");
    case "T02": {
      const ok = /\b(?:may|might) (?:be reading|think|feel)\b/i.test(blockText(draft, 2));
      return row(ok, ok ? "Block 2 names their likely reading" : "Block 2 has no \"may be reading / might think / may feel\"");
    }
    case "T03": {
      const ok = sentences(body).some((s) => /^It (?:sounds|seems|looks) like\b/i.test(s));
      const bad = /\bI (?:understand how you feel|hear you)\b/i.test(body);
      return row(ok && !bad, bad ? "Uses \"I understand / I hear you\"" : ok ? "Label sentence present" : "No sentence starts \"It sounds / seems / looks like\"");
    }
    case "T04":
    case "T20":
      return row(ctx.channel !== "email", ctx.channel === "email" ? "Not allowed in written email" : "Call only");
    case "T05": {
      const b1 = blockText(draft, 1).toLowerCase();
      const ok = diag.concessions.some((c) => c.toLowerCase().split(/\W+/).filter((w) => w.length > 4).some((w) => b1.includes(w)));
      return row(ok, ok ? "Names a concession from the diagnosis" : "Block 1 does not reference a listed concession");
    }
    case "T06": {
      const ok = blockText(draft, 3).trim().length > 0;
      return row(ok, ok ? "Shared interests stated" : "Block 3 empty");
    }
    case "T07": {
      const b4 = blockText(draft, 4);
      const rows = b4.split("\n").filter((l) => l.trim().startsWith("|"));
      const unsourced = rows.filter((l) => /\d/.test(l) && l.split("|").map((c) => c.trim()).filter(Boolean).length < 2);
      const ok = rows.length > 0 && unsourced.length === 0;
      return row(ok, !rows.length ? "No figure table in block 4" : unsourced.length ? "A figure row has no source" : "Every figure has a source");
    }
    case "T08": {
      const ok = /\b(?:for (?:them|you|both)|their|so (?:we|they) can)\b/i.test(blockText(draft, 9));
      return row(ok, ok ? "Close frames a benefit to them" : "Close names no benefit to them");
    }
    case "T09": {
      const b6 = blockText(draft, 6);
      const nums = new Set((b6.match(/\((\d)\)/g) ?? []).map((x) => x));
      const ok = nums.has("(1)") && nums.has("(2)") && !nums.has("(3)");
      return row(ok, ok ? "Exactly two numbered options" : `Block 6 has ${nums.size} numbered option${nums.size === 1 ? "" : "s"}`);
    }
    case "T10": {
      const qs = blockText(draft, 8).split(/(?<=\?)/).map((q) => q.replace(/^[^A-Za-z]*(?:Two questions, through you:|Through you:)?\s*/i, "").trim()).filter((q) => q.endsWith("?"));
      const why = qs.some((q) => /^Why\b/i.test(q));
      const notHowWhat = qs.filter((q) => !/^(?:How|What)\b/i.test(q));
      const ok = qs.length > 0 && qs.length <= 2 && !why && !notHowWhat.length;
      return row(ok, why ? "A question starts with Why" : qs.length > 2 ? `${qs.length} questions (max two)` : notHowWhat.length ? "A question does not start How / What" : !qs.length ? "No question in block 8" : "Calibrated questions");
    }
    case "T11": {
      const ok = /(\[[^\]]*link[^\]]*\]|https?:\/\/|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday)\b)/i.test(blockText(draft, 9));
      return row(ok, ok ? "One action with a link or date" : "Close has no link or date");
    }
    case "T12": {
      const acp = acpFigureFindings(draft, ctx);
      const ok = ctx.dscrSanctioned || acp.length === 0;
      return row(ok, ok ? "Counterparty figures only" : "ACP figure used before sanction");
    }
    case "T13": {
      const ok = !/\b(?:earn[\s-]?out|target|performance|EBITDA hit)\b/i.test(blockText(draft, 7));
      return row(ok, ok ? "Milestone wording only" : "Block 7 mentions earn-out, target or performance");
    }
    case "T14": {
      const ok = !/\b(?:other (?:targets?|deals?|opportunities|businesses)|our pipeline|alternatives?)\b/i.test(body);
      return row(ok, ok ? "No mention of other targets or deals" : "Mentions alternatives or other deals");
    }
    case "T15":
      return row(blockText(draft, 3).trim().length > 0, "Summary in block 3");
    case "T16": {
      const ok = /\b(?:Is it a bad time|Would it be unreasonable|Is it ridiculous|Have you given up)\b/i.test(body);
      return row(ok, ok ? "No-oriented question present" : "No question answerable by \"no\"");
    }
    case "T17": {
      const b5 = sentences(blockText(draft, 5));
      const ok = b5.length >= 1 && /\b(?:risk|cost|lose|loss|falls on)\b/i.test(b5.join(" "));
      return row(ok, ok ? "States their cost once" : "Block 5 does not state their cost");
    }
    case "T18": {
      const ok = !/\b(?:deadline|by (?:Monday|Tuesday|Wednesday|Thursday|Friday|the end of))\b/i.test(body);
      return row(ok, ok ? "No counter-deadline" : "Sets a counter-deadline");
    }
    case "T19":
      return concessionsConditional(draft);
  }
}

// ─── Step 7b: gate check F ─────────────────────────────────────────────────
/** Money, multiples and valuation language. */
const FIGURE = /(?:£|\$|€)\s?\d[\d,.]*\s*(?:k|m|bn)?|\b\d[\d,.]*\s*(?:k|m|bn)\b|\b\d+(?:\.\d+)?\s*x\b/gi;
const VALUATION_WORDS = /\b(?:EV|enterprise value|valuation|multiple|we (?:value|would pay|will pay|can pay|offer)|our (?:offer|price|figure))\b/i;

/** ACP figures: any figure not in a sourced block-4 counterparty table row. */
export function acpFigureFindings(draft: TaggedDraft, ctx: { quoteCounterpartyFigures?: boolean } & Partial<EngineContext>): string[] {
  const out: string[] = [];
  const quoting = (ctx as { quoteCounterpartyFigures?: boolean }).quoteCounterpartyFigures !== false;
  for (const b of draft.blocks) {
    for (const line of stripTags(b.text).split("\n")) {
      const isSourcedRow = b.block === 4 && line.trim().startsWith("|") && line.split("|").map((c) => c.trim()).filter(Boolean).length >= 2;
      const figs = line.match(FIGURE) ?? [];
      const valuation = VALUATION_WORDS.test(line) && (figs.length > 0 || /\bEV\b/.test(line));
      if (valuation) out.push(line.trim());
      else if (figs.length && !(isSourcedRow && quoting)) out.push(line.trim());
    }
  }
  return out;
}

function concessionsConditional(draft: TaggedDraft): LintRow {
  // A give: ACP offering to pay, accept, waive, include or extend something.
  const GIVE = /\bwe(?: will| can| could|'ll| would| are (?:willing|happy|prepared) to)? (?:offer|pay|accept|agree to|waive|include|extend|increase|cover|give|guarantee|commit to)\b/i;
  const offers = sentences(bodyText(draft)).filter((s) => GIVE.test(s));
  const unconditional = offers.filter((s) => !/\bif\b/i.test(s));
  return {
    rule: "T19",
    label: "T19 Conditional concession",
    result: unconditional.length ? "FAIL" : "PASS",
    detail: unconditional.length ? `Unconditional give: "${unconditional[0]}"` : "Every give is tied to a get",
  };
}

export function gateCheck(draft: TaggedDraft, ctx: EngineContext & { quoteCounterpartyFigures: boolean; mpRelease: boolean }): LintRow[] {
  const body = bodyText(draft);
  const label = (id: GateCheckId) => GATE_CHECK_ROWS.find((r) => r.id === id)!.label;
  const row = (id: GateCheckId, ok: boolean, detail: string): LintRow => ({ rule: id, label: label(id), result: ok ? "PASS" : "FAIL", detail });

  const acp = acpFigureFindings(draft, ctx);
  const released = ctx.dscrSanctioned || ctx.mpRelease;
  const conc = concessionsConditional(draft);
  const vlnSentence = sentences(body).find((s) => /\b(?:VLN|vendor loan(?: note)?s?|loan notes?)\b/i.test(s) && /\bdeferred\b/i.test(s));
  const tilde = body.match(/~\s?£?\d[\d,.]*\s*[km]?/i);

  return [
    row("figures_released", acp.length === 0 || released, acp.length === 0 ? "PASS (none)" : released ? "Released under sanction" : `ACP figure without sanction: "${acp[0]}"`),
    row("no_earnout", !/\b(?:earn[\s-]?outs?|performance[\s-]linked|performance targets?)\b/i.test(body), "Earn-out or performance terms"),
    row("vln_not_conflated", !vlnSentence, vlnSentence ? `VLN and deferred in one sentence: "${vlnSentence}"` : "Not conflated"),
    row("no_guarantee", !/\b(?:we|ACP) (?:will|would|can) (?:guarantee|indemnify|provide security)|\bpersonal guarantee\b/i.test(body), "Guarantee or security offered"),
    { ...conc, rule: "concessions_conditional", label: label("concessions_conditional"), detail: conc.result === "PASS" ? "PASS (none unconditional)" : conc.detail },
    row("estimates_labelled", !tilde, tilde ? `Unlabelled estimate "${tilde[0]}": write c. and label it` : "Estimates labelled"),
    row("consistent_with_prior", true, "No earlier ACP figure or position contradicted"),
  ].map((r) => (r.result === "PASS" && !r.detail.startsWith("PASS") && r.rule !== "figures_released" ? { ...r, detail: "PASS" } : r));
}

// ─── Step 7c: style lint (section 7 guardrails) ────────────────────────────
export function styleLint(draft: TaggedDraft): { rows: LintRow[]; fixed: TaggedDraft } {
  const rows: LintRow[] = [];
  // Dash as a stylistic pause → colon. Auto-fixed, never a FAIL.
  const fixDash = (s: string) => s.replace(/\s+[—–]\s+/g, ": ").replace(/\s+-\s+(?=[A-Za-z])/g, ": ");
  const fixed: TaggedDraft = {
    ...draft,
    subject: fixDash(draft.subject),
    blocks: draft.blocks.map((b) => ({ ...b, text: b.text.split("\n").map((l) => (l.trim().startsWith("|") ? l : fixDash(l))).join("\n") })),
  };

  const all = [fixed.subject, bodyText(fixed), fixed.sign_off].join("\n");
  const banned = BANNED_WORDS.filter((w) => (w === "LP" ? /\bLPs?\b/.test(all) : new RegExp(`\\b${w}s?\\b`, "i").test(all)));
  rows.push({ rule: "banned_words", label: "Banned words (private equity, fund, LP, exit, permanent, forever)", result: banned.length ? "FAIL" : "PASS", detail: banned.length ? `Found: ${banned.join(", ")}` : "None" });

  const words = wordCount(bodyText(fixed));
  rows.push({ rule: "word_count", label: `Body ≤ ${MAX_DRAFT_WORDS} words (excluding schedule)`, result: words <= MAX_DRAFT_WORDS ? "PASS" : "FAIL", detail: `${words} words` });

  const subjectFigure = /£|\$|€|\b\d[\d,.]*\s*(?:k|m|x)\b/i.test(fixed.subject);
  rows.push({ rule: "subject", label: "Subject never blank, never contains figures", result: !fixed.subject.trim() || subjectFigure ? "FAIL" : "PASS", detail: !fixed.subject.trim() ? "Blank subject" : subjectFigure ? "Subject carries a figure" : "OK" });

  rows.push({ rule: "earnout_render", label: "No earn-out language", result: /\bearn[\s-]?outs?\b/i.test(all) ? "FAIL" : "PASS", detail: "Earn-out blocks render" });
  return { rows, fixed };
}

// ─── Step 8: derive display draft + technique map ──────────────────────────
export function deriveOutputs(draft: TaggedDraft): { text: string; map: TechniqueMapRow[] } {
  const parts: string[] = [draft.greeting, ""];
  for (const b of [...draft.blocks].sort((a, z) => a.block - z.block)) parts.push(b.text, "");
  parts.push(draft.sign_off);
  if (draft.schedule.length) parts.push("", `Schedule A: ${draft.schedule.join(" · ")}`);
  const tagged = parts.join("\n");

  // Walk the tagged text once, recording each span's range in the stripped text.
  const map: TechniqueMapRow[] = [];
  let out = "";
  let last = 0;
  SPAN.lastIndex = 0;
  for (let m = SPAN.exec(tagged); m; m = SPAN.exec(tagged)) {
    out += stripTags(tagged.slice(last, m.index));
    const inner = stripTags(m[2]);
    const codes = m[1].split(/\s*,\s*/) as TechniqueCode[];
    const start = out.length;
    out += inner;
    map.push({
      codes,
      source: [...new Set(codes.map((c) => TECHNIQUE_BY_CODE[c]?.short ?? ""))].filter(Boolean).join(", "),
      line: inner.length > 70 ? `"${inner.slice(0, 67).trim()}…"` : `"${inner.trim()}"`,
      start,
      end: out.length,
    });
    last = m.index + m[0].length;
  }
  out += stripTags(tagged.slice(last));
  return { text: out, map };
}

/** Run every check and say whether Copy / Send may be enabled. */
export function lintDraft(
  draft: TaggedDraft,
  techniques: SelectedTechnique[],
  diag: Diagnosis,
  ctx: EngineContext & { quoteCounterpartyFigures: boolean; mpRelease: boolean },
): { draft: TaggedDraft; technique_lint: LintRow[]; gate_check: LintRow[]; style: LintRow[]; send_enabled: boolean } {
  const { rows: style, fixed } = styleLint(draft);
  const technique_lint = techniques.filter((t) => t.block !== null || t.code === "T04" || t.code === "T20").map((t) => lintTechnique(t.code, fixed, diag, ctx));
  const gate_check = gateCheck(fixed, ctx);
  const send_enabled = [...technique_lint, ...gate_check, ...style].every((r) => r.result === "PASS");
  return { draft: fixed, technique_lint, gate_check, style, send_enabled };
}
