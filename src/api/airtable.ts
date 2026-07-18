/**
 * Deal-room read client (Phase 6 — Supabase-backed REST).
 *
 * NOTE: filename kept as airtable.ts temporarily so ~20 importers don't churn
 * in the same commit; it no longer talks to Airtable. Renamed in the
 * decomposition pass.
 */
import { api, type Paginated } from "./http";
import { mapDeal, mapDocument, mapSubmission } from "./mappers";
import type { DealDocument, PipelineDeal, SubmissionLogEntry } from "../types/deal";

export function clearAirtableCache() {
  // No client cache; reads hit the API directly.
}

/** Active-pipeline deals (the main working set). */
export async function getDeals(_forceRefresh: boolean = false): Promise<PipelineDeal[]> {
  const page = await api.get<Paginated<any>>("/api/deals?stage=active&limit=200");
  return page.rows.map(mapDeal);
}

export async function getDealByRef(ref: string, _forceRefresh: boolean = false): Promise<PipelineDeal | null> {
  const page = await api.get<Paginated<any>>(`/api/deals?ref=${encodeURIComponent(ref)}`);
  return page.rows.length ? mapDeal(page.rows[0]) : null;
}

export async function getAllDocuments(): Promise<DealDocument[]> {
  const page = await api.get<Paginated<any>>("/api/documents?limit=200");
  return page.rows.map(mapDocument);
}

export async function getDocumentsForDeal(ref: string): Promise<DealDocument[]> {
  const deal = await getDealByRef(ref);
  if (!deal) return [];
  const page = await api.get<Paginated<any>>(`/api/documents?deal_id=${encodeURIComponent(deal.id)}&limit=200`);
  return page.rows.map(mapDocument);
}

export async function getAllSubmissionLog(): Promise<SubmissionLogEntry[]> {
  const page = await api.get<Paginated<any>>("/api/submissions?limit=200");
  return page.rows.map(mapSubmission);
}

export async function getSubmissionLogForDeal(ref: string): Promise<SubmissionLogEntry[]> {
  const deal = await getDealByRef(ref);
  if (!deal) return [];
  const page = await api.get<Paginated<any>>(`/api/submissions?deal_id=${encodeURIComponent(deal.id)}&limit=200`);
  return page.rows.map(mapSubmission);
}

export async function getDealByRefForLender(ref: string): Promise<PipelineDeal | null> {
  return getDealByRef(ref);
}

export async function getDocumentsForLender(ref: string): Promise<DealDocument[]> {
  const deal = await getDealByRefForLender(ref);
  if (!deal) return [];
  const docs = await getDocumentsForDeal(ref);
  return docs
    .filter((doc) => (doc.status || "").trim().toLowerCase() === "sent to lender")
    .map((doc) => (!doc.driveLink && deal.dealFiles ? { ...doc, driveLink: deal.dealFiles } : doc));
}

/** Inbox deals (lifecycle stage = inbox). Returns Airtable-style { id, fields }
 *  records — DealInboxPage/DealDetailPage read `record.fields["REF. NO"]` etc. */
export async function getDealInbox(): Promise<any[]> {
  const page = await api.get<Paginated<any>>("/api/deals?stage=inbox&limit=200&orderBy=date_added");
  return page.rows.map((d) => {
    const im = d.deal_files_secure_url ? [{ url: d.deal_files_secure_url, filename: "Deal file" }] : [];
    return {
      id: d.id,
      fields: {
        "REF. NO": d.ref_no ?? "",
        "Deal Name": d.deal_name ?? "",
        "Company Name": d.company_name ?? d.deal_name ?? "",
        Company_Name: d.company_name ?? "",
        Name: d.company_name ?? d.deal_name ?? "",
        Sector: d.sector ?? "",
        Industry: d.industry ?? d.sector ?? "",
        Location: d.location ?? "",
        BROKER: d.broker ?? "",
        Broker: d.broker ?? "",
        Status: d.status ?? "Inbox",
        AI_Verdict: d.ai_verdict ?? "",
        Source: d.source ?? "",
        "One line reason": d.one_line_reason ?? "",
        One_Line_Reason: d.one_line_reason ?? "",
        Summary: d.executive_summary ?? "",
        "Executive Summary": d.executive_summary ?? "",
        Executive_Summary: d.executive_summary ?? "",
        Description: d.business_description ?? "",
        "Business Description": d.business_description ?? "",
        Business_Description: d.business_description ?? "",
        EBITDA_GBP: d.ebitda_gbp ?? "",
        EBITDA: d.ebitda_gbp ?? "",
        Turnover: d.turnover ?? "",
        Revenue: d.turnover ?? "",
        Asking_Price_GBP: d.asking_price_gbp ?? "",
        "Asking Price": d.asking_price_gbp ?? "",
        Enterprise_Value: d.enterprise_value ?? "",
        "EV Ask": d.enterprise_value ?? "",
        DSCR_Proxy: d.dscr_proxy ?? "",
        Contact_Name: d.broker ?? "",
        Contact_Email: d.contact_email ?? "",
        "Contact E-mail": d.contact_email ?? "",
        "Contact Email": d.contact_email ?? "",
        Contact_Phone: d.contact_phone ?? "",
        "Contact Phone": d.contact_phone ?? "",
        "Listing Link": d.listing_link ?? "",
        Owner: d.owner ?? d.assigned_to ?? "",
        "Assigned To": d.assigned_to ?? d.owner ?? "",
        IM_Review_Documents: im,
        "IM/Review": im,
        Attachments: im,
        "Deal Files": d.deal_files_secure_url ?? d.deal_files_url ?? "",
      },
    };
  });
}

export async function createInboxDeal(fields: Record<string, any>) {
  // Accepts either Supabase column names or the legacy field bag; the create
  // schema passes through extra keys, so callers are migrated incrementally.
  return api.post<any>("/api/deals", { stage: "inbox", ...fields });
}

export async function updateInboxDeal(id: string, fields: Record<string, any>) {
  return api.patch<any>(`/api/deals/${encodeURIComponent(id)}`, fields);
}
