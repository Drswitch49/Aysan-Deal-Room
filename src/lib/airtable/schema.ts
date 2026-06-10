export const TABLES = {
  LENDERS: "Lenders",
  PIPELINE: "Active_Pipeline",
  DOCUMENTS: "Documents",
  SUBMISSIONS: "Submission_Log",
  ASSIGNMENTS: "Lender_Deal_Assignments",
  CHAT: "Chat_Messages",
  TEAM: "ACP_Team",
  HIRING: "Hiring_Briefs",
  STAKEHOLDERS: "External_Stakeholders",
  DEAL_INBOX: "Deal_Inbox",
  TRANSCRIPT_ANALYSES: "Transcript_Analyses",
  PRECALL_BRIEFS: "Precall_Briefs",
  POSTCALL_BRIEFS: "Postcall_Briefs",
  STAGE_HISTORY: "Deal_Stage_History",
  PORTFOLIO_METRICS: "Portfolio_Metrics",
  PORTFOLIO_ALERTS: "Portfolio_Alerts",
  PORTFOLIO_HEALTH: "Portfolio_Health",
};

// ─── Canonical Deal Stages ────────────────────────────────────────────────────
// Source of truth for stage names used in UI, comparisons, and reporting.
// The full state machine lives in api/_services/deal-lifecycle.ts

export type DealStage =
  | "INTRO"
  | "DISCOVERY"
  | "LOI"
  | "DUE_DILIGENCE"
  | "CLOSING"
  | "PORTFOLIO"
  | "KILLED";

export type UserRole = "analyst" | "manager" | "admin";

export const CANONICAL_STAGES: DealStage[] = [
  "INTRO",
  "DISCOVERY",
  "LOI",
  "DUE_DILIGENCE",
  "CLOSING",
  "PORTFOLIO",
];

/** Human-readable labels for display */
export const STAGE_LABELS: Record<DealStage, string> = {
  INTRO: "Intro",
  DISCOVERY: "Discovery",
  LOI: "LOI",
  DUE_DILIGENCE: "Due Diligence",
  CLOSING: "Closing",
  PORTFOLIO: "Portfolio",
  KILLED: "Killed",
};

export const SAFE_DOCUMENT_FIELDS = [
  "Deal_Ref", "Deal Ref", "Deal Reference",
  "Document_Name", "Document Name", "Name",
  "Category", "category",
  "ABL_Critical", "ABL Critical", "abl_critical", "abl critical", "Critical",
  "Status", "status", "Stage",
  "Source", "source",
  "Date_Received", "Date Received", "date_received", "date received", "Date",
  "drive link", "Drive Link", "Drive_Link", "drive_link", "Link", "link",
  "Expected_Date", "Expected Date", "expected_date", "expected date",
  "Date_Sent_To_Lender", "Date Sent To Lender", "date_sent_to_lender", "date sent to lender",
  "Lender_Target", "Lender Target"
];

export const SAFE_PIPELINE_FIELDS = [
  "REF No.", "Ref No.", "Deal_Ref", "Deal Ref", "Deal Reference", "Deal Name",
  "Company_Name", "Company Name", "company name", "Company",
  "Status", "Deal_Status", "Deal Status", "Stage",
  "Location", "Company Location", "HQ", "Headquarters",
  "Sector", "Industry",
  "EV", "Enterprise Value", "Enterprise_Value", "EV Multiple",
  "DSCR_Base", "DSCR Base", "DSCR base", "DSCR_Proxy", "DSCR Proxy",
  "DSCR_Stress", "DSCR Stress", "DSCR stress", "DSCR_SCORE", "DSCR Score",
  "Post_Completion_Roles", "Post-Completion Roles", "Post Completion Roles",
  "Senior_Debt", "Senior Debt", "Senior Debt Amount",
  "Sub_Debt", "Sub Debt", "Subordinated Debt",
  "Equity", "Equity Amount",
  "Seller_Note", "Seller Note",
  "Deal Files", "Deal_Files", "deal_files", "Deal Link", "Drive_Link", "Drive Link",
  // Financial Intelligence Engine Fields
  "EBITDA", "DSCR", "Leverage_Ratio", "Enterprise_Value", "Deal_Score", 
  "Financial_Risk_Score", "Financial_Analysis_Status", "Financial_Insights", 
  "Financial_Anomalies", "Financial_Completed_At"
];
