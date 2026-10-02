/**
 * P-089 Negotiation Engine — technique registry, situation matrix and block
 * plan (Optimisation Brief v1.1, sections 5a, 5b, 5d, 5e).
 *
 * These rows are the seed for the `negotiation_techniques` table (migration
 * 0025) and the engine's fallback when the table is unreachable. The engine
 * never invents a technique: it selects from these rows, renders by the
 * render rule and lints against the check.
 */

export type TechniqueCode =
  | "T01" | "T02" | "T03" | "T04" | "T05" | "T06" | "T07" | "T08" | "T09" | "T10"
  | "T11" | "T12" | "T13" | "T14" | "T15" | "T16" | "T17" | "T18" | "T19" | "T20";

export type Block = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type Channel = "email" | "call";

export interface Technique {
  code: TechniqueCode;
  name: string;
  source: string;
  /** Short source used on the technique map ("GTY", "Voss", ...). */
  short: string;
  principle: string;
  triggers: string[];
  /** Blocks the technique may render in; empty = never rendered in writing. */
  blocks: Block[];
  channels: Channel[];
  render_rule: string;
  example: string;
  anti_patterns: string[];
  lint: string;
  requires_sanction: boolean;
  learning_score: number;
}

const T = (t: Omit<Technique, "learning_score">): Technique => ({ ...t, learning_score: 0 });

export const TECHNIQUES: Technique[] = [
  T({ code: "T01", name: "Separate people from problem", source: "Fisher, Ury, Getting to Yes", short: "GTY", principle: "Treat the relationship and the issue as separate; be soft on people, firm on substance", triggers: ["warm_relationship", "friction"], blocks: [1, 9], channels: ["email", "call"], render_rule: "Credit the person, keep the issue impersonal.", example: "Thank you for arranging Friday's call.", anti_patterns: ["blame", "you failed to"], lint: "No second-person blame verbs (failed, refused, ignored)", requires_sanction: false }),
  T({ code: "T02", name: "Accusation audit", source: "Voss, Never Split the Difference", short: "Voss", principle: "Name their likely negative reading of you before they do; it defuses it", triggers: ["request_may_read_as_stall", "price_anchor_dispute", "anger"], blocks: [2], channels: ["email", "call"], render_rule: "You may be reading X as Y. It is neither.", example: "You may be reading a long information request as a buyer slowing things down.", anti_patterns: ["defensive over-explaining"], lint: "Block 2 contains \"may be reading\", \"might think\" or \"may feel\" + a negative", requires_sanction: false }),
  T({ code: "T03", name: "Labelling", source: "Voss, Never Split the Difference", short: "Voss", principle: "State the emotion or position you observe; it shows you heard them", triggers: ["emotion", "contradiction"], blocks: [3, 4], channels: ["email", "call"], render_rule: "It sounds like… / It seems… / It looks like…", example: "It sounds like YE25 was a strong year and YE26 a rebuilding one.", anti_patterns: ["I understand how you feel", "I hear you"], lint: "Sentence starts with It sounds / seems / looks like", requires_sanction: false }),
  T({ code: "T04", name: "Mirroring", source: "Voss, Never Split the Difference", short: "Voss", principle: "Repeat their last 1 to 3 words as a question to draw them out", triggers: ["calls_only"], blocks: [], channels: ["call"], render_rule: "…had offers?", example: "…had offers?", anti_patterns: ["any use in written email"], lint: "Blocked when channel = email", requires_sanction: false }),
  T({ code: "T05", name: "Reciprocity", source: "Cialdini, Influence", short: "Cialdini", principle: "People return a concession they receive; acknowledging theirs creates the debt", triggers: ["concession_made", "disclosure"], blocks: [1], channels: ["email", "call"], render_rule: "Name the specific concession.", example: "Open about this year's numbers and the licence.", anti_patterns: ["generic thanks"], lint: "References a concession listed in diagnosis", requires_sanction: false }),
  T({ code: "T06", name: "Interests not positions", source: "Fisher, Ury, Getting to Yes", short: "GTY", principle: "Work on why they want something, not what they demand", triggers: ["position_differs_from_interest"], blocks: [3], channels: ["email", "call"], render_rule: "List 2 to 3 shared interests.", example: "We share three things…", anti_patterns: ["arguing their number"], lint: "2 to 3 interests, each in diagnosis interests map", requires_sanction: false }),
  T({ code: "T07", name: "Objective criteria", source: "Fisher, Ury, Getting to Yes", short: "GTY", principle: "Anchor on independent standards both sides accept", triggers: ["figure_in_play", "valuation_in_play"], blocks: [4], channels: ["email", "call"], render_rule: "Figures in a table, each with source.", example: "| Adjusted EBITDA YE25 c.£265k | IM p.15 |", anti_patterns: ["unsourced claims", "market rate is"], lint: "Every figure has a source; table present", requires_sanction: false }),
  T({ code: "T08", name: "Golden bridge", source: "Ury, Getting Past No", short: "Ury", principle: "Give them a face-saving path to agree", triggers: ["anchored_high", "must_climb_down"], blocks: [9], channels: ["email", "call"], render_rule: "Frame the next step as their win.", example: "So we can move quickly for them.", anti_patterns: ["you were wrong"], lint: "Close names a benefit to them", requires_sanction: false }),
  T({ code: "T09", name: "Bounded options", source: "Fisher, Ury; Voss", short: "GTY, Voss", principle: "Offer two choices, both acceptable to ACP; choice reduces resistance", triggers: ["decision_needed"], blocks: [6], channels: ["email", "call"], render_rule: "Exactly two numbered options.", example: "Two ways forward, both work for us: (1) … (2) …", anti_patterns: ["three plus options", "an option ACP cannot accept"], lint: "Exactly 2 options; both inside ACP limits", requires_sanction: false }),
  T({ code: "T10", name: "Calibrated questions", source: "Voss, Never Split the Difference", short: "Voss", principle: "Open How / What questions make them solve your problem", triggers: ["information_needed", "commitment_needed"], blocks: [8], channels: ["email", "call"], render_rule: "Max two questions, starting How or What, to the decision unit.", example: "How are you planning the timetable once YE26 is final?", anti_patterns: ["why questions", "yes/no questions"], lint: "≤ 2 questions; each starts How/What; none starts Why", requires_sanction: false }),
  T({ code: "T11", name: "Low-friction next step", source: "Cialdini, Influence (commitment)", short: "Cialdini", principle: "Small, easy commitments lead to bigger ones", triggers: ["every_message"], blocks: [9], channels: ["email", "call"], render_rule: "One concrete, cheap action with a link or date.", example: "We would welcome a second call: [ACP calendar link]", anti_patterns: ["vague let us know"], lint: "Close holds one action + link or date", requires_sanction: false }),
  T({ code: "T12", name: "Re-anchor to evidence", source: "Kahneman; Malhotra", short: "Kahneman", principle: "Replace their anchor with documented figures; anchoring bias fades against evidence", triggers: ["anchored_on_peak", "unverified_figure"], blocks: [4], channels: ["email", "call"], render_rule: "Place their own three figures side by side.", example: "Three-figure source table", anti_patterns: ["counter-anchoring with ACP's own number pre-sanction"], lint: "Uses counterparty figures; zero ACP figures pre-sanction", requires_sanction: false }),
  T({ code: "T13", name: "Contingent agreement", source: "Malhotra, Negotiating the Impossible", short: "Malhotra", principle: "Bridge disagreement with value paid when a verifiable milestone occurs", triggers: ["uncertainty_they_believe_you_doubt"], blocks: [7], channels: ["email", "call"], render_rule: "Milestone only (licence signed, lease granted). Mechanics verbal.", example: "Reflect its long-term continuity in how we structure the proposal.", anti_patterns: ["performance or revenue targets (earn-out)"], lint: "Bans: earn-out, target, performance, EBITDA hit", requires_sanction: false }),
  T({ code: "T14", name: "Silent BATNA", source: "Fisher, Ury, Getting to Yes", short: "GTY", principle: "Your best alternative gives power only when unspoken", triggers: ["always_internal"], blocks: [], channels: [], render_rule: "Never written. Shapes tone and walk-away.", example: "", anti_patterns: ["stating alternatives or other deals"], lint: "No mention of other targets or deals", requires_sanction: false }),
  T({ code: "T15", name: "\"That's right\" summary", source: "Voss, Never Split the Difference", short: "Voss", principle: "Summarise their view so well they say \"that's right\"", triggers: ["conditional_acceptance", "long_exchange"], blocks: [3], channels: ["email", "call"], render_rule: "Two-sentence summary of their position.", example: "", anti_patterns: ["you're right (concession)"], lint: "Summary matches diagnosis stated position", requires_sanction: false }),
  T({ code: "T16", name: "No-oriented question", source: "Voss, Never Split the Difference", short: "Voss", principle: "People feel safer saying no; a \"no\" answer moves things", triggers: ["silence", "stall"], blocks: [8], channels: ["email", "call"], render_rule: "\"Is it a bad time to…?\" \"Would it be unreasonable to…?\"", example: "Is it a bad time to pick this up?", anti_patterns: ["pushy yes-questions"], lint: "Question answerable by \"no\" to proceed", requires_sanction: false }),
  T({ code: "T17", name: "Loss framing", source: "Kahneman, Thinking, Fast and Slow", short: "Kahneman", principle: "Losses weigh about twice gains; show what they lose", triggers: ["explaining_a_limit", "risk"], blocks: [5], channels: ["email", "call"], render_rule: "One sentence: the cost to them of the alternative.", example: "That risk falls on the sellers as much as on us.", anti_patterns: ["threats"], lint: "One sentence; mentions their cost; stated once", requires_sanction: false }),
  T({ code: "T18", name: "Go to the balcony", source: "Ury, Getting Past No", short: "Ury", principle: "Step back and name a tactic calmly instead of reacting", triggers: ["ultimatum", "deadline", "pressure"], blocks: [2, 4], channels: ["email", "call"], render_rule: "\"We note the timetable. Our process is the same either way.\"", example: "We note the timetable. Our process is the same either way.", anti_patterns: ["matching their pressure"], lint: "Neutral verbs; no counter-deadline", requires_sanction: false }),
  T({ code: "T19", name: "Conditional concession", source: "Malhotra, Negotiating the Impossible", short: "Malhotra", principle: "Never give; trade. Every give is tied to a get", triggers: ["acp_concession"], blocks: [6, 7], channels: ["email", "call"], render_rule: "\"If you…, then we…\"", example: "If you share the licence and membership data, then we can be specific on price within X days.", anti_patterns: ["unconditional gives"], lint: "Every concession sentence contains If + then", requires_sanction: false }),
  T({ code: "T20", name: "Ackerman increments", source: "Voss, Never Split the Difference", short: "Voss", principle: "Price moves 65/85/95/100% in shrinking steps", triggers: ["live_price_haggling"], blocks: [], channels: ["call"], render_rule: "Never written.", example: "", anti_patterns: ["any written use"], lint: "Blocked in email", requires_sanction: true }),
];

export const TECHNIQUE_BY_CODE = Object.fromEntries(TECHNIQUES.map((t) => [t.code, t])) as Record<TechniqueCode, Technique>;

// ─── Situation matrix (5b): move type → techniques, in order ───────────────
export const MOVE_TYPES = [
  "counter_offer_above_value",
  "price_objection",
  "ultimatum_deadline",
  "stall_information_delay",
  "broker_anchor",
  "conditional_acceptance",
  "anger_rupture",
  "guarantee_security_demand",
  "contradiction_in_documents",
] as const;
export type MoveType = (typeof MOVE_TYPES)[number];

export const MOVE_TYPE_LABELS: Record<MoveType, string> = {
  counter_offer_above_value: "Counter-offer above value",
  price_objection: "Price objection or hurt pride",
  ultimatum_deadline: "Ultimatum or deadline",
  stall_information_delay: "Stall or information delay",
  broker_anchor: "Third-party pressure or broker anchor",
  conditional_acceptance: "Conditional acceptance",
  anger_rupture: "Anger or rupture",
  guarantee_security_demand: "Guarantee or security demand",
  contradiction_in_documents: "Contradiction in their documents",
};

export const SITUATION_MATRIX: Record<MoveType, TechniqueCode[]> = {
  counter_offer_above_value: ["T05", "T02", "T06", "T07", "T12", "T13", "T09", "T10", "T11"],
  price_objection: ["T03", "T02", "T01", "T15", "T07", "T08"],
  ultimatum_deadline: ["T18", "T03", "T16", "T14", "T08"],
  stall_information_delay: ["T11", "T16", "T10", "T07"],
  broker_anchor: ["T07", "T12", "T01"],
  conditional_acceptance: ["T15", "T19", "T11"],
  anger_rupture: ["T02", "T03", "T01", "T08"],
  guarantee_security_demand: ["T17", "T09", "T07"],
  contradiction_in_documents: ["T03", "T10", "T12", "T08"],
};

/** Matrix-row notes the engine enforces outside technique choice. */
export const MATRIX_NOTES: Partial<Record<MoveType, string>> = {
  broker_anchor: "Address principal; copy all",
  conditional_acceptance: "Lock terms same day",
  anger_rupture: "No figures",
  contradiction_in_documents: "Exclude disputed item",
};

// ─── Nine-block draft (5b) and block defaults (5e step 5) ──────────────────
export const BLOCKS: Array<{ block: Block; name: string }> = [
  { block: 1, name: "Acknowledgement" },
  { block: 2, name: "Accusation audit" },
  { block: 3, name: "Shared interests" },
  { block: 4, name: "Objective basis with sourced figures" },
  { block: 5, name: "What we cannot do, once" },
  { block: 6, name: "Two options" },
  { block: 7, name: "Contingent upside (milestone, not performance)" },
  { block: 8, name: "Calibrated questions (max two)" },
  { block: 9, name: "Next step and warm close" },
];

export const BLOCK_DEFAULTS: Record<Block, TechniqueCode[]> = {
  1: ["T01", "T05"],
  2: ["T02"],
  3: ["T06"],
  4: ["T07", "T12"],
  5: ["T17"],
  6: ["T09"],
  7: ["T13"],
  8: ["T10"],
  9: ["T11", "T08"],
};

export const MAX_DRAFT_WORDS = 650;

// ─── Gate check F (section 5c) ─────────────────────────────────────────────
export const GATE_CHECK_ROWS = [
  { id: "figures_released", label: "ACP figures released only with CFO sanction or recorded MP release" },
  { id: "no_earnout", label: "No earn-out or performance-linked terms" },
  { id: "vln_not_conflated", label: "VLN and deferred consideration not conflated" },
  { id: "no_guarantee", label: "No ACP guarantee or security for vendor debts" },
  { id: "concessions_conditional", label: "Every concession conditional" },
  { id: "estimates_labelled", label: "Estimates labelled" },
  { id: "consistent_with_prior", label: "No contradiction of earlier ACP messages" },
] as const;
export type GateCheckId = (typeof GATE_CHECK_ROWS)[number]["id"];

/** Words that block render outright (section 7 guardrails). */
export const BANNED_WORDS = ["private equity", "micro PE", "fund", "LP", "exit", "permanent", "forever"];

// ─── Engine output (stored in intelligence_runs.sections, keys 12-19) ──────
export interface Diagnosis {
  move_primary: MoveType | "pre_negotiation";
  move_secondary: MoveType | null;
  temperature: "low" | "medium" | "high";
  stated_position: string;
  underlying_interest: string;
  concessions: string[];
  anchors: Array<{ figure: string; tag: string; source: string }>;
  contradictions: string[];
  decision_unit: string[];
  batna_theirs: string;
  batna_acp_internal: string;
  milestone_available: boolean;
  interests_map: Array<{ theirs: string; acps: string; shared: string; tradeable: string }>;
}

export interface SelectedTechnique {
  code: TechniqueCode;
  score: number;
  reason: string;
  /** True when added only to fill an empty block (not counted toward the 5-8 cap). */
  block_default: boolean;
  block: Block | null;
}

export interface LintRow {
  rule: string;
  label: string;
  result: "PASS" | "FAIL";
  detail: string;
}

export interface TechniqueMapRow {
  codes: TechniqueCode[];
  source: string;
  line: string;
  /** Character range in the display draft, for highlighting. */
  start: number;
  end: number;
}
