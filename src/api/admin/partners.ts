/**
 * Capital partner admin client — the Capital Partners tab and partner record.
 *
 * Mirrors the server routes one for one. Nothing here decides a rule; the
 * refusals all come back from the API (and, underneath it, from Postgres), so
 * the UI's job is to show them in plain words rather than to pre-judge them.
 */
import { api } from "../http";
import { isActiveStageDeal } from "../../../lib/core/schemas/deal";

export type InvestorType = "holdco_equity" | "deal_equity" | "prospective";
export type InvestorStatus =
  | "prospective"
  | "certified"
  | "invited"
  | "active"
  | "committed"
  | "passed"
  | "ended";
export type CertStatus = "not_certified" | "pending" | "valid" | "expired";
export type LoginMode = "none" | "pending" | "full" | "read_only" | "revoked";

export interface PartnerListRow {
  id: string;
  stakeholder_id: string | null;
  name: string;
  entity: string | null;
  type: InvestorType;
  email: string;
  phone: string | null;
  status: InvestorStatus;
  warmth: number;
  perimeter_flag: boolean;
  certification_status: CertStatus;
  certification_kind: string | null;
  certification_date: string | null;
  certified_now: boolean;
  last_touch: string | null;
  staleness_flag: boolean;
  committed_pence: number;
  login_mode: LoginMode;
  last_login_at: string | null;
  terms_accepted_at: string | null;
  created_at: string;
}

export interface PartnerRecord {
  investor: PartnerListRow & {
    certification_evidence_link: string | null;
    notes: string | null;
    source: string | null;
    pass_reason: string | null;
    pass_category: string | null;
  };
  access: {
    login_mode: LoginMode;
    auth_bound: boolean;
    first_login_at: string | null;
    last_login_at: string | null;
    terms_version: number | null;
    terms_accepted_at: string | null;
    read_only_until: string | null;
    documents_opened_30d: number;
  };
  invites: Array<{ id: string; issued_at: string; expires_at: string; status: string; accepted_at: string | null }>;
  commitments: Array<Record<string, any>>;
  documents: Array<Record<string, any>>;
  audit: Array<{
    id: string;
    action: string;
    operator: string | null;
    operator_role: string | null;
    details: string | null;
    reason: string | null;
    occurred_at: string;
  }>;
  access_log: Array<{ id: number; event: string; created_at: string; ip: string | null }>;
}

export interface AccessGrant {
  investorId: string;
  email: string;
  name: string;
  password: string;
  link: string;
  portalUrl: string;
  expiresAt?: string;
  created?: boolean;
  notifyOnly: boolean;
  /** Whether the credentials email actually went, and if not, why. */
  delivery?: {
    status: "sent" | "failed" | "not_sent";
    sentTo?: string;
    notifyOnly: boolean;
    reason?: string;
  };
}

export const listPartners = (opts?: { noCache?: boolean }) =>
  api.get<{ rows: PartnerListRow[]; total: number }>("/api/investors", opts);

export const getPartner = (id: string, opts?: { noCache?: boolean }) =>
  api.get<PartnerRecord>(`/api/investors/${encodeURIComponent(id)}`, opts);

export const createPartner = (body: {
  name: string;
  email: string;
  type: InvestorType;
  entity?: string | null;
  phone?: string | null;
  warmth?: number;
  source?: string | null;
  notes?: string | null;
}) => api.post<PartnerListRow>("/api/investors", body);

export const updatePartner = (id: string, patch: Record<string, unknown>) =>
  api.patch<PartnerRecord>(`/api/investors/${encodeURIComponent(id)}`, patch);

/** Issue, revoke, restore or reset. `issue` returns the password once. */
export const partnerAccess = (body: {
  investor_id: string;
  action: "issue" | "revoke" | "restore" | "reset_password";
  reason?: string;
}) => api.post<AccessGrant & { changed?: boolean; login_mode?: string }>("/api/partner-access", body);

/**
 * Permanently erase a partner and everything about them. `confirmEmail` must
 * be the partner's email, typed by the admin; the server checks it.
 */
export const erasePartner = (id: string, confirmEmail: string) =>
  api.del<{ removed: Record<string, number>; login: "deleted" | "unlinked" | "none" }>(
    `/api/investors/${encodeURIComponent(id)}?confirm=${encodeURIComponent(confirmEmail)}`,
  );

// ─── Commitments and capital transactions ──────────────────────────────────

/** A deal as the commitment picker needs it. */
export interface DealOption {
  id: string;
  acp_ref_no: string | null;
  company_name: string | null;
  deal_name: string | null;
  partner_display_name: string | null;
  stage: string | null;
  pipeline_stage: string | null;
}

/**
 * Search for a deal to commit against (name, ref or sector). Only deals at the
 * Active stage are offered — the commitment API refuses any other. The live
 * pipeline is small, so it is fetched whole and narrowed here.
 */
export const searchDeals = async (q: string) => {
  const params = new URLSearchParams({ limit: "200", stage: "active" });
  if (q.trim()) params.set("q", q.trim());
  const res = await api.get<{ rows: DealOption[]; total: number }>(`/api/deals?${params.toString()}`);
  const rows = res.rows.filter(isActiveStageDeal);
  return { rows, total: rows.length };
};

export const listCommitments = (params: { investor_id?: string; deal_id?: string }) => {
  const q = new URLSearchParams(params as Record<string, string>).toString();
  return api.get<{ rows: Array<Record<string, any>>; total: number }>(`/api/commitments?${q}`);
};

export const createCommitment = (body: {
  investor_id: string;
  deal_id: string;
  committed_pence: number;
  instrument?: string;
}) => api.post<Record<string, any>>("/api/commitments", body);

export const completeCommitment = (id: string, ownership_bp: number) =>
  api.patch<Record<string, any>>(`/api/commitments/${encodeURIComponent(id)}`, {
    action: "complete",
    ownership_bp,
  });

export const convertCommitment = (id: string, shares: number, issued_at: string) =>
  api.patch<Record<string, any>>(`/api/commitments/${encodeURIComponent(id)}`, {
    action: "convert",
    shares,
    issued_at,
  });

export const buybackCommitment = (
  id: string,
  body: { cfo_sanction_ref: string; amount_pence: number; txn_date: string; evidence_link: string },
) => api.patch<Record<string, any>>(`/api/commitments/${encodeURIComponent(id)}`, { action: "buyback", ...body });

export const recordTransaction = (body: {
  commitment_id: string;
  type: "call" | "distribution" | "buyback";
  amount_pence: number;
  txn_date: string;
  due_date?: string | null;
  settled?: boolean;
  evidence_link?: string | null;
  cfo_sanction_ref?: string | null;
}) => api.post<Record<string, any>>("/api/capital-transactions", body);

export const settleTransaction = (id: string, evidence_link: string) =>
  api.patch<Record<string, any>>("/api/capital-transactions", { id, settled: true, evidence_link });

// ─── Partner-facing deal settings ──────────────────────────────────────────

export interface PartnerDealSettings {
  deal: {
    id: string;
    acp_ref_no: string | null;
    company_name: string | null;
    deal_name: string | null;
    partner_display_name: string | null;
    stage: string | null;
    pipeline_stage: string | null;
    dscr_status: string;
    contracted_bp_verified: number | null;
    amort_status: string;
    next_report_date: string | null;
  };
  profile: Record<string, any> | null;
  reports: Array<Record<string, any>>;
  coverage_history: Array<{ status: string; set_at: string; basis_note: string | null }>;
  commitments: Array<Record<string, any>>;
  can_set_coverage: boolean;
}

export const getPartnerDealSettings = (dealId: string, opts?: { noCache?: boolean }) =>
  api.get<PartnerDealSettings>(`/api/partner-deal-settings?deal_id=${encodeURIComponent(dealId)}`, opts);

export const savePartnerDealSettings = (body: Record<string, unknown> & { deal_id: string }) =>
  api.patch<{ deal_id: string; updated: true }>("/api/partner-deal-settings", body);

/** CFO only. Every other role is refused by the database, not by this call. */
export const setCoverageStatus = (body: {
  deal_id: string;
  dscr_status: "not_yet_reported" | "above_floor" | "watch" | "breach";
  basis_note?: string | null;
}) => api.post<{ deal_id: string; dscr_status: string }>("/api/partner-deal-settings", { action: "set_coverage", ...body });

// ─── Documents and reports ─────────────────────────────────────────────────

export const listPartnerDocuments = (
  params: { investor_id?: string; deal_id?: string },
  opts?: { noCache?: boolean },
) => {
  const q = new URLSearchParams(params as Record<string, string>).toString();
  return api.get<{ rows: Array<Record<string, any>>; total: number }>(`/api/investor-documents?${q}`, opts);
};

/** Deletes the row and the stored file. Revoking (updatePartnerDocument) keeps both. */
export const deletePartnerDocument = (id: string) =>
  api.del<{ deleted: true; id: string }>(`/api/investor-documents?id=${encodeURIComponent(id)}`);

export const addPartnerDocument = (body: Record<string, unknown>) =>
  api.post<Record<string, any>>("/api/investor-documents", body);

export const updatePartnerDocument = (body: { id: string } & Record<string, unknown>) =>
  api.patch<Record<string, any>>("/api/investor-documents", body);

/** A file already uploaded to Cloudinary, as the reports API takes it. */
export interface ReportFile {
  public_id: string;
  resource_type: "image" | "raw" | "video";
  format: string | null;
  name: string;
  bytes: number | null;
}

/** What publishing did: partners in the deal, and how many emails went out. */
export interface ReportNotified {
  partners: number;
  emailed: number;
  failed: string[];
}

export const listDealReports = (params: { deal_id?: string } = {}) => {
  const q = new URLSearchParams(params as Record<string, string>).toString();
  return api.get<{ rows: Array<Record<string, any>>; total: number }>(`/api/deal-reports?${q}`, { noCache: true });
};

export const createDealReport = (body: {
  deal_id: string;
  period_label: string;
  publishes_on: string;
  trading_summary?: string | null;
  coverage_at_period?: string | null;
  report_file?: ReportFile | null;
  certificate_file?: ReportFile | null;
  publish?: boolean;
  next_report_date?: string | null;
}) => api.post<Record<string, any> & { notified: ReportNotified | null }>("/api/deal-reports", body);

export const updateDealReport = (body: { id: string } & Record<string, unknown>) =>
  api.patch<Record<string, any> & { notified: ReportNotified | null }>("/api/deal-reports", body);

/** Only a report that has not been published can be deleted. */
export const deleteDealReport = (id: string) =>
  api.del<{ deleted: true; id: string }>(`/api/deal-reports?id=${encodeURIComponent(id)}`);

/** A two-minute signed link to a partner document, for staff to check it. */
export const openPartnerDocument = (id: string) =>
  api.get<{ url: string }>(`/api/investor-documents?open=${encodeURIComponent(id)}`, { noCache: true });
