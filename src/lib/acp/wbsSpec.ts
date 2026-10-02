/**
 * Lane 2 · Wellbeing Services (WBS) — the field, gate and dimension catalogue
 * from "ACP Deal OS: WBS Scoring Engine and Deal Intelligence Page
 * Optimisation Brief v1.1", sections 2, 3 and 7.
 *
 * Shared by the prompt, the engine (lib/postcall/wbs.ts) and the Post-call
 * tab. Lane 1 (CFS) keeps its own catalogue in postcallSpec.ts, untouched.
 *
 * Gates kill; the score prices. Thresholds and weights are never hardcoded
 * into a decision: they come from the signed WBS Playbook config. The values
 * below are only the PROPOSED v2 seed (section 3) that Dami signs; until a
 * config is signed every gate and dimension returns UNSCORED.
 */

// ─── Lanes ─────────────────────────────────────────────────────────────────
export const LANES = ["lane_1_cfs", "lane_2_wbs"] as const;
export type Lane = (typeof LANES)[number];

export const LANE_LABELS: Record<Lane, string> = {
  lane_1_cfs: "Lane 1 · Compliance Services (CFS)",
  lane_2_wbs: "Lane 2 · Wellbeing Services (WBS)",
};

export const WBS_SUBSECTORS = [
  "physio_msk_chiro",
  "diagnostics_longevity",
  "medical_aesthetics",
  "occupational_health",
  "corporate_wellbeing",
  "recovery_performance",
  "other",
] as const;
export type WbsSubsector = (typeof WBS_SUBSECTORS)[number];

export const WBS_SUBSECTOR_LABELS: Record<WbsSubsector, string> = {
  physio_msk_chiro: "Physio / MSK / chiro",
  diagnostics_longevity: "Diagnostics / longevity",
  medical_aesthetics: "Medical aesthetics",
  occupational_health: "Occupational health",
  corporate_wellbeing: "Corporate wellbeing",
  recovery_performance: "Recovery and performance",
  other: "Other",
};

/** Run type decides which evidence is admissible (section 2). */
export const RUN_TYPES = ["pre_call", "post_call", "post_document"] as const;
export type RunType = (typeof RUN_TYPES)[number];
export const RUN_TYPE_LABELS: Record<RunType, string> = {
  pre_call: "Pre-call",
  post_call: "Post-call",
  post_document: "Post-document",
};

/**
 * `deals.lane` is the smallint migration 0024 added for the investor portal
 * (1 statutory compliance, 2 regulated clinical); the same lane, so the scorer
 * reads and writes it rather than keeping a second column. Null = Lane 1.
 */
export function laneFromDeal(v: unknown): Lane {
  return v === 2 || v === "2" || v === "lane_2_wbs" ? "lane_2_wbs" : "lane_1_cfs";
}
export function laneToDeal(lane: Lane): 1 | 2 {
  return lane === "lane_2_wbs" ? 2 : 1;
}

/** Header badge: `LANE 2 · WBS · <sub-sector>`. */
export function laneBadge(lane: Lane | null | undefined, subsector?: WbsSubsector | null): string {
  if (lane === "lane_2_wbs") return `LANE 2 · WBS${subsector ? ` · ${WBS_SUBSECTOR_LABELS[subsector]}` : ""}`;
  return "LANE 1 · CFS";
}

// ─── Evidence tags + cash models (section 7 enums) ─────────────────────────
export const EVIDENCE_TAGS = ["filed", "mgmt", "verified", "vendor", "estimated", "assumption", "unknown"] as const;
export type EvidenceTag = (typeof EVIDENCE_TAGS)[number];

/**
 * Evidence each run type may rely on. A gate can only FAIL on admissible
 * evidence; anything else leaves it OPEN. ESTIMATED and ASSUMPTION are never
 * admissible for a FAIL in any run type.
 */
export const ADMISSIBLE_EVIDENCE: Record<RunType, EvidenceTag[]> = {
  pre_call: ["filed", "verified"],
  post_call: ["filed", "verified", "vendor", "mgmt"],
  post_document: ["filed", "verified", "vendor", "mgmt"],
};

export const CASH_MODELS = [
  "point_of_sale",
  "direct_debit_membership",
  "prepaid_plan",
  "insurer_billed",
  "corporate_invoice",
  "service_invoice",
  "applications_for_payment",
  "project_staged",
] as const;
export type CashModel = (typeof CASH_MODELS)[number];

/** Consumer-paid models: no debtor book, so deferred income replaces debtors as the LOI input. */
export const B2C_CASH_MODELS: CashModel[] = ["point_of_sale", "direct_debit_membership", "prepaid_plan"];
/** H2: these billing models are not fundable. */
export const UNFUNDABLE_CASH_MODELS: CashModel[] = ["applications_for_payment", "project_staged"];

// ─── Field set (section 7: "WBS field set") ────────────────────────────────
export type WbsSectionId = "earnings" | "revenue" | "workforce" | "transfer" | "regulatory" | "finance" | "growth" | "human_api" | "seller";

export const WBS_SECTIONS: Array<{ id: WbsSectionId; label: string; feeds: string }> = [
  { id: "earnings", label: "Earnings", feeds: "H1 · D2" },
  { id: "revenue", label: "Revenue quality", feeds: "H2 · D1" },
  { id: "workforce", label: "Workforce", feeds: "H7 · D3" },
  { id: "transfer", label: "Transferability", feeds: "H5 · H6 · D4" },
  { id: "regulatory", label: "Regulatory and clinical", feeds: "H3 · H4 · H8 · H9 · D6" },
  { id: "finance", label: "Financeability", feeds: "D5 · LOI" },
  { id: "growth", label: "Growth and fit", feeds: "D7" },
  { id: "human_api", label: "Human API", feeds: "Second-call agenda" },
  { id: "seller", label: "Seller position", feeds: "Negotiation Engine" },
];

export interface WbsFieldDef {
  key: string;
  label: string;
  section: WbsSectionId;
  shape: string;
  /** Lane question bank (section 6e): plain English, one line, no figures. */
  question: string;
  /** Second-call agenda only: never asked of a broker (section 6e). */
  sellerOnly?: boolean;
  /** Schedule A merge key: fields sharing a source document become one ask. */
  doc?: string;
  /** Gates and dimensions this field feeds (drives Schedule A priority, 6d). */
  feeds: Array<WbsGateId | WbsDimId | "loi">;
}

const GBP = "number (GBP, no symbol)";
const PCT = "number 0-100 (percent)";
const BOOL = "boolean";
const TEXT = "string";

export const WBS_FIELDS: WbsFieldDef[] = [
  // Earnings
  { key: "ebitda_filed_y1_y3", label: "Filed EBITDA, years 1-3", section: "earnings", shape: "array of up to 3 {year: string, ebitda_gbp: number}, oldest first", question: "Company number and the last three filed accounts", doc: "filed_accounts", feeds: ["H1", "D2"] },
  { key: "turnover_y1_y3", label: "Turnover, years 1-3", section: "earnings", shape: "array of up to 3 {year: string, turnover_gbp: number}, oldest first", question: "Company number and the last three filed accounts", doc: "filed_accounts", feeds: ["D2"] },
  { key: "ebitda_seller_stated", label: "Seller-stated adjusted EBITDA", section: "earnings", shape: GBP, question: "Adjustment bridge from statutory profit, with directors' total pay", doc: "addback_bridge", feeds: ["D2", "loi"] },
  { key: "addbacks", label: "Add-backs", section: "earnings", shape: "array of {description: string, amount_gbp: number, call: \"accepted\"|\"challenged\"|\"rejected\", reason: string}", question: "Adjustment bridge from statutory profit, with directors' total pay", doc: "addback_bridge", feeds: ["D2", "loi"] },
  { key: "addback_haircut_pct", label: "Add-back haircut", section: "earnings", shape: PCT, question: "Adjustment bridge from statutory profit, with directors' total pay", doc: "addback_bridge", feeds: ["D2", "loi"] },
  { key: "owner_pay_total", label: "Directors' total pay", section: "earnings", shape: GBP, question: "Adjustment bridge from statutory profit, with directors' total pay", doc: "addback_bridge", feeds: ["D2", "loi"] },
  { key: "owner_replacement_cost", label: "Owner replacement cost", section: "earnings", shape: GBP, question: "What would a clinical or practice manager to replace the owners' roles cost?", feeds: ["D2"] },
  { key: "maintainable_ebitda_cases", label: "Maintainable EBITDA (cases)", section: "earnings", shape: "{conservative_gbp: number, base_gbp: number, upside_gbp: number}", question: "Adjustment bridge from statutory profit, with directors' total pay", doc: "addback_bridge", feeds: ["D2", "loi"] },
  { key: "fcf_conversion_pct", label: "Free cash flow conversion", section: "earnings", shape: PCT, question: "Monthly management accounts with cash flow for the last 24 months", doc: "mgmt_accounts", feeds: ["D2"] },
  { key: "cost_of_sales_trend", label: "Cost of sales trend", section: "earnings", shape: TEXT, question: "What drove the rise in cost of sales over the last three years?", feeds: ["D2"] },

  // Revenue quality
  { key: "cash_model", label: "Cash model", section: "revenue", shape: `one of ${CASH_MODELS.map((c) => `"${c}"`).join(" | ")}`, question: "Membership and care plan terms, including refunds", doc: "plan_terms", feeds: ["H2", "loi"] },
  { key: "recurring_pct", label: "Recurring revenue share", section: "revenue", shape: PCT, question: "Monthly member count, joiners and leavers, last 24 months", doc: "membership_data", feeds: ["D1"] },
  { key: "member_count_monthly", label: "Member count by month", section: "revenue", shape: "array of {month: string, count: number}", question: "Monthly member count, joiners and leavers, last 24 months", doc: "membership_data", feeds: ["D1"] },
  { key: "member_churn_monthly", label: "Monthly member churn", section: "revenue", shape: PCT, question: "Monthly member count, joiners and leavers, last 24 months", doc: "membership_data", feeds: ["D1"] },
  { key: "new_patient_conversion", label: "New patient conversion", section: "revenue", shape: PCT, question: "New patients by month and conversion to membership", feeds: ["D1"] },
  { key: "min_term_months", label: "Minimum plan term (months)", section: "revenue", shape: "number (months)", question: "Membership and care plan terms, including refunds", doc: "plan_terms", feeds: ["D1"] },
  { key: "notice_days", label: "Plan notice (days)", section: "revenue", shape: "number (days)", question: "Membership and care plan terms, including refunds", doc: "plan_terms", feeds: ["D1"] },
  { key: "insurer_corporate_share", label: "Insurer / employer / NHS share", section: "revenue", shape: PCT, question: "Revenue from insurers, employers or NHS", feeds: ["H7", "D1"] },

  // Workforce
  { key: "top_practitioner_rev_pct", label: "Top practitioner share", section: "workforce", shape: PCT, question: "Revenue by practitioner, anonymised", feeds: ["H7", "D3"] },
  { key: "subcontracted_practitioner_pct", label: "Subcontracted practitioners", section: "workforce", shape: PCT, question: "Subcontractor agreements and the status opinion", doc: "subcontractors", feeds: ["D3"] },
  { key: "non_solicit_coverage_pct", label: "Non-solicit coverage", section: "workforce", shape: PCT, question: "Subcontractor agreements and the status opinion", doc: "subcontractors", feeds: ["D3"] },

  // Transferability
  { key: "owner_clinical_caseload_pct", label: "Owner clinical caseload", section: "transfer", shape: PCT, question: "What share of clinical sessions do the owners deliver themselves?", feeds: ["D4"] },
  { key: "ip_owned_by_company", label: "Operating IP and systems", section: "transfer", shape: "\"owned\" | \"long_term_licence\" | \"rolling_licence\" | \"refused\"", question: "Licence agreement for systems, and where patient records are held", doc: "licence", feeds: ["H6", "D4"] },
  { key: "patient_data_controller", label: "Patient data controller", section: "transfer", shape: "\"company\" | \"seller_entity\" | \"third_party\"", question: "Licence agreement for systems, and where patient records are held", doc: "licence", feeds: ["H6", "D4"] },
  { key: "manager_in_post", label: "Clinical / practice manager in post", section: "transfer", shape: BOOL, question: "Who runs the clinic day to day below the owners?", feeds: ["D4"] },
  { key: "accreditations", label: "Registrations held personally", section: "transfer", shape: "array of {name: string, holder: \"company\" | \"person\", person_name: string|null, revenue_critical: boolean}", question: "Registrations held, by whom, and any open regulatory matters", doc: "registrations", feeds: ["H5"] },
  { key: "holder_12m_stay", label: "Personal holder commits 12 months", section: "transfer", shape: BOOL, question: "Registrations held, by whom, and any open regulatory matters", doc: "registrations", feeds: ["H5"] },

  // Regulatory and clinical
  { key: "regulator_registrations", label: "Regulator registrations", section: "regulatory", shape: "{held: [{regulator: string, registration: string, holder: string}], missing_required: boolean|null, open_matters: boolean|null}", question: "Registrations held, by whom, and any open regulatory matters", doc: "registrations", feeds: ["H4"] },
  { key: "enforcement", label: "Unresolved enforcement", section: "regulatory", shape: "boolean (true = present)", question: "Registrations held, by whom, and any open regulatory matters", doc: "registrations", feeds: ["H4"] },
  { key: "patient_facing_conditions", label: "Patient-facing conditions", section: "regulatory", shape: "array of {condition: string, met: boolean|null}, one per Playbook condition listed in the prompt", question: "How are clinical standards, consent and safeguarding governed day to day?", feeds: ["H3"] },
  { key: "clinical_rating", label: "Clinical rating", section: "regulatory", shape: "\"outstanding\" | \"good\" | \"requires_improvement\" | \"inadequate\" | \"not_rated\"", question: "Registrations held, by whom, and any open regulatory matters", doc: "registrations", feeds: ["D6"] },
  { key: "complaints_open", label: "Open complaints or concerns", section: "regulatory", shape: "boolean (true = open)", question: "Are any patient complaints or clinical concerns open?", feeds: ["D6"] },
  { key: "sic_hard_stop", label: "SIC hard stop", section: "regulatory", shape: "boolean (true = present)", question: "Company number and the last three filed accounts", doc: "filed_accounts", feeds: ["H8"] },
  { key: "insolvency", label: "Insolvency", section: "regulatory", shape: "boolean (true = present)", question: "Company number and the last three filed accounts", doc: "filed_accounts", feeds: ["H8"] },
  { key: "litigation", label: "Continuity-threatening litigation", section: "regulatory", shape: "boolean (true = present)", question: "Is there any current or threatened litigation?", feeds: ["H8"] },
  { key: "misrepresentation", label: "Material IM vs evidence conflict", section: "regulatory", shape: "boolean (true = present)", question: "Adjustment bridge from statutory profit, with directors' total pay", doc: "addback_bridge", feeds: ["H9"] },

  // Financeability
  { key: "premises_tenure", label: "Premises tenure", section: "finance", shape: "{type: \"lease\"|\"rolling\"|\"freehold\"|\"licence\", years_remaining: number|null}", question: "Landlord's lease terms", feeds: ["D5"] },
  { key: "deferred_income_gbp", label: "Deferred income", section: "finance", shape: GBP, question: "Deferred income schedule for prepaid plans", feeds: ["D5", "loi"] },
  { key: "debtors_aged", label: "Aged debtors", section: "finance", shape: "{bands: [{band: string, amount_gbp: number}], total_gbp: number|null}", question: "Aged debtors report", feeds: ["D5", "loi"] },

  // Growth and fit
  { key: "capacity_utilisation", label: "Capacity utilisation", section: "growth", shape: PCT, question: "Clinic room and practitioner utilisation by month", feeds: ["D7"] },
  { key: "cac_ltv", label: "LTV / CAC", section: "growth", shape: "number (ratio, e.g. 5 means LTV is five times CAC)", question: "Marketing spend and new patients by channel", feeds: ["D7"] },

  // Human API — second-call agenda only
  { key: "hapi_last_job_wrong", label: "Last thing that went wrong", section: "human_api", shape: TEXT, question: "Tell us about the last patient case that went wrong and how it was handled.", sellerOnly: true, feeds: [] },
  { key: "hapi_top_customer_retender", label: "If the largest payer moves", section: "human_api", shape: TEXT, question: "What happens if the largest insurer or employer contract moves?", sellerOnly: true, feeds: [] },
  { key: "hapi_unique_knowledge", label: "Who knows what nobody else knows", section: "human_api", shape: TEXT, question: "Who holds knowledge that nobody else in the clinic has?", sellerOnly: true, feeds: [] },

  // Seller position
  { key: "seller_stay_months", label: "Seller handover (months)", section: "seller", shape: "number (months)", question: "How long would the owners like to stay on after completion?", sellerOnly: true, feeds: ["D4"] },
  { key: "sale_reason", label: "Reason for sale", section: "seller", shape: TEXT, question: "Why are the owners selling now?", sellerOnly: true, feeds: [] },
  { key: "sale_timing", label: "Timing", section: "seller", shape: TEXT, question: "What timetable are the owners working to?", sellerOnly: true, feeds: [] },
  { key: "other_buyers", label: "Other buyers", section: "seller", shape: TEXT, question: "Are other buyers in discussions?", sellerOnly: true, feeds: [] },
  { key: "earnout_ask", label: "Earn-out asked", section: "seller", shape: BOOL, question: "Have the owners raised any structure requirements?", sellerOnly: true, feeds: [] },
];

export const WBS_FIELD_KEYS = WBS_FIELDS.map((f) => f.key);
export const WBS_FIELD_BY_KEY: Record<string, WbsFieldDef> = Object.fromEntries(WBS_FIELDS.map((f) => [f.key, f]));

/** Lane 1 fields the brief names as excluded from WBS completeness and Schedule A. */
export const LANE_1_ONLY_FIELDS = ["obligation_name", "retest_interval", "duty_holder_confirmed"];

// ─── Hard gates H1-H9 (section 3a) ─────────────────────────────────────────
export type WbsGateId = "H1" | "H2" | "H3" | "H4" | "H5" | "H6" | "H7" | "H8" | "H9";
export type WbsGateResult = "pass" | "fail" | "open" | "unscored";

export interface WbsGateDef {
  id: WbsGateId;
  name: string;
  failWhen: string;
  /** Evidence a FAIL must be tagged with. */
  failNeeds: EvidenceTag[];
  inputs: string[];
}

export const WBS_GATES: WbsGateDef[] = [
  { id: "H1", name: "Profitable now", failWhen: "Latest filed EBITDA ≤ 0", failNeeds: ["filed"], inputs: ["ebitda_filed_y1_y3"] },
  { id: "H2", name: "Cash model fundable", failWhen: "Applications for payment or project-staged billing", failNeeds: ["filed", "verified", "vendor"], inputs: ["cash_model"] },
  { id: "H3", name: "Patient-facing gate", failWhen: "Any Playbook condition fails", failNeeds: ["filed", "verified", "vendor"], inputs: ["patient_facing_conditions"] },
  { id: "H4", name: "Regulatory integrity", failWhen: "Unresolved enforcement or missing required registration", failNeeds: ["verified"], inputs: ["enforcement", "regulator_registrations"] },
  { id: "H5", name: "Licence holders", failWhen: "Owner holds a revenue-critical registration, no 12-month stay", failNeeds: ["vendor", "verified"], inputs: ["accreditations", "holder_12m_stay"] },
  { id: "H6", name: "Operating IP and data", failWhen: "Seller refuses ownership or long-term licence of systems and patient data", failNeeds: ["vendor"], inputs: ["ip_owned_by_company", "patient_data_controller"] },
  { id: "H7", name: "Concentration", failWhen: "Top practitioner or payer above Playbook band", failNeeds: ["verified"], inputs: ["top_practitioner_rev_pct", "insurer_corporate_share"] },
  { id: "H8", name: "Eligibility", failWhen: "SIC hard stop, insolvency, continuity-threatening litigation", failNeeds: ["filed", "verified"], inputs: ["sic_hard_stop", "insolvency", "litigation"] },
  { id: "H9", name: "Misrepresentation", failWhen: "Material IM vs evidence conflict", failNeeds: ["verified"], inputs: ["misrepresentation"] },
];

// ─── Weighted dimensions D1-D7 (section 3b) ────────────────────────────────
export type WbsDimId = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7";

/**
 * A linear metric: `full` scores 100, `zero` scores 0, linear between and
 * clamped outside. Direction follows from which end is larger. Categorical
 * metrics score from a value → score map instead.
 */
export interface LinearThreshold { full: number | null; zero: number | null }

export interface WbsMetricDef {
  key: string;
  label: string;
  /** Field the metric reads; "deal:<column>" reads a deal column instead. */
  source: string;
  kind: "linear" | "categorical" | "boolean_good" | "boolean_bad";
  /** Categorical / boolean scores (fixed by the brief's 100 / 0 descriptions). */
  map?: Record<string, number>;
}

export interface WbsDimDef {
  id: WbsDimId;
  name: string;
  weight: number;
  full: string;
  zero: string;
  metrics: WbsMetricDef[];
}

export const WBS_DIMENSIONS: WbsDimDef[] = [
  {
    id: "D1", name: "Revenue quality", weight: 20,
    full: "Recurring ≥ 60%, churn < 2%/month, min term ≥ 6 months", zero: "Recurring < 45% or churn > 3.5%",
    metrics: [
      { key: "recurring_pct", label: "Recurring share", source: "recurring_pct", kind: "linear" },
      { key: "member_churn_monthly", label: "Monthly churn", source: "member_churn_monthly", kind: "linear" },
      { key: "min_term_months", label: "Minimum term", source: "min_term_months", kind: "linear" },
    ],
  },
  {
    id: "D2", name: "Earnings quality", weight: 20,
    full: "Maintainable ≥ £250k, add-back haircut < 15%, FCF ≥ 75%", zero: "Maintainable < £150k or haircut > 35%",
    metrics: [
      { key: "maintainable_base_gbp", label: "Maintainable EBITDA (base)", source: "maintainable_ebitda_cases.base_gbp", kind: "linear" },
      { key: "addback_haircut_pct", label: "Add-back haircut", source: "addback_haircut_pct", kind: "linear" },
      { key: "fcf_conversion_pct", label: "FCF conversion", source: "fcf_conversion_pct", kind: "linear" },
    ],
  },
  {
    id: "D3", name: "Workforce resilience", weight: 15,
    full: "Top practitioner < 15%, subcontracted < 20%, non-solicits ≥ 80%", zero: "Top > 25% or subcontracted > 40%",
    metrics: [
      { key: "top_practitioner_rev_pct", label: "Top practitioner", source: "top_practitioner_rev_pct", kind: "linear" },
      { key: "subcontracted_practitioner_pct", label: "Subcontracted", source: "subcontracted_practitioner_pct", kind: "linear" },
      { key: "non_solicit_coverage_pct", label: "Non-solicits", source: "non_solicit_coverage_pct", kind: "linear" },
    ],
  },
  {
    id: "D4", name: "Transferability", weight: 15,
    full: "Owner caseload 0%, IP owned, manager in post", zero: "IP on rolling seller licence or caseload > 40%",
    metrics: [
      { key: "owner_clinical_caseload_pct", label: "Owner caseload", source: "owner_clinical_caseload_pct", kind: "linear" },
      { key: "ip_owned_by_company", label: "Operating IP", source: "ip_owned_by_company", kind: "categorical", map: { owned: 100, long_term_licence: 70, rolling_licence: 0, refused: 0 } },
      { key: "manager_in_post", label: "Manager in post", source: "manager_in_post", kind: "boolean_good" },
    ],
  },
  {
    id: "D5", name: "Financeability", weight: 15,
    full: "DSCR clears floor at 2.5x to 3.5x; lease ≥ debt term", zero: "Rolling tenancy, no collateral, DSCR < 1.0x",
    metrics: [
      { key: "dscr", label: "DSCR", source: "deal:indicative_dscr", kind: "linear" },
      { key: "lease_years_remaining", label: "Lease vs debt term", source: "premises_tenure", kind: "linear" },
      { key: "collateral", label: "Collateral (receivables)", source: "debtors_aged.total_gbp", kind: "linear" },
    ],
  },
  {
    id: "D6", name: "Clinical governance", weight: 5,
    full: "Good rating, no complaints open", zero: "Open concerns",
    metrics: [
      { key: "clinical_rating", label: "Rating", source: "clinical_rating", kind: "categorical", map: { outstanding: 100, good: 100, requires_improvement: 40, inadequate: 0 } },
      { key: "complaints_open", label: "Open complaints", source: "complaints_open", kind: "boolean_bad" },
    ],
  },
  {
    id: "D7", name: "Growth and platform fit", weight: 10,
    full: "Capacity headroom, LTV/CAC ≥ 5, ≤ 50 miles of RM11", zero: "Capacity-capped, out of radius",
    metrics: [
      { key: "capacity_utilisation", label: "Capacity utilisation", source: "capacity_utilisation", kind: "linear" },
      { key: "cac_ltv", label: "LTV / CAC", source: "cac_ltv", kind: "linear" },
      { key: "distance_rm11_miles", label: "Distance from RM11", source: "deal:distance_rm11_miles", kind: "linear" },
    ],
  },
];

/** Sub-sector weight shifts (section 3b), in weight points. */
export const SUBSECTOR_SHIFTS: Partial<Record<WbsSubsector, Partial<Record<WbsDimId, number>>>> = {
  physio_msk_chiro: { D3: 5, D6: -5 },
  diagnostics_longevity: { D5: 5, D7: -5 },
  medical_aesthetics: { D4: 5, D7: -5 },
  occupational_health: { D1: 5, D7: -5 },
  corporate_wellbeing: { D1: 5, D7: -5 },
};

// ─── Config (playbook_config row for lane_2_wbs) ───────────────────────────
export interface WbsThresholds {
  /** Linear metric end-points, keyed by metric key. */
  metrics: Record<string, LinearThreshold>;
  /** H7: top practitioner share above this fails (percent). */
  h7_practitioner_max_pct: number | null;
  /** H7: single payer (insurer / employer / NHS) share above this fails (percent). */
  h7_payer_max_pct: number | null;
  /** H3: the Playbook's patient-facing conditions, as config text. Empty = H3 stays OPEN. */
  h3_conditions: string[];
}

export type WbsWeights = Record<WbsDimId, number>;

/**
 * Proposed WBS v2 values (section 3). Seeded UNSIGNED: an unsigned config
 * scores nothing. Where the brief gives only one end of a metric (min term,
 * FCF, non-solicits, LTV/CAC), the other end is a placeholder for Dami to
 * confirm when signing — listed in `WBS_V2_PLACEHOLDERS`.
 */
export const WBS_V2_PROPOSED: { thresholds: WbsThresholds; weights: WbsWeights } = {
  thresholds: {
    metrics: {
      recurring_pct: { full: 60, zero: 45 },
      member_churn_monthly: { full: 2, zero: 3.5 },
      min_term_months: { full: 6, zero: 0 },
      maintainable_base_gbp: { full: 250_000, zero: 150_000 },
      addback_haircut_pct: { full: 15, zero: 35 },
      fcf_conversion_pct: { full: 75, zero: 40 },
      top_practitioner_rev_pct: { full: 15, zero: 25 },
      subcontracted_practitioner_pct: { full: 20, zero: 40 },
      non_solicit_coverage_pct: { full: 80, zero: 40 },
      owner_clinical_caseload_pct: { full: 0, zero: 40 },
      dscr: { full: 2.5, zero: 1.0 },
      lease_years_remaining: { full: 5, zero: 0 },
      collateral: { full: 100_000, zero: 0 },
      capacity_utilisation: { full: 70, zero: 95 },
      cac_ltv: { full: 5, zero: 1 },
      distance_rm11_miles: { full: 50, zero: 100 },
    },
    h7_practitioner_max_pct: 25,
    h7_payer_max_pct: 40,
    h3_conditions: [],
  },
  weights: { D1: 20, D2: 20, D3: 15, D4: 15, D5: 15, D6: 5, D7: 10 },
};

/** Proposed values the brief does not state outright — confirm before signing. */
export const WBS_V2_PLACEHOLDERS = [
  "min_term_months.zero", "fcf_conversion_pct.zero", "non_solicit_coverage_pct.zero",
  "lease_years_remaining (debt term 5 years)", "collateral", "capacity_utilisation", "cac_ltv.zero",
  "distance_rm11_miles.zero", "h7_practitioner_max_pct", "h7_payer_max_pct",
];

// ─── Verdict (section 3c) ──────────────────────────────────────────────────
export const WBS_VERDICTS = ["KILL", "PROVISIONAL", "ADVANCE", "PRICE_CONDITION", "HOLD", "DECLINE", "UNSCORED"] as const;
export type WbsVerdict = (typeof WBS_VERDICTS)[number];
export type WbsBand = "ADVANCE" | "PRICE_CONDITION" | "HOLD" | "DECLINE";

export const WBS_VERDICT_LABEL: Record<WbsVerdict | WbsBand, string> = {
  KILL: "Kill",
  PROVISIONAL: "Provisional",
  ADVANCE: "Advance",
  PRICE_CONDITION: "Price / Condition",
  HOLD: "Hold",
  DECLINE: "Decline",
  UNSCORED: "Unscored",
};

export function bandFor(score: number): WbsBand {
  if (score >= 75) return "ADVANCE";
  if (score >= 55) return "PRICE_CONDITION";
  if (score >= 40) return "HOLD";
  return "DECLINE";
}

// ─── Run output (stored in postcall_briefs.brief_data) ─────────────────────
export interface WbsField {
  value: unknown;
  status: EvidenceTag;
  source: string | null;
  next_action: string | null;
}

export interface WbsGate {
  id: WbsGateId;
  name: string;
  result: WbsGateResult;
  /** Shown beside OPEN: CONDITION = passes only with a deal condition. */
  qualifier: "condition" | null;
  reason: string;
  adjustments: string[];
}

export interface WbsMetricScore {
  key: string;
  label: string;
  value: number | string | boolean | null;
  score: number;
  known: boolean;
}

export interface WbsDimension {
  id: WbsDimId;
  name: string;
  weight: number;
  /** null when the config is unsigned. */
  score: number | null;
  points: number | null;
  driver: string;
  metrics: WbsMetricScore[];
}

export type LoiBlocker = "dscr_sanction_missing" | "verdict_kill" | "debtors_missing" | "deferred_income_missing";

export interface ScheduleAItem {
  ask: string;
  fields: string[];
  priority: number;
}

export interface BrokerEmail {
  subject: string;
  body: string;
  figures_allowed: boolean;
  withheld: number;
}

export interface WbsScorecard {
  spec: "acp-postcall-wbs-v1";
  lane: "lane_2_wbs";
  subsector: WbsSubsector | null;
  run_type: RunType;
  deal_id: string;
  playbook_version: number;
  config_signed: boolean;
  config_signed_by: string | null;
  config_signed_at: string | null;
  thresholds_set: number;
  input_kind: "transcript" | "notes";
  precall_brief_id: string | null;
  verdict: WbsVerdict;
  /** Indicative band behind PROVISIONAL; equals the verdict when all gates pass. */
  band: WbsBand | null;
  reason: string;
  kill_reason: WbsGateId | null;
  gates: WbsGate[];
  dimensions: WbsDimension[];
  total_score: number | null;
  confidence_pct: number;
  fields: Record<string, WbsField>;
  completeness: { known: number; required: number; pct: number };
  schedule_a: ScheduleAItem[];
  second_call_agenda: string[];
  loi_ready: boolean;
  loi_blockers: LoiBlocker[];
  earnout_flag: boolean;
  principals: string[];
  broker_email: BrokerEmail;
  field_adjustments: Array<{ field: string; code: string }>;
}
