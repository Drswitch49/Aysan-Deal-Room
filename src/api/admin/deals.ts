/** Admin client — Deals, deal lifecycle, activity feed, dashboard stats. */
import { api, type Paginated } from "../http";
import { clearAirtableCache } from "../airtable";
import { type Row, mapKeys, resolveDealId, DEAL_KEY_MAP } from "./_shared";

export async function promoteDealFromInbox(inboxRecordId: string): Promise<Row> {
  const deal = await api.post<Row>("/api/deal-transitions", { deal_id: inboxRecordId, to_stage: "active" });
  clearAirtableCache();
  return { success: true, newDealId: deal.id };
}

export async function updateInboxStatus(inboxRecordId: string, status: string) {
  return api.patch<Row>(`/api/deals/${encodeURIComponent(inboxRecordId)}`, { status });
}

export async function deleteInboxDeal(dealId: string) {
  return api.del<Row>(`/api/deals/${encodeURIComponent(dealId)}`);
}

export interface CreateDealPayload {
  companyName?: string;
  projectName?: string;
  industry?: string;
  website?: string;
  location?: string;
  revenue?: number;
  ebitda?: number;
  enterpriseValue?: number;
  askingPrice?: number;
  owner?: string;
  analyst?: string;
  source?: string;
  acpRefNo?: string;
  stage?: string;
  nextAction?: string;
  nextActionDate?: string;
  internalNotes?: string;
  // Legacy support
  dealName?: string;
}

export async function createAdminDeal(data: CreateDealPayload) {
  const row = await api.post<Row>("/api/deals", {
    deal_name: data.dealName || data.projectName || data.companyName || "New Deal",
    stage: "active",
    company_name: data.companyName,
    project_name: data.projectName,
    industry: data.industry,
    website: data.website,
    location: data.location,
    turnover: data.revenue,
    ebitda_gbp: data.ebitda,
    enterprise_value: data.enterpriseValue,
    asking_price_gbp: data.askingPrice,
    owner: data.owner,
    analyst: data.analyst,
    source: data.source,
    acp_ref_no: data.acpRefNo,
    pipeline_stage: data.stage,
    next_action: data.nextAction,
    next_action_date: data.nextActionDate,
    internal_notes: data.internalNotes,
  });
  clearAirtableCache();
  return { success: true, deal: row, result: row, id: row.id } as Row;
}

export async function updateAdminDeal(dealId: string, fields: Row) {
  const id = await resolveDealId(dealId);
  const row = await api.patch<Row>(`/api/deals/${encodeURIComponent(id)}`, mapKeys(fields, DEAL_KEY_MAP));
  clearAirtableCache();
  return { success: true, deal: row };
}

export async function deleteDeal(dealId: string) {
  return api.del<Row>(`/api/deals/${encodeURIComponent(dealId)}`);
}

// ─── Deal workflow lifecycle ────────────────────────────────────────────────

export interface DealTransitionResult {
  success: true;
  dealId: string;
  dealRef: string;
  fromStage: string;
  toStage: string;
  auditId: string;
  changedBy: string;
  timestamp: string;
}

/**
 * Kanban stage-label change (pipeline_stage). Lifecycle moves (kill/revive/
 * promote) go through /api/deal-transitions instead.
 */
export async function transitionDealStage(
  dealId: string,
  toStage: string,
  options: { notes?: string; changedBy?: string; role?: "analyst" | "manager" | "admin" } = {},
): Promise<DealTransitionResult> {
  const id = await resolveDealId(dealId);
  const before = await api.get<Row>(`/api/deals/${encodeURIComponent(id)}`);
  const row = await api.patch<Row>(`/api/deals/${encodeURIComponent(id)}`, { pipeline_stage: toStage });
  clearAirtableCache();
  return {
    success: true,
    dealId: id,
    dealRef: row.acp_ref_no ?? row.ref_no ?? id,
    fromStage: before.pipeline_stage ?? "",
    toStage,
    auditId: "",
    changedBy: options.changedBy ?? "Admin",
    timestamp: new Date().toISOString(),
  };
}

export interface StageHistoryEntry {
  id: string;
  dealId: string;
  dealRef: string;
  fromStage: string;
  toStage: string;
  fromStageLabel: string;
  toStageLabel: string;
  changedBy: string;
  changedByRole: string;
  changedAt: string;
  notes: string;
}

/** Fetches the immutable audit trail for a specific deal */
export async function fetchDealStageHistory(dealId: string): Promise<StageHistoryEntry[]> {
  const id = await resolveDealId(dealId).catch(() => dealId);
  const page = await api.get<Paginated<Row>>(`/api/deal-stage-history?deal_id=${encodeURIComponent(id)}`);
  return page.rows.map((r) => ({
    id: r.id,
    dealId: r.deal_id ?? "",
    dealRef: r.legacy_deal_ref ?? "",
    fromStage: r.from_stage ?? "",
    toStage: r.to_stage ?? "",
    fromStageLabel: r.from_stage_label ?? r.from_stage ?? "",
    toStageLabel: r.to_stage_label ?? r.to_stage ?? "",
    changedBy: r.changed_by ?? "",
    changedByRole: r.changed_by_role ?? "",
    changedAt: r.changed_at ?? r.created_at ?? "",
    notes: r.notes ?? "",
  }));
}

export interface ActivityEvent {
  id: string;
  type: string;
  title: string;
  color: "bronze" | "blue" | "emerald" | "purple" | "amber" | "red";
  icon: string;
  dealId?: string;
  dealRef?: string;
  companyName?: string;
  changedBy?: string;
  detail?: string;
  timestamp: string;
}

function classifyAuditEvent(r: Row): Pick<ActivityEvent, "type" | "title" | "color" | "icon"> {
  const action = String(r.action ?? r.event_type ?? "").toUpperCase();
  if (action.includes("TRANSITION") || action.includes("STAGE")) {
    return { type: "stage_transition", title: r.details ?? "Stage transition", color: "bronze", icon: "arrow-right" };
  }
  if (action.includes("DOCUMENT") || action.includes("UPLOAD")) {
    return { type: "document_uploaded", title: r.details ?? "Document updated", color: "blue", icon: "file" };
  }
  if (action.includes("TRANSCRIPT")) {
    return { type: "transcript_analyzed", title: r.details ?? "Transcript analyzed", color: "purple", icon: "mic" };
  }
  if (action.includes("BRIEF") || action.includes("VERDICT")) {
    return { type: "brief_completed", title: r.details ?? "AI brief completed", color: "purple", icon: "brain" };
  }
  if (action.includes("OSINT")) {
    return { type: "osint_completed", title: r.details ?? "OSINT scan", color: "amber", icon: "search" };
  }
  return { type: "event", title: r.details ?? action.toLowerCase() ?? "Activity", color: "emerald", icon: "clock" };
}

export async function fetchActivityFeed(options: { dealId?: string; limit?: number } = {}): Promise<ActivityEvent[]> {
  const params = new URLSearchParams({ limit: String(options.limit ?? 50), orderBy: "occurred_at" });
  if (options.dealId) {
    params.set("entity_type", "deal");
    params.set("entity_id", options.dealId);
  }
  const page = await api.get<Paginated<Row>>(`/api/audit-logs?${params.toString()}`);
  return page.rows.map((r) => ({
    id: r.id,
    ...classifyAuditEvent(r),
    dealId: r.entity_type === "deal" ? r.entity_id ?? undefined : undefined,
    dealRef: r.target ?? undefined,
    companyName: undefined,
    changedBy: r.operator ?? "",
    detail: r.details ?? "",
    timestamp: r.occurred_at ?? r.created_at ?? "",
  }));
}

export async function fetchDashboardStats(owner: string): Promise<Row> {
  return api.get<Row>(`/api/dashboard?owner=${encodeURIComponent(owner || "All")}`);
}
