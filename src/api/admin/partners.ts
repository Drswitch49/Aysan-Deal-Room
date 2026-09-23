/**
 * Capital partner admin client — the Capital Partners tab and partner record.
 *
 * Mirrors the server routes one for one. Nothing here decides a rule; the
 * refusals all come back from the API (and, underneath it, from Postgres), so
 * the UI's job is to show them in plain words rather than to pre-judge them.
 */
import { api } from "../http";

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

// ─── Commitments and capital transactions ──────────────────────────────────

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

export const listPartnerDocuments = (params: { investor_id?: string; deal_id?: string }) => {
  const q = new URLSearchParams(params as Record<string, string>).toString();
  return api.get<{ rows: Array<Record<string, any>>; total: number }>(`/api/investor-documents?${q}`);
};

export const addPartnerDocument = (body: Record<string, unknown>) =>
  api.post<Record<string, any>>("/api/investor-documents", body);

export const updatePartnerDocument = (body: { id: string } & Record<string, unknown>) =>
  api.patch<Record<string, any>>("/api/investor-documents", body);

export const createDealReport = (body: {
  deal_id: string;
  period_label: string;
  publishes_on: string;
  trading_summary?: string | null;
  coverage_at_period?: string | null;
  report_link?: string | null;
  covenant_cert_link?: string | null;
}) => api.post<Record<string, any>>("/api/deal-reports", body);

export const updateDealReport = (body: { id: string } & Record<string, unknown>) =>
  api.patch<Record<string, any>>("/api/deal-reports", body);
