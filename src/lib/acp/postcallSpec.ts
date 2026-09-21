/**
 * ACP Post-Call Scorecard — the field and gate catalogue from the spec
 * (docs: "ACP Post-Call Scorecard Spec").
 *
 * Shared by the prompt (lib/ai/tasks.ts), the server-side engine that enforces
 * the spec's rules (lib/postcall/scorecard.ts) and the Post-call tab. It holds
 * WHAT is extracted and HOW gates are phrased — never thresholds. Thresholds
 * live in the versioned `playbook_config` table and are injected per run.
 */

export const FIELD_STATUSES = ["filed", "estimated", "vendor", "verified", "unknown"] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];

export const FIELD_BOXES = ["kill", "price", "condition", "none"] as const;
export type FieldBox = (typeof FIELD_BOXES)[number];

export const GATE_RESULTS = ["pass", "fail", "vendor", "unknown"] as const;
export type GateResult = (typeof GATE_RESULTS)[number];

export const VERDICTS = ["Kill", "Price", "Condition", "Proceed to info request"] as const;
export type Verdict = (typeof VERDICTS)[number];

export type SectionId =
  | "g1" | "g2" | "g3" | "g4" | "g5" | "g6" | "g7" | "g8"
  | "earnings" | "debtors" | "human_api" | "seller";

export interface FieldDef {
  key: string;
  label: string;
  section: SectionId;
  /** The value shape Claude must return. */
  shape: string;
  /** Fallback info-request question when Claude gives none. No £, % or structure. */
  question: string;
}

export const SECTIONS: Array<{ id: SectionId; label: string; feeds?: string }> = [
  { id: "g1", label: "Gate 1 · Non-discretionary" },
  { id: "g2", label: "Gate 2 · B2B contracted recurring" },
  { id: "g3", label: "Gate 3 · Profitable now" },
  { id: "g4", label: "Gate 4 · Concentration" },
  { id: "g5", label: "Gate 5 · Transferable" },
  { id: "g6", label: "Gate 6 · Ledger type" },
  { id: "g7", label: "Gate 7 · Accreditation" },
  { id: "g8", label: "Gate 8 · Other hard kills" },
  { id: "earnings", label: "Earnings bridge", feeds: "Maintainable EBITDA" },
  { id: "debtors", label: "Debtors", feeds: "Borrowing base. Blocks LOI if missing" },
  { id: "human_api", label: "Human API", feeds: "Transition package and 90-day plan" },
  { id: "seller", label: "Seller position", feeds: "Earn-out ask flags the Playbook gate" },
];

const NUM_GBP = "number (GBP, no symbol)";
const PCT = "number 0-100 (percent)";
const BOOL = "boolean";
const TEXT = "string";

export const POSTCALL_FIELDS: FieldDef[] = [
  // Gate 1 — Non-discretionary
  { key: "obligation_name", label: "Obligation (statute / code)", section: "g1", shape: TEXT, question: "Which statute, regulation or code obliges customers to buy this service?" },
  { key: "retest_interval", label: "Re-test interval", section: "g1", shape: TEXT, question: "How often does the regulation require the test or service to be repeated?" },
  { key: "customer_type", label: "Customer type", section: "g1", shape: TEXT, question: "Who are the customers: businesses, landlords, public bodies or consumers?" },
  { key: "duty_holder_confirmed", label: "Customer is the duty-holder", section: "g1", shape: BOOL, question: "Is the paying customer the legal duty-holder for the obligation?" },

  // Gate 2 — B2B contracted recurring
  { key: "rev_contracted_gbp", label: "Contracted revenue", section: "g2", shape: NUM_GBP, question: "How much annual revenue is under written contract?" },
  { key: "rev_scheduled_gbp", label: "Scheduled repeat revenue", section: "g2", shape: NUM_GBP, question: "How much annual revenue is scheduled repeat work without a contract?" },
  { key: "rev_oneoff_gbp", label: "One-off revenue", section: "g2", shape: NUM_GBP, question: "How much annual revenue is one-off or ad hoc work?" },
  { key: "b2b_share", label: "B2B share of revenue", section: "g2", shape: PCT, question: "What share of revenue comes from business customers rather than consumers?" },
  { key: "contract_term_months", label: "Contract term (months)", section: "g2", shape: "number (months; 0 = rolling monthly)", question: "What is the typical contract term?" },
  { key: "notice_period_days", label: "Notice period (days)", section: "g2", shape: "number (days)", question: "What notice period do customers have to give to terminate?" },

  // Gate 3 — Profitable now
  { key: "ebitda_filed_y1_y3", label: "Filed EBITDA, years 1-3", section: "g3", shape: "array of up to 3 {year: string, ebitda_gbp: number}, oldest first", question: "Can you share the last three years of filed accounts?" },
  { key: "ebitda_seller_stated", label: "Seller-stated EBITDA", section: "g3", shape: NUM_GBP, question: "What does the seller state current EBITDA to be?" },
  { key: "addbacks", label: "Add-backs", section: "g3", shape: "array of {description: string, amount_gbp: number, call: \"accepted\"|\"challenged\"|\"rejected\", reason: string}", question: "Can you itemise each add-back with supporting evidence?" },
  { key: "owner_pay_actual", label: "Owner pay (actual)", section: "g3", shape: NUM_GBP, question: "What does the owner currently draw in salary, dividends and benefits?" },
  { key: "owner_pay_market", label: "Owner pay (market replacement)", section: "g3", shape: NUM_GBP, question: "What would a replacement manager for the owner's role cost?" },
  { key: "years_trading", label: "Years trading", section: "g3", shape: "number (years)", question: "How long has the business been trading?" },
  { key: "maintainable_ebitda_gbp", label: "Maintainable EBITDA", section: "g3", shape: NUM_GBP, question: "Can you provide the management accounts needed to confirm maintainable earnings?" },

  // Gate 4 — Concentration
  { key: "customers", label: "Customers", section: "g4", shape: "array of {name: string, revenue_gbp: number|null, contract: string|null, renewal: string|null, relationship_owner: string|null}", question: "Can you provide a customer list with annual revenue, contract and renewal date for each?" },
  { key: "largest_pct", label: "Largest customer share", section: "g4", shape: PCT, question: "What share of revenue comes from the largest customer, counting frameworks as one buyer?" },
  { key: "top3_pct", label: "Top-3 customer share", section: "g4", shape: PCT, question: "What share of revenue comes from the three largest customers combined?" },
  { key: "framework_flag", label: "Framework revenue present", section: "g4", shape: BOOL, question: "Is any revenue won through a framework agreement, and with which buyer?" },

  // Gate 5 — Transferable
  { key: "second_tier_manager", label: "Second-tier manager", section: "g5", shape: TEXT, question: "Who runs the business day to day below the owner?" },
  { key: "breaks_in_90_days", label: "What breaks in 90 days", section: "g5", shape: TEXT, question: "If the owner stepped away, what would break within 90 days?" },
  { key: "key_persons", label: "Key persons", section: "g5", shape: "array of {name: string, role: string, dependency: string}", question: "Who are the key people the business depends on, and for what?" },
  { key: "manager_installable_90d", label: "Manager installable in window", section: "g5", shape: BOOL, question: "Could a manager be put in place to run the business within the first three months?" },
  { key: "seller_stay_months", label: "Seller stay (months)", section: "g5", shape: "number (months)", question: "How long is the seller willing to stay on after completion?" },

  // Gate 6 — Ledger type
  { key: "ledger_type", label: "Ledger type", section: "g6", shape: "\"service_invoice\" | \"applications_for_payment\" | \"project_staged\" | \"mixed\"", question: "Are invoices raised per service visit, or on applications for payment or project stages?" },

  // Gate 7 — Accreditation
  { key: "accreditations", label: "Accreditations", section: "g7", shape: "array of {name: string, holder: \"company\" | \"person\", person_name: string|null}", question: "Which accreditations, permits and registrations does the business rely on, and who holds each?" },
  { key: "holder_12m_stay", label: "Personal holder commits to stay", section: "g7", shape: BOOL, question: "Will any individual accreditation holder commit to stay on after completion?" },

  // Gate 8 — Other hard kills
  { key: "enforcement", label: "Regulatory enforcement", section: "g8", shape: "boolean (true = present)", question: "Has the business had any regulatory enforcement action or notices?" },
  { key: "litigation", label: "Litigation", section: "g8", shape: "boolean (true = present)", question: "Is there any current or threatened litigation?" },
  { key: "structural_decline", label: "Structural decline", section: "g8", shape: "boolean (true = present)", question: "Is demand for the core service shrinking for reasons outside the business's control?" },
  { key: "hmrc_liability", label: "HMRC liability", section: "g8", shape: "boolean (true = present)", question: "Are there any overdue HMRC liabilities or time-to-pay arrangements?" },
  { key: "sic_hard_stop", label: "SIC hard stop", section: "g8", shape: "boolean (true = present)", question: "Which SIC codes is the company registered under?" },
  { key: "misrepresentation", label: "Misrepresentation", section: "g8", shape: "boolean (true = present)", question: "Can the figures and claims discussed be supported with documents?" },

  // Price and condition inputs
  { key: "debtors_aged", label: "Aged debtors", section: "debtors", shape: "{bands: [{band: string, amount_gbp: number}], contracted_or_staged_gbp: number|null, invoice_and_forget_gbp: number|null, over_60_days_gbp: number|null}", question: "Can you share an aged debtors report, split by contracted and one-off work?" },
  { key: "hapi_last_job_wrong", label: "Last job that went wrong", section: "human_api", shape: TEXT, question: "Tell us about the last job that went wrong and how it was handled." },
  { key: "hapi_top_customer_retender", label: "If the top customer re-tenders", section: "human_api", shape: TEXT, question: "What happens if the top customer re-tenders the contract?" },
  { key: "hapi_unique_knowledge", label: "Who knows what nobody else knows", section: "human_api", shape: TEXT, question: "Who holds knowledge that nobody else in the business has?" },
  { key: "sale_reason", label: "Reason for sale", section: "seller", shape: TEXT, question: "Why is the owner selling now?" },
  { key: "sale_timing", label: "Timing", section: "seller", shape: TEXT, question: "What timetable is the seller working to?" },
  { key: "other_buyers", label: "Other buyers", section: "seller", shape: TEXT, question: "Are other buyers in discussions, and at what stage?" },
  { key: "transition_wish", label: "Transition wish", section: "seller", shape: TEXT, question: "What role, if any, does the seller want after completion?" },
  { key: "structure_asks", label: "Structure asks", section: "seller", shape: TEXT, question: "Does the seller have any requirements on how the deal is structured?" },
  { key: "earnout_ask", label: "Earn-out asked", section: "seller", shape: BOOL, question: "Has the seller raised an earn-out?" },
];

export const FIELD_KEYS = POSTCALL_FIELDS.map((f) => f.key);
export const FIELD_BY_KEY: Record<string, FieldDef> = Object.fromEntries(POSTCALL_FIELDS.map((f) => [f.key, f]));

export interface GateDef {
  id: number;
  name: string;
  question: string;
  inputs: string[];
  /** Each group needs at least one known field before the gate may pass. */
  passNeeds: string[][];
  pass: string;
  fail: string;
}

export const GATES: GateDef[] = [
  {
    id: 1, name: "Non-discretionary", question: "Is the customer legally forced to buy this on a schedule?",
    inputs: ["obligation_name", "retest_interval", "customer_type", "duty_holder_confirmed"],
    passNeeds: [["obligation_name"], ["retest_interval"], ["duty_holder_confirmed"]],
    pass: "Named statute or code, fixed re-test interval, customer is the duty-holder",
    fail: "Bought by choice, or buyer is the end user",
  },
  {
    id: 2, name: "B2B contracted recurring", question: "How much revenue is contracted or scheduled repeat from businesses?",
    inputs: ["rev_contracted_gbp", "rev_scheduled_gbp", "rev_oneoff_gbp", "b2b_share", "contract_term_months", "notice_period_days"],
    passNeeds: [["rev_contracted_gbp", "rev_scheduled_gbp"], ["b2b_share"]],
    pass: "Recurring (contracted + scheduled) share of revenue at or above recurring_gate, B2B",
    fail: "Below recurring_gate, mainly B2C, or rolling monthly with no term",
  },
  {
    id: 3, name: "Profitable now", question: "Is it profitable today on filed accounts?",
    inputs: ["ebitda_filed_y1_y3", "ebitda_seller_stated", "addbacks", "owner_pay_actual", "owner_pay_market", "years_trading", "maintainable_ebitda_gbp"],
    passNeeds: [["ebitda_filed_y1_y3"], ["maintainable_ebitda_gbp"]],
    pass: "Maintainable EBITDA positive and within ebitda_band",
    fail: "Loss-making, or profit only after rejected add-backs or forecasts",
  },
  {
    id: 4, name: "Concentration", question: "Would losing one customer break it?",
    inputs: ["customers", "largest_pct", "top3_pct", "framework_flag"],
    passNeeds: [["largest_pct"], ["top3_pct"]],
    pass: "Within concentration_largest and concentration_top3, or within institutional_band",
    fail: "Above bands, including frameworks aggregated to one buyer",
  },
  {
    id: 5, name: "Transferable", question: "Does it work without the seller?",
    inputs: ["second_tier_manager", "breaks_in_90_days", "key_persons", "manager_installable_90d", "seller_stay_months"],
    passNeeds: [["manager_installable_90d"]],
    pass: "Manager installable within manager_install_days",
    fail: "Founder is sole competency and will not transition",
  },
  {
    id: 6, name: "Ledger type", question: "Are invoices raised on service or on applications for payment?",
    inputs: ["ledger_type"],
    passNeeds: [["ledger_type"]],
    pass: "Service invoice",
    fail: "Applications for payment or project-staged",
  },
  {
    id: 7, name: "Accreditation", question: "Who holds each accreditation, permit or registration?",
    inputs: ["accreditations", "holder_12m_stay"],
    passNeeds: [["accreditations"]],
    pass: "Held by the company, or holder commits to an accreditation_stay_months stay",
    fail: "Held personally with no commitment to stay accreditation_stay_months",
  },
  {
    id: 8, name: "Other hard kills", question: "Anything that kills regardless of the rest?",
    inputs: ["enforcement", "litigation", "structural_decline", "hmrc_liability", "sic_hard_stop", "misrepresentation"],
    passNeeds: [["enforcement"], ["litigation"], ["structural_decline"], ["hmrc_liability"], ["sic_hard_stop"], ["misrepresentation"]],
    pass: "None present",
    fail: "Any confirmed",
  },
];

/** A row of the versioned `playbook_config` table (migration 0018). */
export interface PlaybookConfig {
  version: number;
  recurring_gate_pct: number | null;
  ebitda_band_min_gbp: number | null;
  ebitda_band_max_gbp: number | null;
  concentration_largest_pct: number | null;
  concentration_top3_pct: number | null;
  accreditation_stay_months: number | null;
  manager_install_days: number | null;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string;
}

export const PLAYBOOK_KEYS = [
  "recurring_gate_pct",
  "ebitda_band_min_gbp",
  "ebitda_band_max_gbp",
  "concentration_largest_pct",
  "concentration_top3_pct",
  "accreditation_stay_months",
  "manager_install_days",
] as const;
export type PlaybookKey = (typeof PLAYBOOK_KEYS)[number];

export interface ScorecardField {
  value: unknown;
  status: FieldStatus;
  source: string | null;
  box: FieldBox;
  next_action: string | null;
}

export interface ScorecardGate {
  id: number;
  name: string;
  result: GateResult;
  /** What Claude returned, before the engine's rules were applied. */
  claude_result: GateResult;
  /** Machine codes for each rule the engine applied to this gate. */
  adjustments: string[];
}

/** What a post-call run stores in postcall_briefs.brief_data. */
export interface Scorecard {
  spec: "acp-postcall-v1";
  deal_id: string;
  playbook_version: number;
  playbook: PlaybookConfig;
  institutional_band_pct: number | null;
  input_kind: "transcript" | "notes";
  precall_brief_id: string | null;
  verdict: Verdict;
  kill_gates: number[];
  gates: ScorecardGate[];
  fields: Record<string, ScorecardField>;
  completeness: { known: number; required: number; pct: number };
  info_request: Array<{ field: string; question: string }>;
  loi_ready: boolean;
  loi_blockers: Array<"dscr_sanction_missing" | "verdict_kill" | "debtors_missing">;
  earnout_flag: boolean;
  broker_email: { subject: string; body: string; figures_allowed: boolean; withheld: number };
  /** Field-level rule applications, e.g. {field, code: "source_missing"}. */
  field_adjustments: Array<{ field: string; code: string }>;
}
