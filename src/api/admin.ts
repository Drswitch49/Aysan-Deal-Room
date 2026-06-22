import { config } from "../config/env";
import { clearAirtableCache } from "./airtable";

const getAdminHeaders = () => {
  return {
    "Content-Type": "application/json"
  };
};

export async function fetchAdminLenders() {
  const response = await fetch("/api/admin/lenders", {
    headers: getAdminHeaders()
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to load lenders list");
  }

  return response.json();
}

export async function createLender(data: {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  status: string;
}) {
  const response = await fetch("/api/lender/create", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to create lender");
  }

  clearAirtableCache();
  return response.json();
}

export async function assignDealToLender(lenderRecordId: string, dealRef: string, ndaApproved?: boolean) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "assign-deal", lenderRecordId, dealRef, ndaApproved })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to assign deal");
  }

  clearAirtableCache();
  return response.json();
}

export async function promoteDealFromInbox(inboxRecordId: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "promote-deal", inboxRecordId })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to promote deal");
  }

  clearAirtableCache();
  return response.json();
}

export async function removeDealAssignment(assignmentId: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "remove-deal", assignmentId })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to remove assignment");
  }

  clearAirtableCache();
  return response.json();
}

export async function toggleLenderNda(lenderId: string, ndaApproved: boolean) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "update-lender-nda", lenderId, ndaApproved })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to update lender NDA status");
  }

  clearAirtableCache();
  return response.json();
}

export async function resetLenderPassword(lenderRecordId: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "reset-password", lenderRecordId })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to reset password");
  }

  clearAirtableCache();
  return response.json();
}

export async function regenerateLenderPortal(lenderRecordId: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "regenerate-portal", lenderRecordId })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to regenerate portal link");
  }

  clearAirtableCache();
  return response.json();
}

export async function deleteLender(lenderRecordId: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "delete-lender", lenderRecordId })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to delete lender");
  }

  clearAirtableCache();
  return response.json();
}

export async function updateAdminDocuments(updates: Array<{ id: string; fields: Record<string, any> }>) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "update-documents", updates })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to update documents");
  }

  clearAirtableCache();
  return response.json();
}

export async function createAdminDocument(data: {
  documentName: string;
  category: string;
  status: string;
  driveLink?: string;
  dealId: string;
  ablCritical?: boolean;
}) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "create-document", ...data })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to create document");
  }

  clearAirtableCache();
  return response.json();
}

export async function changeAdminPassword(currentPassword: string, newPassword: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "change-admin-password", currentPassword, newPassword })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to update admin passcode");
  }

  return response.json();
}

export async function verifyIntegration(integrationId: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "verify-integration", integrationId })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || `Failed to verify integration: ${integrationId}`);
  }

  return response.json();
}

export async function resetAdminPassword(masterPasscode: string, newPassword: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-passcode": masterPasscode
    },
    body: JSON.stringify({ action: "change-admin-password", newPassword })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to reset admin passcode");
  }

  return response.json();
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
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "create-deal", ...data })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to create deal");
  }

  clearAirtableCache();
  return response.json();
}

export async function fetchHrRegistry() {
  const response = await fetch("/api/admin/hr", {
    headers: getAdminHeaders()
  });

  if (!response.ok) {
    let err: any;
    try {
      err = await response.json();
    } catch {
      err = { error: "Failed to load HR data" };
    }
    const error: any = new Error(err.error || "Failed to load HR data");
    error.status = response.status;
    error.missingTables = err.missingTables;
    error.diagnostics = err.diagnostics;
    throw error;
  }

  return response.json();
}

export async function addHiringBrief(data: {
  role: string;
  company: string;
  statusText: string;
  accentColor: string;
}) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "add-hiring-brief", ...data })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || err.message || "Failed to add hiring brief");
  }

  clearAirtableCache();
  return response.json();
}

export async function deleteHiringBrief(id: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "delete-hiring-brief", id })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to delete hiring brief");
  }

  clearAirtableCache();
  return response.json();
}

export async function analyzeTranscript(dealId: string, text: string, fileName?: string) {
  const response = await fetch("/api/admin/transcript-analysis", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ dealId, text, fileName })
  });

  // 202 = job queued successfully (QStash). 200 = sync fallback (local dev).
  if (response.status !== 200 && response.status !== 202) {
    const err = await response.json();
    throw new Error(err.error || "Failed to analyze transcript");
  }

  return response.json();
}

export async function fetchTranscriptAnalyses(dealId: string) {
  const response = await fetch(`/api/admin/transcript-analysis?dealId=${encodeURIComponent(dealId)}`, {
    headers: getAdminHeaders()
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to load transcript analyses");
  }

  return response.json();
}

export async function fetchPrecallBriefs(dealId: string) {
  const response = await fetch(`/api/admin/precall-brief?dealId=${encodeURIComponent(dealId)}`, {
    headers: getAdminHeaders()
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to load pre-call briefs");
  }

  return response.json();
}

export async function generatePrecallBrief(data: {
  dealId: string;
  attendees: string[];
  selectedCallType: string;
  dataSources: Record<string, boolean>;
  pastedText?: string;
}) {
  const response = await fetch("/api/admin/precall-brief", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "generate", ...data })
  });

  // 202 = job queued, 200 = sync result
  if (response.status !== 200 && response.status !== 202) {
    const err = await response.json();
    throw new Error(err.error || "Failed to generate pre-call brief");
  }

  return response.json();
}

export async function askPrecallBriefQuestion(data: {
  dealId: string;
  briefId: string;
  question: string;
  history: Array<{ q: string; a: string }>;
}) {
  const response = await fetch("/api/admin/precall-brief", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "ask-question", ...data })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to get answer from Claude");
  }

  return response.json();
}

export async function fetchPostcallBriefs(dealId: string) {
  const response = await fetch(`/api/admin/postcall-brief?dealId=${encodeURIComponent(dealId)}`, {
    headers: getAdminHeaders()
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to load post-call briefs");
  }

  return response.json();
}

export async function generatePostcallBrief(data: {
  dealId: string;
  notes: string;
  schemaId: string;
}) {
  const response = await fetch("/api/admin/postcall-brief", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "generate", ...data })
  });

  // 202 = job queued, 200 = sync result
  if (response.status !== 200 && response.status !== 202) {
    const err = await response.json();
    throw new Error(err.error || "Failed to generate post-call scorecard");
  }

  clearAirtableCache();
  return response.json();
}

export async function overridePostcallScores(data: {
  dealId: string;
  briefId: string;
  overrides: Record<string, number>;
}) {
  const response = await fetch("/api/admin/postcall-brief", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "override", ...data })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to update overrides");
  }

  clearAirtableCache();
  return response.json();
}

export async function uploadAdminDocument(data: {
  documentName: string;
  category: string;
  status: string;
  dealId: string;
  ablCritical?: boolean;
  fileName?: string;
  fileType?: string;
  fileData?: string; // base64
  expectedDate?: string;
  internalNotes?: string;
}) {
  const response = await fetch("/api/documents/upload", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to upload document");
  }

  clearAirtableCache();
  return response.json();
}

export async function analyzeAdminDocument(documentId: string) {
  const response = await fetch("/api/documents/analyze", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ documentId })
  });

  // 202 = job queued, 200 = sync result
  if (response.status !== 200 && response.status !== 202) {
    const err = await response.json();
    throw new Error(err.error || "Failed to run AI document analysis");
  }

  return response.json();
}

export async function parseAdminDocument(documentId: string) {
  const response = await fetch("/api/documents/parse", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ documentId })
  });

  // 202 = job queued, 200 = sync result
  if (response.status !== 200 && response.status !== 202) {
    const err = await response.json();
    throw new Error(err.error || "Failed to parse document");
  }

  return response.json(); // { status, id/documentId, messageId? } or sync result
}

// ─── Job Status Polling ───────────────────────────────────────────────────

export interface JobStatusResponse {
  recordId: string;
  table: string;
  status: "queued" | "processing" | "extracted" | "analyzing" | "completed" | "failed" | "unknown";
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  hasContent: boolean;
  isComplete: boolean;
  isFailed: boolean;
  isProcessing: boolean;
}

export async function getJobStatus(
  table: string,
  recordId: string,
  jobType?: string
): Promise<JobStatusResponse> {
  const url = `/api/jobs/status?table=${encodeURIComponent(table)}&recordId=${encodeURIComponent(recordId)}${
    jobType ? `&jobType=${encodeURIComponent(jobType)}` : ""
  }`;
  const response = await fetch(url, { headers: getAdminHeaders() });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Status check failed (${response.status})`);
  }

  return response.json();
}

export async function triggerFinancialAnalysis(
  dealId: string,
  documentId?: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "trigger-financial", dealId, documentId }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to trigger financial analysis");
  }

  return response.json();
}

// ─── Deal Workflow Lifecycle ─────────────────────────────────────────────────

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
 * The ONLY valid way to change a deal's stage from the frontend.
 * Calls the centralized transition engine — validated, audited, orchestrated.
 */
export async function transitionDealStage(
  dealId: string,
  toStage: string,
  options: {
    notes?: string;
    changedBy?: string;
    role?: "analyst" | "manager" | "admin";
  } = {}
): Promise<DealTransitionResult> {
  const response = await fetch("/api/admin/deals/transition", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({
      dealId,
      toStage,
      notes: options.notes || "",
      changedBy: options.changedBy || "Admin",
      role: options.role || "admin",
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Stage transition failed (${response.status})`);
  }

  clearAirtableCache();
  return response.json();
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
  const response = await fetch(
    `/api/admin/deals/transition?dealId=${encodeURIComponent(dealId)}`,
    { headers: getAdminHeaders() }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load stage history");
  }

  const data = await response.json();
  return data.history || [];
}

export interface ActivityEvent {
  id: string;
  type: "stage_transition" | "document_uploaded" | "transcript_analyzed" | "brief_completed" | "osint_completed";
  title: string;
  detail?: string;
  dealId?: string;
  dealRef?: string;
  companyName?: string;
  changedBy?: string;
  timestamp: string;
  color: "bronze" | "blue" | "emerald" | "purple" | "amber" | "red";
  icon: "arrow-right" | "file" | "mic" | "brain" | "search";
  metadata?: Record<string, any>;
}

/** Fetches the unified activity feed (cross-deal or for a specific deal) */
export async function fetchActivityFeed(options: {
  dealId?: string;
  limit?: number;
} = {}): Promise<ActivityEvent[]> {
  const params = new URLSearchParams();
  if (options.dealId) params.set("dealId", options.dealId);
  if (options.limit) params.set("limit", String(options.limit));

  const response = await fetch(`/api/admin/activity?${params.toString()}`, {
    headers: getAdminHeaders(),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load activity feed");
  }

  const data = await response.json();
  return data.events || [];
}

export async function triggerOsintEnrichment(dealId: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "trigger-osint", dealId }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to trigger OSINT enrichment");
  }

  return response.json();
}

export async function fetchPortfolioData() {
  const response = await fetch("/api/admin/portfolio", {
    headers: getAdminHeaders()
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load portfolio details");
  }

  return response.json();
}

export async function triggerPortfolioAnalysis() {
  const response = await fetch("/api/admin/portfolio", {
    method: "POST",
    headers: getAdminHeaders()
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to run portfolio analysis");
  }

  return response.json();
}

export async function fetchDashboardStats(owner: string) {
  const response = await fetch(`/api/admin/dashboard-stats?owner=${encodeURIComponent(owner)}`, {
    headers: getAdminHeaders()
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load dashboard metrics");
  }

  return response.json();
}

export async function fetchLenderPasscode(lenderRecordId: string): Promise<string> {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "get-lender-passcode", lenderRecordId })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to retrieve passcode");
  }

  const data = await response.json();
  return data.passcode || "";
}

export async function sendLoiWebhook(data: {
  lenderName: string;
  lenderEmail: string;
  companyName: string;
  dealId: string;
  subject: string;
  body: string;
  type: "loi";
}) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "send-loi", ...data })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to send LOI");
  }

  clearAirtableCache();
  return response.json();
}

export async function sendEmailWebhook(data: {
  lenderName: string;
  lenderEmail: string;
  companyName: string;
  dealId: string;
  subject: string;
  body: string;
  type: "post_meeting_email";
}) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "send-email", ...data })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to send email");
  }

  clearAirtableCache();
  return response.json();
}

// ─── Deal Update ─────────────────────────────────────────────────────────────

export async function updateAdminDeal(dealId: string, fields: Record<string, any>) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "update-deal", dealId, fields })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update deal");
  }

  clearAirtableCache();
  return response.json();
}

export async function deleteAdminDocument(documentId: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "delete-document", documentId })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to delete document");
  }

  clearAirtableCache();
  return response.json();
}

export async function archiveDeal(dealId: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "archive-deal", dealId })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to archive deal");
  }

  clearAirtableCache();
  return response.json();
}

export async function restoreDeal(dealId: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "restore-deal", dealId })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to restore deal");
  }

  clearAirtableCache();
  return response.json();
}

// ─── IM Documents ────────────────────────────────────────────────────────────

export async function uploadImDocument(dealId: string, fileName: string, fileType: string, fileData: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "upload-im-document", dealId, fileName, fileType, fileData })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to upload IM document");
  }

  clearAirtableCache();
  return response.json();
}

export async function removeImDocument(dealId: string, attachmentIndex: number) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "remove-im-document", dealId, attachmentIndex })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to remove IM document");
  }

  clearAirtableCache();
  return response.json();
}

export async function replaceImDocument(dealId: string, attachmentIndex: number, fileName: string, fileType: string, fileData: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "replace-im-document", dealId, attachmentIndex, fileName, fileType, fileData })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to replace IM document");
  }

  clearAirtableCache();
  return response.json();
}

// ─── Portfolio Company CRUD ──────────────────────────────────────────────────

export interface PortfolioCompanyPayload {
  companyName: string;
  industry?: string;
  revenue?: number;
  ebitda?: number;
  debt?: number;
  headcount?: number;
  status?: string;
  location?: string;
  notes?: string;
}

export async function createPortfolioCompany(data: PortfolioCompanyPayload) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "create-portfolio-company", ...data })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create portfolio company");
  }

  clearAirtableCache();
  return response.json();
}

export async function updatePortfolioCompany(companyId: string, fields: Record<string, any>) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "update-portfolio-company", companyId, fields })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update portfolio company");
  }

  clearAirtableCache();
  return response.json();
}

export async function archivePortfolioCompany(companyId: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "archive-portfolio-company", companyId })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to archive portfolio company");
  }

  clearAirtableCache();
  return response.json();
}

export async function fetchPortfolioCompanies() {
  const response = await fetch("/api/admin/portfolio?section=companies", {
    headers: getAdminHeaders(),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to fetch portfolio companies");
  }

  return response.json();
}

// ─── Team Member CRUD ────────────────────────────────────────────────────────

export interface TeamMemberPayload {
  name: string;
  email?: string;
  phone?: string;
  role: string;
  status?: string;
  accessLevel?: string;
}

export async function createTeamMember(data: TeamMemberPayload) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "create-team-member", ...data })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create team member");
  }

  clearAirtableCache();
  return response.json();
}

export async function updateTeamMember(memberId: string, fields: Record<string, any>) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "update-team-member", memberId, fields })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update team member");
  }

  clearAirtableCache();
  return response.json();
}

// ─── Stakeholder CRUD ────────────────────────────────────────────────────────

export interface StakeholderPayload {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  type?: string;
  status?: string;
  notes?: string;
  association?: string;
  accentColor?: string;
}

export async function createStakeholder(data: StakeholderPayload) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "create-stakeholder", ...data })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create stakeholder");
  }

  clearAirtableCache();
  return response.json();
}

export async function updateStakeholder(stakeholderId: string, fields: Record<string, any>) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "update-stakeholder", stakeholderId, fields })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update stakeholder");
  }

  clearAirtableCache();
  return response.json();
}
