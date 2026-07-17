/**
 * Map Supabase rows → the frontend view models (Phase 6).
 *
 * Pages were written against Airtable-shaped view models (PipelineDeal etc.).
 * These mappers adapt the new API's rows to those shapes — including a
 * compatibility `rawFields` object carrying the Airtable-style keys pages
 * still read — so the page layer keeps working while it is decomposed.
 */
import type { DealDocument, PipelineDeal, SubmissionLogEntry, ChatMessage } from "../types/deal";

type Row = Record<string, any>;

const money = (v: unknown): string => (v == null || v === "" ? "" : String(v));

/** Airtable-style rawFields compatibility view over a Supabase deal row. */
function compatRawFields(d: Row): Record<string, any> {
  const verdict = d.claude_verdict ?? "";
  return {
    // identity
    "REF No.": d.ref_no ?? "",
    "ACP REF NO": d.acp_ref_no ?? "",
    Company_Name: d.company_name ?? d.deal_name ?? "",
    "Deal Name": d.deal_name ?? "",
    Stage: d.pipeline_stage ?? d.stage ?? "",
    // financials
    EV: d.enterprise_value ?? "",
    Enterprise_Value: d.enterprise_value ?? "",
    "EV Multiple": d.enterprise_value && d.ebitda_gbp ? (Number(d.enterprise_value) / Number(d.ebitda_gbp)).toFixed(2) : "",
    EBITDA_GBP: d.ebitda_gbp ?? "",
    Asking_Price_GBP: d.asking_price_gbp ?? "",
    Turnover: d.turnover ?? "",
    // contacts / people
    Owner: d.owner ?? "",
    "Contact Name": d.broker ?? "",
    "Contact Email": d.contact_email ?? "",
    "Broker Name": d.broker ?? "",
    "Broker Email": d.contact_email ?? "",
    Website: d.website ?? "",
    website: d.website ?? "",
    source: d.source ?? "",
    // workflow
    "Next Action": d.next_action ?? "",
    "Next Action Date": d.next_action_date ?? "",
    Internal_Notes: d.internal_notes ?? "",
    Executive_Summary: d.executive_summary ?? "",
    Business_Description: d.business_description ?? "",
    // AI / enrichment
    Claude_Verdict: verdict,
    OSINT_Status: d.osint_status ?? "",
    OSINT_Summary: d.osint_summary ?? "",
    Financial_Analysis_Status: d.financial_analysis_status ?? "",
    Financial_Anomalies: d.financial_anomalies ?? "",
    // files (Cloudinary-backed now)
    IM_Review_Documents: d.deal_files_secure_url ? [{ url: d.deal_files_secure_url, filename: "Deal file" }] : [],
    "Deal Files": d.deal_files_secure_url ?? d.deal_files_url ?? "",
    // raw row for anything else
    __row: d,
  };
}

export function mapDeal(d: Row): PipelineDeal {
  return {
    id: d.id,
    dealRef: d.acp_ref_no || d.ref_no || d.id,
    companyName: d.company_name || d.deal_name || "Unnamed",
    status: d.pipeline_stage || d.stage || "",
    location: d.location || "",
    sector: d.sector || d.industry || "",
    ev: money(d.enterprise_value),
    dscrBase: money(d.dscr_proxy),
    dscrStress: money(d.dscr_score),
    broker: d.broker || "",
    lenderAssigned: "",
    vendorNames: "",
    postCompletionRoles: "",
    capitalStructure: [],
    rawFields: compatRawFields(d) as PipelineDeal["rawFields"],
    dealFiles: d.deal_files_secure_url || d.deal_files_url || "",
    // enriched
    revenue: money(d.turnover),
    ebitda: money(d.ebitda_gbp),
    evAsk: money(d.enterprise_value ?? d.asking_price_gbp),
    multiplier:
      d.enterprise_value && d.ebitda_gbp && Number(d.ebitda_gbp) !== 0
        ? (Number(d.enterprise_value) / Number(d.ebitda_gbp)).toFixed(2)
        : "",
    ownerName: d.owner || d.assigned_to || "",
    ownerInitials: (d.owner || d.assigned_to || "")
      .split(/\s+/)
      .map((w: string) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    nextActionTitle: d.next_action || "",
    actionDate: d.next_action_date || "",
    archived: d.stage === "archived",
    // overview / portal fields
    listingLink: d.listing_link || "",
    contactEmail: d.contact_email || "",
    contactPhone: d.contact_phone || "",
    turnover: money(d.turnover),
    executiveSummary: d.executive_summary || "",
    businessDescription: d.business_description || "",
    lenderExecutiveSummary: d.lender_executive_summary || "",
    dealType: d.deal_type || "",
    investmentHighlights: d.investment_highlights || "",
    acquisitionRationale: d.acquisition_rationale || "",
  };
}

export function mapDocument(r: Row): DealDocument {
  return {
    id: r.id,
    dealRef: r.deal_id ?? "",
    documentName: r.document_name ?? "",
    category: r.category ?? "",
    ablCritical: Boolean(r.abl_critical),
    status: r.status ?? "",
    source: r.source ?? "",
    dateReceived: r.date_received ?? "",
    driveLink: r.file_url ?? r.legacy_drive_link ?? "",
    expectedDate: r.expected_date ?? "",
    internalNotes: r.internal_notes ?? "",
    dateSentToLender: r.date_sent_to_lender ?? "",
    lenderTarget: r.lender_target ?? "",
    documentAccess: r.document_access ?? "",
  };
}

export function mapSubmission(r: Row): SubmissionLogEntry {
  return {
    id: r.id,
    dealRef: r.deal_id ?? "",
    date: r.submitted_on ?? "",
    whatWasSent: r.what_was_sent ?? "",
    sentTo: r.sent_to ?? "",
    sentVia: r.sent_via ?? "",
    responseReceived: r.response_received ?? "",
    flag: r.flag ?? "",
  };
}

export function mapChatMessage(r: Row): ChatMessage {
  return {
    id: r.id,
    dealId: r.deal_id ?? "",
    lenderId: r.lender_id ?? "",
    sender: r.sender ?? "",
    message: r.message ?? "",
    timestamp: r.created_at ?? "",
  };
}
