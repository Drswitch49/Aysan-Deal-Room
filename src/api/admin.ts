/**
 * Admin client (Phase 6 — Supabase-backed REST).
 *
 * Full rewrite of the legacy module that funneled 35 actions through the
 * /api/admin/action god-endpoint. Every export keeps its signature so pages
 * keep compiling; internally everything now hits the rebuilt REST API.
 * Lender/HR objects keep their legacy Airtable-style keys (Company_Name, …)
 * until the pages are decomposed.
 */
import { api, type Paginated } from "./http";
import { clearAirtableCache } from "./airtable";

type Row = Record<string, any>;

// ─── Field-name mapping (legacy Airtable keys → Supabase columns) ───────────

const DEAL_KEY_MAP: Record<string, string> = {
  "Company_Name": "company_name",
  "Company Name": "company_name",
  "Deal Name": "deal_name",
  "Project_Name": "project_name",
  "Industry": "industry",
  "Sector": "sector",
  "Website": "website",
  "Location": "location",
  "Owner": "owner",
  "Analyst": "analyst",
  "Assigned To": "assigned_to",
  "Source": "source",
  "Turnover": "turnover",
  "Revenue": "turnover",
  "EBITDA": "ebitda_gbp",
  "EBITDA_GBP": "ebitda_gbp",
  "Enterprise_Value": "enterprise_value",
  "EV": "enterprise_value",
  "Asking_Price_GBP": "asking_price_gbp",
  "Asking Price": "asking_price_gbp",
  "Stage": "pipeline_stage",
  "Status": "status",
  "Next Action": "next_action",
  "Next_Action": "next_action",
  "Next Action Date": "next_action_date",
  "Next_Action_Date": "next_action_date",
  "Internal_Notes": "internal_notes",
  "Executive_Summary": "executive_summary",
  "Business_Description": "business_description",
  "Lender_Executive_Summary": "lender_executive_summary",
  "Investment_Highlights": "investment_highlights",
  "Acquisition_Rationale": "acquisition_rationale",
  "Deal_Type": "deal_type",
  "Contact_Email": "contact_email",
  "Contact E-mail": "contact_email",
  "Contact_Phone": "contact_phone",
  "Listing Link": "listing_link",
  "Listing_Link": "listing_link",
  "BROKER": "broker",
  "Broker": "broker",
  "Broker Name": "broker",
  "ACP REF NO": "acp_ref_no",
  "REF No.": "ref_no",
  "REF. NO": "ref_no",
};

const DOC_KEY_MAP: Record<string, string> = {
  "Deal_Ref": "deal_id",
  "Document_Name": "document_name",
  "Category": "category",
  "ABL_Critical": "abl_critical",
  "Status": "status",
  "Source": "source",
  "Date_Received": "date_received",
  "Drive_Link": "legacy_drive_link",
  "Expected_Date": "expected_date",
  "Internal_Notes": "internal_notes",
  "Date_Sent_To_Lender": "date_sent_to_lender",
  "Lender_Target": "lender_target",
  "Document_Access": "document_access",
};

function mapKeys(fields: Row, keyMap: Record<string, string>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    const col = keyMap[k] ?? (/^[a-z0-9_]+$/.test(k) ? k : undefined);
    if (col) out[col] = v;
  }
  return out;
}

async function resolveDealId(refOrId: string): Promise<string> {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(refOrId)) return refOrId;
  const page = await api.get<Paginated<Row>>(`/api/deals?ref=${encodeURIComponent(refOrId)}`);
  const deal = page.rows[0];
  if (!deal) throw new Error(`Deal not found: ${refOrId}`);
  return deal.id;
}

// ─── Lenders ────────────────────────────────────────────────────────────────

/** Legacy-shaped lender object (pages read Company_Name etc.). */
function mapLenderLegacy(l: Row, assignments: Row[]): Row {
  return {
    id: l.id,
    Lender_ID: l.lender_ref ?? "",
    Company_Name: l.company_name ?? "",
    Contact_Name: l.contact_name ?? "",
    Email: l.email ?? "",
    Phone: l.phone ?? "",
    Portal_Slug: l.portal_slug ?? "",
    NDA_Approved: Boolean(l.nda_approved),
    Criteria_Pills: l.criteria_pills ?? "",
    Status: l.deleted_at ? "Inactive" : "Active",
    Last_Contact_Date: l.last_contact_date ?? "",
    assignments: assignments
      .filter((a) => a.lender_id === l.id)
      .map((a) => ({
        id: a.id,
        assignmentId: a.assignment_ref ?? a.id,
        dealRef: a.deal_id,
        Deal_Ref: [a.deal_id],
        assignedAt: a.assigned_at ?? a.created_at ?? null,
        ndaApproved: Boolean(a.nda_approved),
      })),
  };
}

export async function fetchAdminLenders(): Promise<any[]> {
  const [lenders, assignments] = await Promise.all([
    api.get<Paginated<Row>>("/api/lenders?limit=200"),
    api.get<Paginated<Row>>("/api/deal-assignments?limit=200").catch(() => ({ rows: [] as Row[] })),
  ]);
  return lenders.rows.map((l) => mapLenderLegacy(l, assignments.rows ?? []));
}

export async function createLender(data: {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  status?: string;
  criteriaPills?: string;
}) {
  if (!data.email) throw new Error("An email is required — lenders now sign in with email + password.");
  const result = await api.post<Row>("/api/lenders/provision", {
    company_name: data.companyName,
    contact_name: data.contactName,
    email: data.email,
    phone: data.phone,
    criteria_pills: data.criteriaPills,
  });
  clearAirtableCache();
  // Legacy consumers read Airtable-style keys off the returned record.
  return {
    success: true,
    id: result.lender?.id,
    Company_Name: result.lender?.company_name ?? data.companyName,
    Contact_Name: result.lender?.contact_name ?? data.contactName,
    Email: result.lender?.email ?? data.email,
    Portal_Slug: result.portal_slug,
    Portal_Password: result.password,
    lender: result.lender,
    portalSlug: result.portal_slug,
    password: result.password,
  } as Row;
}

export async function assignDealToLender(lenderRecordId: string, dealRef: string, ndaApproved?: boolean) {
  const dealId = await resolveDealId(dealRef);
  return api.post<Row>("/api/deal-assignments", {
    lender_id: lenderRecordId,
    deal_id: dealId,
    nda_approved: ndaApproved ?? false,
  });
}

export async function removeDealAssignment(assignmentId: string) {
  return api.del<Row>(`/api/deal-assignments/${encodeURIComponent(assignmentId)}`);
}

export async function toggleLenderNda(lenderId: string, ndaApproved: boolean) {
  return api.patch<Row>(`/api/lenders/${encodeURIComponent(lenderId)}`, { nda_approved: ndaApproved });
}

export async function resetLenderPassword(lenderRecordId: string) {
  const r = await api.post<{ password: string }>("/api/lenders/reset-password", { lender_id: lenderRecordId });
  return { success: true, password: r.password };
}

/** Portal credentials are now the lender's Supabase account — same as a reset. */
export async function regenerateLenderPortal(lenderRecordId: string) {
  return resetLenderPassword(lenderRecordId);
}

export async function deleteLender(lenderRecordId: string) {
  return api.del<Row>(`/api/lenders/${encodeURIComponent(lenderRecordId)}`);
}

/** Plaintext passcodes no longer exist — reset instead. */
export async function fetchLenderPasscode(_lenderRecordId: string): Promise<string> {
  throw new Error("Passcodes are no longer stored. Use 'Reset password' to issue a new one.");
}

// ─── Deals ──────────────────────────────────────────────────────────────────

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

// ─── Documents ──────────────────────────────────────────────────────────────

export async function updateAdminDocuments(updates: Array<{ id: string; fields: Row }>) {
  const results = [];
  for (const u of updates) {
    results.push(await api.patch<Row>(`/api/documents/${encodeURIComponent(u.id)}`, mapKeys(u.fields, DOC_KEY_MAP)));
  }
  return { success: true, updated: results.length };
}

export async function createAdminDocument(data: {
  dealRef?: string;
  dealId?: string;
  documentName: string;
  category?: string;
  status?: string;
  ablCritical?: boolean;
  expectedDate?: string;
  internalNotes?: string;
  driveLink?: string;
}) {
  const dealId = data.dealId ?? (data.dealRef ? await resolveDealId(data.dealRef) : undefined);
  return api.post<Row>("/api/documents", {
    deal_id: dealId,
    document_name: data.documentName,
    category: data.category,
    status: data.status ?? "Outstanding",
    abl_critical: data.ablCritical ?? false,
    expected_date: data.expectedDate,
    internal_notes: data.internalNotes,
    legacy_drive_link: data.driveLink,
  });
}

export async function deleteAdminDocument(documentId: string) {
  return api.del<Row>(`/api/documents/${encodeURIComponent(documentId)}`);
}

/** Direct browser → Cloudinary upload via a server-signed payload.
 *  Accepts either a raw base64 string OR a full `data:<mime>;base64,…` URI —
 *  FileReader.readAsDataURL produces the latter, and atob() would throw on the
 *  `data:…;base64,` prefix, so we strip it here (this was breaking uploads). */
async function uploadToCloudinary(fileName: string, fileType: string, fileDataBase64: string, folder: string) {
  const signed = await api.post<Row>("/api/documents/sign-upload", { folder });

  // Cloudinary accepts a data-URI as the `file` param directly — simplest and
  // avoids any client-side base64 decoding entirely.
  const dataUri = fileDataBase64.startsWith("data:")
    ? fileDataBase64
    : `data:${fileType || "application/octet-stream"};base64,${fileDataBase64}`;

  const form = new FormData();
  form.append("file", dataUri);
  form.append("api_key", signed.apiKey);
  form.append("timestamp", String(signed.timestamp));
  form.append("signature", signed.signature);
  form.append("folder", signed.folder);
  form.append("type", "authenticated");

  const res = await fetch(`https://api.cloudinary.com/v1_1/${signed.cloudName}/auto/upload`, { method: "POST", body: form });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload?.error?.message ?? "Cloudinary upload failed");
  return { publicId: payload.public_id as string, secureUrl: payload.secure_url as string };
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
  const dealId = await resolveDealId(data.dealId);
  let asset: { publicId: string; secureUrl: string } | null = null;
  if (data.fileName && data.fileData) {
    asset = await uploadToCloudinary(data.fileName, data.fileType ?? "application/octet-stream", data.fileData, "aysan-deal-room/documents");
  }
  const row = await api.post<Row>("/api/documents", {
    deal_id: dealId,
    document_name: data.documentName,
    category: data.category,
    status: data.status || (asset ? "Received" : "Outstanding"),
    abl_critical: data.ablCritical ?? false,
    expected_date: data.expectedDate,
    internal_notes: data.internalNotes,
    ...(asset
      ? { cloudinary_public_id: asset.publicId, file_url: asset.secureUrl, date_received: new Date().toISOString().slice(0, 10) }
      : {}),
  });
  clearAirtableCache();
  return { success: true, document: row, result: row } as Row;
}

export async function analyzeAdminDocument(documentId: string): Promise<Row> {
  const r = await api.post<Row>("/api/ai/jobs", { type: "document-analysis", payload: { document_id: documentId } });
  // Legacy shape: 202-style { status, id } + sync-parse fields left undefined.
  return { success: true, status: "queued", id: r.job_id, jobId: r.job_id, documentId };
}

export async function parseAdminDocument(documentId: string): Promise<Row> {
  return analyzeAdminDocument(documentId);
}

// ─── IM documents on a deal (Cloudinary-backed deal file) ──────────────────

/** Upload a standalone file to Cloudinary and return its URL (replaces the
 *  legacy upload-temp-file action that pushed to public filebin.net). */
export async function uploadTempFile(fileName: string, fileType: string, fileDataBase64: string): Promise<{ url: string; publicId: string }> {
  const asset = await uploadToCloudinary(fileName, fileType, fileDataBase64, "aysan-deal-room/uploads");
  return { url: asset.secureUrl, publicId: asset.publicId };
}

export async function uploadImDocument(dealId: string, fileName: string, fileType: string, fileData: string) {
  const id = await resolveDealId(dealId);
  const asset = await uploadToCloudinary(fileName, fileType, fileData, "aysan-deal-room/im");
  return api.patch<Row>(`/api/deals/${encodeURIComponent(id)}`, {
    deal_files_cloudinary_id: asset.publicId,
    deal_files_secure_url: asset.secureUrl,
  });
}

export async function removeImDocument(dealId: string, _attachmentIndex?: number) {
  const id = await resolveDealId(dealId);
  return api.patch<Row>(`/api/deals/${encodeURIComponent(id)}`, {
    deal_files_cloudinary_id: null,
    deal_files_secure_url: null,
  });
}

export async function replaceImDocument(dealId: string, _attachmentIndex: number, fileName: string, fileType: string, fileData: string) {
  return uploadImDocument(dealId, fileName, fileType, fileData);
}

// ─── HR / team / stakeholders ───────────────────────────────────────────────

export async function fetchHrRegistry(): Promise<{
  team: any[];
  hires: any[];
  stakeholders: any[];
  shareholders: any[];
}> {
  const [team, hiring, stakeholders, shareholders] = await Promise.all([
    api.get<Paginated<Row>>("/api/team-members?limit=200"),
    api.get<Paginated<Row>>("/api/hiring-briefs?limit=200"),
    api.get<Paginated<Row>>("/api/stakeholders?limit=200"),
    api.get<Paginated<Row>>("/api/shareholders?limit=200").catch(() => ({ rows: [] as Row[] })),
  ]);
  return {
    team: team.rows.map((r) => ({
      id: r.id,
      initials: r.initials ?? "",
      name: r.name ?? "",
      role: r.role ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
      loginLink: r.login_link ?? "",
      status: r.status ?? "active",
      createdAt: r.created_at ?? "",
      lastLogin: "",
      accessLevel: r.access_level ?? "",
      avatarTheme: r.avatar_theme ?? "",
    })),
    hires: hiring.rows.map((r) => ({
      id: r.id,
      role: r.role ?? "",
      company: r.company ?? "",
      status: r.status_text ?? "",
      statusText: r.status_text ?? "",
      accentColor: r.accent_color ?? "",
      createdAt: r.created_at ?? "",
    })),
    stakeholders: stakeholders.rows.map((r) => ({
      id: r.id,
      name: r.name ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
      association: r.association ?? r.organization ?? "",
      type: r.type ?? "",
      accentColor: r.accent_color ?? "",
      description: r.description ?? "",
      status: r.status ?? "active",
      loginLink: r.login_link ?? "",
      createdAt: r.created_at ?? "",
      lastLogin: "",
    })),
    shareholders: (shareholders.rows ?? []).map((r) => ({
      id: r.id,
      name: r.name ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
      notes: r.notes ?? "",
      status: r.status ?? "active",
      loginLink: "",
      createdAt: r.created_at ?? "",
      lastLogin: r.last_login_at ?? "",
    })),
  };
}

export async function addHiringBrief(data: { role: string; company?: string; statusText?: string; accentColor?: string }) {
  return api.post<Row>("/api/hiring-briefs", {
    role: data.role,
    company: data.company,
    status_text: data.statusText,
    accent_color: data.accentColor,
  });
}

export async function deleteHiringBrief(id: string) {
  return api.del<Row>(`/api/hiring-briefs/${encodeURIComponent(id)}`);
}

/** Legacy record-shaped team list ({ id, fields: {Name, …} }) for old pages. */
export async function fetchTeamMemberRecords(): Promise<Array<{ id: string; fields: Row }>> {
  const page = await api.get<Paginated<Row>>("/api/team-members?limit=200");
  return page.rows.map((r) => ({
    id: r.id,
    fields: {
      Name: r.name,
      Role: r.role,
      Status: (r.status ?? "active").toLowerCase() === "inactive" ? "Inactive" : "Active",
      Access_Level: r.access_level,
      Email: r.email,
      Initials: r.initials,
    },
  }));
}

export interface TeamMemberPayload {
  name: string;
  role?: string;
  accessLevel?: string;
  email?: string;
  phone?: string;
  status?: string;
}

export async function createTeamMember(data: TeamMemberPayload) {
  return api.post<Row>("/api/team-members", {
    name: data.name,
    role: data.role,
    access_level: data.accessLevel,
    email: data.email,
    phone: data.phone,
    status: (data.status ?? "active").toLowerCase(),
    initials: data.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
  });
}

export async function updateTeamMember(memberId: string, fields: Row) {
  const map: Record<string, string> = {
    Name: "name", Role: "role", Access_Level: "access_level", Email: "email",
    Phone: "phone", Status: "status", Initials: "initials", Avatar_Theme: "avatar_theme", Order: "sort_order",
  };
  return api.patch<Row>(`/api/team-members/${encodeURIComponent(memberId)}`, mapKeys(fields, map));
}

export interface StakeholderPayload {
  name: string;
  association?: string;
  description?: string;
  type?: string;
  email?: string;
  phone?: string;
  organization?: string;
  notes?: string;
  status?: string;
}

export async function createStakeholder(data: StakeholderPayload) {
  return api.post<Row>("/api/stakeholders", {
    name: data.name,
    association: data.association,
    description: data.description,
    type: data.type,
    email: data.email,
    phone: data.phone,
    organization: data.organization,
    notes: data.notes,
    status: (data.status ?? "active").toLowerCase(),
  });
}

export async function updateStakeholder(stakeholderId: string, fields: Row) {
  const map: Record<string, string> = {
    Name: "name", Association: "association", Description: "description", Type: "type", Email: "email",
    Phone: "phone", Organization: "organization", Notes: "notes", Status: "status", Accent_Color: "accent_color", Company: "company",
  };
  return api.patch<Row>(`/api/stakeholders/${encodeURIComponent(stakeholderId)}`, mapKeys(fields, map));
}

// ─── AI: transcripts, briefs, OSINT, financial ─────────────────────────────

export async function analyzeTranscript(dealId: string, text: string, fileName?: string) {
  const id = await resolveDealId(dealId);
  const row = await api.post<Row>("/api/transcripts", {
    deal_id: id,
    transcript: text,
    name: fileName ?? `Transcript ${new Date().toISOString().slice(0, 10)}`,
    processing_status: "queued",
  });
  const job = await api.post<Row>("/api/ai/jobs", { type: "transcript-analysis", payload: { transcript_analysis_id: row.id } });
  return { success: true, jobId: job.job_id, transcriptId: row.id, recordId: row.id };
}

export async function fetchTranscriptAnalyses(dealId: string) {
  const id = await resolveDealId(dealId).catch(() => dealId);
  const page = await api.get<Paginated<Row>>(`/api/transcripts?deal_id=${encodeURIComponent(id)}`);
  // Content lives under `analysis` (jsonb); the tab reads flat fields and calls
  // .discussionPoints.map — provide safe defaults so it never crashes.
  return page.rows.map((r) => {
    const a = r.analysis ?? {};
    return {
      id: r.id,
      name: r.name ?? "",
      timestamp: r.processed_at ?? r.created_at ?? "",
      summary: a.summary ?? "",
      sentiment: a.sentiment ?? "Neutral",
      dealScore: typeof a.dealScore === "number" ? a.dealScore : 0,
      discussionPoints: Array.isArray(a.discussionPoints) ? a.discussionPoints : [],
      actionItems: Array.isArray(a.actionItems) ? a.actionItems : [],
      risks: Array.isArray(a.risks) ? a.risks : [],
      opportunities: Array.isArray(a.opportunities) ? a.opportunities : [],
      processing_status: r.processing_status ?? "",
    };
  });
}

/** Flatten a brief row: the page reads brief content as top-level fields, but
 *  the API stores the AI output under `brief_data`. Array fields are defaulted
 *  so the page's unguarded `.map` calls never crash on legacy/migrated shapes. */
function flattenBrief(r: Row): Row {
  const data = (r.brief_data && typeof r.brief_data === "object") ? r.brief_data : {};
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    ...data,
    criticalUnknowns: arr(data.criticalUnknowns),
    dealKillers: arr(data.dealKillers),
    teamDeploymentPlan: arr(data.teamDeploymentPlan),
    callPhaseOwnership: arr(data.callPhaseOwnership),
    participantQuestionBank: arr(data.participantQuestionBank),
    internalWatchouts: arr(data.internalWatchouts),
    recommendedNextActions: arr(data.recommendedNextActions),
    scores: (data.scores && typeof data.scores === "object") ? data.scores : {},
    id: r.id,
    deal_id: r.deal_id,
    name: r.name,
    created_at: r.created_at,
    processed_at: r.processed_at,
  };
}

export async function fetchPrecallBriefs(dealId: string) {
  const id = await resolveDealId(dealId).catch(() => dealId);
  const page = await api.get<Paginated<Row>>(`/api/briefs/precall?deal_id=${encodeURIComponent(id)}`);
  return page.rows.map(flattenBrief);
}

export async function generatePrecallBrief(data: { dealId: string; [k: string]: any }): Promise<Row> {
  const { dealId, ...params } = data;
  const id = await resolveDealId(dealId);
  const job = await api.post<Row>("/api/ai/jobs", { type: "precall-brief", payload: { deal_id: id, params } });
  return { success: true, status: "queued", id: job.job_id, jobId: job.job_id };
}

export async function askPrecallBriefQuestion(data: {
  dealId?: string;
  briefId?: string;
  question: string;
  brief?: Row;
  history?: Array<{ q: string; a: string }>;
}): Promise<Row> {
  let dealId = data.dealId;
  let brief = data.brief;
  // Legacy callers pass only briefId — resolve the deal (and brief) from it.
  if (!dealId && data.briefId) {
    const briefRow = await api.get<Row>(`/api/briefs/precall?limit=200`).then(
      (p: any) => (p.rows as Row[]).find((b) => b.id === data.briefId),
    );
    if (briefRow) {
      dealId = briefRow.deal_id ?? undefined;
      brief = brief ?? briefRow.brief_data ?? undefined;
    }
  }
  if (!dealId) throw new Error("Could not resolve the deal for this brief.");
  const id = await resolveDealId(dealId);
  const r = await api.post<{ answer: string }>("/api/ai/ask", {
    deal_id: id,
    question: data.question,
    brief,
    history: data.history ?? [],
  });
  return { answer: r.answer, aiAnswers: r.answer };
}

export async function fetchPostcallBriefs(dealId: string) {
  const id = await resolveDealId(dealId).catch(() => dealId);
  const page = await api.get<Paginated<Row>>(`/api/briefs/postcall?deal_id=${encodeURIComponent(id)}`);
  return page.rows.map(flattenBrief);
}

export async function generatePostcallBrief(data: { dealId: string; notes: string; schemaId?: string }): Promise<Row> {
  const id = await resolveDealId(data.dealId);
  const job = await api.post<Row>("/api/ai/jobs", {
    type: "postcall-brief",
    payload: { deal_id: id, notes: data.notes, schema_id: data.schemaId },
  });
  return { success: true, status: "queued", id: job.job_id, jobId: job.job_id };
}

export async function overridePostcallScores(data: {
  briefId: string;
  scores?: Row;
  overrides?: Row;
  summary?: string;
  dealId?: string;
}) {
  const scores = data.scores ?? data.overrides ?? {};
  const existing = await api.get<Row>(`/api/postcall-briefs/${encodeURIComponent(data.briefId)}`);
  const prev = existing.brief_data ?? {};
  const briefData = {
    ...prev,
    scores: { ...(prev.scores ?? {}), ...scores },
    ...(data.summary ? { summary: data.summary } : {}),
  };
  return api.patch<Row>(`/api/postcall-briefs/${encodeURIComponent(data.briefId)}`, { brief_data: briefData });
}

export async function triggerOsintEnrichment(dealId: string): Promise<{ success: boolean; message: string }> {
  const id = await resolveDealId(dealId);
  await api.post<Row>("/api/ai/jobs", { type: "osint-scan", payload: { deal_id: id } });
  return { success: true, message: "OSINT enrichment queued." };
}

export async function triggerFinancialAnalysis(_dealId: string, _documentId?: string): Promise<{ success: boolean; message: string }> {
  throw new Error("Financial analysis is being rebuilt on the new job system and is not available yet.");
}

// ─── Job status polling ─────────────────────────────────────────────────────

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

/**
 * Legacy-compatible job polling. `recordId` is now a JOB ID from the new job
 * system (returned by analyze/generate calls); `table`/`jobType` are ignored.
 */
export async function getJobStatus(_table: string, recordId: string, _jobType?: string): Promise<JobStatusResponse> {
  const job = await api.get<Row>(`/api/jobs/status?id=${encodeURIComponent(recordId)}`);
  const status =
    job.status === "done" ? "completed"
    : job.status === "failed" ? "failed"
    : job.status === "running" ? "processing"
    : "queued";
  return {
    recordId,
    table: _table,
    status,
    error: job.error ?? null,
    startedAt: job.created_at ?? null,
    completedAt: job.finished_at ?? null,
    hasContent: job.status === "done",
    isComplete: job.status === "done",
    isFailed: job.status === "failed",
    isProcessing: job.status === "running" || job.status === "queued",
  };
}

// ─── Portfolio ──────────────────────────────────────────────────────────────

export async function fetchPortfolioData(): Promise<Row> {
  const s = await api.get<Row>("/api/portfolio/summary");
  const metrics = (s.metrics ?? []).map((m: Row) => ({
    id: m.id,
    companyId: m.company_id ?? m.legacy_company_id ?? "",
    companyName: m.company_name ?? "",
    reportingPeriod: m.reporting_period ?? "",
    revenue: m.revenue ?? 0,
    ebitda: m.ebitda ?? 0,
    dscr: m.dscr ?? 0,
    leverage: m.leverage ?? 0,
    headcount: m.headcount ?? 0,
    churnRate: m.churn_rate ?? 0,
    recurringRevenue: m.recurring_revenue ?? 0,
  }));
  const alerts = (s.alerts ?? []).map((a: Row) => ({
    id: a.id,
    companyId: a.company_id ?? a.legacy_company_id ?? "",
    companyName: a.company_name ?? "",
    alertType: a.alert_type ?? "",
    severity: a.severity ?? "info",
    explanation: a.explanation ?? "",
    triggeredAt: a.triggered_at ?? "",
    resolvedAt: a.resolved_at ?? null,
  }));
  const healths = (s.healths ?? []).map((h: Row) => ({
    id: h.id,
    companyId: h.company_id ?? h.legacy_company_id ?? "",
    companyName: h.company_name ?? "",
    portfolioScore: h.portfolio_score ?? 0,
    riskLevel: h.risk_level ?? "",
    activeAlerts: h.active_alerts ?? 0,
    trendSummary: h.trend_summary ?? "",
    updatedAt: h.updated_at ?? "",
  }));
  const healthIndex = healths.length
    ? Math.round(healths.reduce((sum: number, h: Row) => sum + (h.portfolioScore ?? 0), 0) / healths.length)
    : 100;
  return {
    success: true,
    metrics,
    alerts,
    healths,
    companies: s.companies ?? [],
    summaryBriefing: "",
    healthIndex,
    isFallbackActive: false,
  };
}

export async function triggerPortfolioAnalysis() {
  const job = await api.post<Row>("/api/ai/jobs", { type: "portfolio-briefing", payload: {} });
  return { success: true, jobId: job.job_id };
}

export interface PortfolioCompanyPayload {
  companyName: string;
  industry?: string;
  location?: string;
  revenue?: number;
  ebitda?: number;
  debt?: number;
  headcount?: number;
  status?: string;
  notes?: string;
}

export async function createPortfolioCompany(data: PortfolioCompanyPayload) {
  return api.post<Row>("/api/portfolio-companies", {
    company_name: data.companyName,
    industry: data.industry,
    location: data.location,
    revenue: data.revenue,
    ebitda: data.ebitda,
    debt: data.debt,
    headcount: data.headcount,
    status: (data.status ?? "active").toLowerCase(),
    notes: data.notes,
  });
}

export async function updatePortfolioCompany(companyId: string, fields: Row) {
  const map: Record<string, string> = {
    Company_Name: "company_name", Industry: "industry", Location: "location", Revenue: "revenue",
    EBITDA: "ebitda", Debt: "debt", Headcount: "headcount", Status: "status", Notes: "notes",
  };
  return api.patch<Row>(`/api/portfolio-companies/${encodeURIComponent(companyId)}`, mapKeys(fields, map));
}

export async function archivePortfolioCompany(companyId: string) {
  return api.patch<Row>(`/api/portfolio-companies/${encodeURIComponent(companyId)}`, { status: "archived" });
}

export async function fetchPortfolioCompanies() {
  const page = await api.get<Paginated<Row>>("/api/portfolio-companies?limit=200");
  return page.rows;
}

// ─── Auth / settings ────────────────────────────────────────────────────────

export async function changeAdminPassword(currentPassword: string, newPassword: string) {
  const res = await fetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Failed to change password");
  return payload;
}

export async function resetAdminPassword(_masterPasscode: string, _newPassword: string): Promise<Row> {
  throw new Error("Master-passcode resets were removed. Ask an owner to reset your account in Supabase.");
}

export async function verifyIntegration(_integrationId: string): Promise<Row> {
  throw new Error("Integration checks are being rebuilt and are not available yet.");
}

// ─── Legacy webhooks (not yet ported) ───────────────────────────────────────

export async function sendLoiWebhook(_data: Row): Promise<Row> {
  throw new Error("LOI sending is being rebuilt and is not available yet.");
}

export async function sendEmailWebhook(_data: Row): Promise<Row> {
  throw new Error("Email sending is being rebuilt and is not available yet.");
}
