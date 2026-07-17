/**
 * Lender portal client (Phase 6 — Supabase-backed).
 *
 * Login keeps the slug+password contract, but the password is now the lender's
 * real Supabase Auth password; the session lives in httpOnly cookies, so the
 * old x-lender-slug header is gone (kept as an ignored arg for signatures).
 */
import { api } from "./http";
import type { DealDocument, PipelineDeal, SubmissionLogEntry } from "../types/deal";

type Row = Record<string, any>;

export async function loginLender(portalSlug: string, passcode: string) {
  const response = await fetch("/api/lender/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ portalSlug, password: passcode }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Incorrect portal credentials");
  }
  return response.json();
}

export async function fetchLenderDeals(_portalSlug: string): Promise<PipelineDeal[]> {
  const { rows } = await api.get<{ rows: Row[] }>("/api/lender/deals");
  return rows.map((d) => ({
    id: d.id,
    dealRef: d.acp_ref_no || d.ref_no || d.id,
    companyName: "Undisclosed Company", // masked for lender-portal privacy
    status: d.pipeline_stage || d.stage || "",
    location: d.location || "",
    sector: d.sector || d.industry || "",
    ev: String(d.enterprise_value ?? ""),
    dscrBase: String(d.dscr_proxy ?? ""),
    dscrStress: String(d.dscr_score ?? ""),
    broker: "",
    lenderAssigned: "",
    vendorNames: "",
    postCompletionRoles: "",
    lenderExecutiveSummary: d.lender_executive_summary || "",
    businessDescription: d.business_description || "",
    investmentHighlights: d.investment_highlights || "",
    acquisitionRationale: d.acquisition_rationale || "",
    dealType: d.deal_type || "",
    turnover: String(d.turnover ?? ""),
    ebitda: String(d.ebitda_gbp ?? ""),
    evAsk: String(d.asking_price_gbp ?? d.enterprise_value ?? ""),
    capitalStructure: [],
    rawFields: d as PipelineDeal["rawFields"],
    dealFiles: d.deal_files_secure_url || "",
  }));
}

export async function fetchLenderDocuments(_portalSlug: string): Promise<DealDocument[]> {
  const { rows } = await api.get<{ rows: Row[] }>("/api/lender/documents");
  return rows.map((r) => ({
    id: r.id,
    dealRef: r.deal_id ?? "",
    documentName: r.document_name ?? "",
    category: r.category ?? "",
    ablCritical: Boolean(r.abl_critical),
    status: r.status ?? "",
    source: r.source ?? "",
    dateReceived: r.date_received ?? "",
    driveLink: r.file_url ?? "",
    expectedDate: r.expected_date ?? "",
    internalNotes: "", // never exposed to lenders
    dateSentToLender: r.date_sent_to_lender ?? "",
    lenderTarget: "", // never exposed to lenders
  }));
}

export async function fetchLenderSubmissions(_portalSlug: string): Promise<SubmissionLogEntry[]> {
  const { rows } = await api.get<{ rows: Row[] }>("/api/lender/submissions");
  return rows.map((r) => ({
    id: r.id,
    dealRef: r.deal_id ?? "",
    date: r.submitted_on ?? "",
    whatWasSent: r.what_was_sent ?? "",
    sentTo: r.sent_to ?? "",
    sentVia: r.sent_via ?? "",
    responseReceived: r.response_received ?? "",
    flag: r.flag ?? "",
  }));
}
