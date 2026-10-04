/**
 * Capital partner portal client.
 *
 * Every call is scoped server-side to the signed-in partner, so nothing here
 * passes an investor id. The one exception is staff inspecting a partner, which
 * the admin screens do through their own client, not this one.
 */
import { api } from "./http";

export interface PortalPartner {
  name: string;
  email: string;
  status: string;
  certification_status: string;
  certification_date: string | null;
  certified_now: boolean;
  read_only: boolean;
  read_only_until: string | null;
  terms_version: number | null;
  terms_accepted_at: string | null;
  current_terms_version: number;
  viewed_by_staff: boolean;
}

export interface PortalSummary {
  committed_pence: number;
  drawn_pence: number;
  distributed_pence: number;
  acquisitions: number;
}

export interface PortalAcquisition {
  deal_key: string;
  display_name: string | null;
  dscr_status: string;
  contracted_bp_verified: number | null;
  amort_status: string;
  next_report_date: string | null;
  commitment_id: string;
  committed_pence: number;
  ownership_bp: number | null;
  instrument: string;
  commitment_status: string;
  completed_at: string | null;
  converted_at: string | null;
  bought_back_at: string | null;
  sector: string | null;
  region: string | null;
  summary: string | null;
  customer_types: string[] | null;
  headcount_band: string | null;
  founded_year: number | null;
  milestones: Array<{ date: string; text: string }> | null;
  /** The deal's own business description, shown when no partner summary exists. */
  business_description: string | null;
  /** 1 = statutory compliance services, 2 = regulated clinical services. */
  lane: 1 | 2 | null;
  /** Named "Acquisition nn" to partners. */
  acquisition_no: number | null;
}

export interface PortalTransaction {
  id: string;
  deal_key: string;
  type: "call" | "distribution";
  amount_pence: number;
  txn_date: string;
  due_date: string | null;
  settled: boolean;
}

export interface PortalActivity {
  id: number;
  event_type: string;
  payload: Record<string, any>;
  created_at: string;
  deal_id: string | null;
}

export interface PortalDocument {
  id: string;
  deal_key: string | null;
  partner_display_name: string | null;
  doc_type: string;
  title: string;
  view_only: boolean;
  publishes_on: string | null;
  published_at: string | null;
  available: boolean;
  has_file: boolean;
  file_format: string | null;
  file_bytes: number | null;
  /** One of the 7 categories of the Investor Portal Document Standard. */
  category: string;
  notice_type: string | null;
  version: number;
  supersedes_id: string | null;
  /** A newer released version corrects this one. */
  superseded: boolean;
  event_date: string | null;
  acquisition_no: number | null;
  lane: 1 | 2 | null;
  /** Deal Memoranda only: the partner's receipt, or null before they confirm it. */
  receipt?: MemorandumReceipt | null;
}

export interface PortalReport {
  id: string;
  deal_key: string;
  period_label: string;
  publishes_on: string;
  published_at: string | null;
  /** Withheld (null) until the report publishes. */
  trading_summary: string | null;
  coverage_at_period: string | null;
  report_document_id: string | null;
  certificate_document_id: string | null;
}

export interface PortalDashboard {
  partner: PortalPartner;
  summary: PortalSummary;
  acquisitions: PortalAcquisition[];
  capital_activity: PortalTransaction[];
  activity: PortalActivity[];
}

export interface PortalAcquisitionDetail {
  acquisition: PortalAcquisition;
  documents: PortalDocument[];
  reports: PortalReport[];
  transactions: PortalTransaction[];
  coverage_history: Array<{ status: string; set_at: string }>;
}

export interface PortalAccount {
  name: string;
  email: string;
  certification_status: string;
  certification_date: string | null;
  certified_now: boolean;
  read_only: boolean;
  read_only_until: string | null;
  must_change_password: boolean;
  /** A redeemed reset link is still good: change the password without the old one. */
  recovery_pending: boolean;
  terms_version: number | null;
  terms_accepted_at: string | null;
  current_terms_version: number;
  agreement: PortalAgreementStatus;
}

export interface PortalAgreementStatus {
  title: string;
  version: number;
  /** The text is still the template; only test partners are asked to sign it. */
  draft: boolean;
  /** Must be signed before the portal opens. */
  required: boolean;
  /** When the version in force was signed; null if it has not been. */
  signed_at: string | null;
  countersigned_at: string | null;
  signed_versions: Array<{ version: number; signed_at: string; draft: boolean }>;
  details: { name: string; entity: string | null; address: string | null; pledge_pence: number | null };
}

/** A partner's receipt of a Deal Memorandum and their ROFR election. */
export interface MemorandumReceipt {
  received_at: string;
  /** Last business day to exercise or waive (clause 3.3). */
  respond_by: string;
  election: "exercise" | "waive" | null;
  elected_at: string | null;
}

export const getDashboard = (opts?: { noCache?: boolean }) =>
  api.get<PortalDashboard>("/api/investor-portal", opts);

export const getAcquisition = (dealKey: string, opts?: { noCache?: boolean }) =>
  api.get<PortalAcquisitionDetail>(
    `/api/investor-portal/acquisition?deal_key=${encodeURIComponent(dealKey)}`,
    opts,
  );

export const getDocuments = (dealKey?: string) =>
  api.get<{ rows: PortalDocument[]; total: number }>(
    dealKey
      ? `/api/investor-portal/documents?deal_key=${encodeURIComponent(dealKey)}`
      : "/api/investor-portal/documents",
  );

/** A short-lived signed URL for one document. Every call is logged as a doc_open. */
export const openDocument = (id: string, download = false) =>
  api.get<{ url: string; file_name: string; view_only: boolean }>(
    `/api/investor-portal/document-open?id=${encodeURIComponent(id)}${download ? "&download=1" : ""}`,
    { noCache: true },
  );

export const getActivity = (page = 1) =>
  api.get<{ rows: PortalActivity[]; total: number; page: number; page_size: number }>(
    `/api/investor-portal/activity?page=${page}`,
  );

export const getAccount = (opts?: { noCache?: boolean }) =>
  api.get<PortalAccount>("/api/investor-portal/account", opts);

export const setPassword = (current_password: string, new_password: string) =>
  api.post<{ ok: true; login_mode: string }>("/api/investor-portal/account", {
    action: "set_password",
    current_password,
    new_password,
  });

/** After a redeemed reset link: no current password, window is short. */
export const resetPassword = (new_password: string) =>
  api.post<{ ok: true; login_mode: string }>("/api/investor-portal/account", {
    action: "reset_password",
    new_password,
  });

/** Always resolves with the same message, whoever the address belongs to. */
export const requestPasswordReset = (email: string) =>
  api.post<{ ok: true; message: string }>("/api/investor-portal/forgot", { email });

export const acceptTerms = (terms_version: number) =>
  api.post<{ ok: true; terms_version: number }>("/api/investor-portal/account", {
    action: "accept_terms",
    terms_version,
  });

export const signAgreement = (input: {
  version: number;
  agreement_date: string;
  entity: string | null;
  address: string;
  pledge_pence: number;
  signed_name: string;
  text_sha256: string;
}) =>
  api.post<{ ok: true; version: number }>("/api/investor-portal/account", {
    action: "sign_agreement",
    accept_risk: true,
    ...input,
  });

/** The signed copy, built on request (a plain link: the browser downloads it). */
export const agreementPdfUrl = (version?: number) =>
  `/api/investor-portal/agreement-pdf${version ? `?version=${version}` : ""}`;

/** Confirm receipt of a Deal Memorandum, or exercise / waive the right of first refusal. */
export const respondToMemorandum = (document_id: string, action: "receive" | "exercise" | "waive") =>
  api.post<{ receipt: MemorandumReceipt }>("/api/investor-portal/memorandum", { document_id, action });
