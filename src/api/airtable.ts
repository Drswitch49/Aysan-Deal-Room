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

/** Inbox deals (lifecycle stage = inbox). Returns mapped deals. */
export async function getDealInbox(): Promise<any[]> {
  const page = await api.get<Paginated<any>>("/api/deals?stage=inbox&limit=200&orderBy=date_added");
  return page.rows.map(mapDeal);
}

export async function createInboxDeal(fields: Record<string, any>) {
  // Accepts either Supabase column names or the legacy field bag; the create
  // schema passes through extra keys, so callers are migrated incrementally.
  return api.post<any>("/api/deals", { stage: "inbox", ...fields });
}

export async function updateInboxDeal(id: string, fields: Record<string, any>) {
  return api.patch<any>(`/api/deals/${encodeURIComponent(id)}`, fields);
}
