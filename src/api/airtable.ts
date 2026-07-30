/**
 * Deal-room read client (Phase 6 — Supabase-backed REST).
 *
 * NOTE: filename kept as airtable.ts temporarily so ~20 importers don't churn
 * in the same commit; it no longer talks to Airtable. Renamed in the
 * decomposition pass.
 */
import { api, clearApiCache, type Paginated } from "./http";
import { mapDeal, mapDocument, mapSubmission } from "./mappers";
import { mapKeys, DEAL_KEY_MAP } from "./admin/_shared";
import type { DealDocument, PipelineDeal, SubmissionLogEntry } from "../types/deal";

export function clearAirtableCache() {
  clearApiCache();
}

/** Active-pipeline deals (the main working set). */
export async function getDeals(forceRefresh: boolean = false): Promise<PipelineDeal[]> {
  const page = await api.get<Paginated<any>>("/api/deals?stage=active&limit=200", { noCache: forceRefresh });
  return page.rows.map(mapDeal);
}

export async function getDealByRef(ref: string, forceRefresh: boolean = false): Promise<PipelineDeal | null> {
  const page = await api.get<Paginated<any>>(`/api/deals?ref=${encodeURIComponent(ref)}`, { noCache: forceRefresh });
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

export interface DealInboxQuery {
  /** Lifecycle stage; omit for every stage ("All Deals"). */
  stage?: "inbox" | "review" | "active" | "archived";
  search?: string;
  /** Restrict to these deal ids (watchlist). */
  ids?: string[];
  limit?: number;
  offset?: number;
}

/**
 * Deal counts per lifecycle stage, plus how many deals in the current scope have
 * no assignee. `stage`/`ids` scope the unassigned tally to the active filter.
 */
export async function getDealStageCounts(opts: {
  search?: string;
  stage?: "inbox" | "review" | "active" | "archived";
  ids?: string[];
} = {}): Promise<{
  total: number;
  byStage: { inbox: number; review: number; active: number; archived: number };
  unassigned: number;
}> {
  const params = new URLSearchParams();
  if (opts.search && opts.search.trim()) params.set("q", opts.search.trim());
  if (opts.stage) params.set("stage", opts.stage);
  if (opts.ids) params.set("ids", opts.ids.join(","));
  const qs = params.toString();
  return api.get(`/api/deals/stats${qs ? `?${qs}` : ""}`);
}

/**
 * A page of deals as Airtable-style { id, fields } records —
 * DealInboxPage/DealDetailPage read `record.fields["REF. NO"]` etc.
 *
 * Paged server-side: the Deal Inbox spans every lifecycle stage (~1.8k rows), so
 * it can no longer pull one capped list and filter it in the browser.
 */
export async function getDealInbox(query: DealInboxQuery = {}): Promise<{ rows: any[]; total: number }> {
  const params = new URLSearchParams({
    limit: String(query.limit ?? 25),
    offset: String(query.offset ?? 0),
    orderBy: "date_added",
  });
  if (query.stage) params.set("stage", query.stage);
  if (query.search && query.search.trim()) params.set("q", query.search.trim());
  if (query.ids) params.set("ids", query.ids.join(","));

  const page = await api.get<Paginated<any>>(`/api/deals?${params.toString()}`);
  const rows = page.rows.map((d) => {
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
        /** Authoritative lifecycle stage — what the inbox filters and dashboard count. */
        Stage: d.stage ?? "",
        /** Kanban/pipeline label — free text, distinct from the lifecycle stage. */
        Pipeline_Stage: d.pipeline_stage ?? "",
        AI_Verdict: d.ai_verdict ?? "",
        Source: d.source ?? "",
        /** Kill metadata — recorded on the archive transition. */
        Kill_Reason: d.kill_reason_text ?? d.kill_reason_select ?? "",
        Killed_By: d.killed_by ?? "",
        Kill_Date: d.kill_date ?? "",
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
  return { rows, total: page.total };
}

export async function createInboxDeal(fields: Record<string, any>) {
  // The inbox modal sends a legacy Airtable-style field bag ("Deal Name", "Sector"…);
  // translate it to Supabase columns so the strict deal schema keeps the values
  // instead of stripping every unknown key.
  return api.post<any>("/api/deals", { stage: "inbox", ...mapKeys(fields, DEAL_KEY_MAP) });
}

export async function updateInboxDeal(id: string, fields: Record<string, any>) {
  // Without this mapping the PATCH body is all unknown keys → stripped → "Empty update".
  return api.patch<any>(`/api/deals/${encodeURIComponent(id)}`, mapKeys(fields, DEAL_KEY_MAP));
}
