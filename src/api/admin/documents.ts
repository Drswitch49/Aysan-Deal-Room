/** Admin client — Documents + Cloudinary-backed IM deal files. */
import { api } from "../http";
import { clearAirtableCache } from "../airtable";
import { type Row, mapKeys, resolveDealId, DOC_KEY_MAP, uploadToCloudinary } from "./_shared";
import { enqueueAiJob } from "./ai";

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
  const r = await enqueueAiJob("document-analysis", { document_id: documentId });
  // Legacy shape: 202-style { status, id } + sync-parse fields left undefined.
  return { success: true, status: "queued", id: r.job_id, jobId: r.job_id, documentId };
}

export async function parseAdminDocument(documentId: string): Promise<Row> {
  return analyzeAdminDocument(documentId);
}

/**
 * Short-lived signed URL for opening a checklist document.
 *
 * The stored Cloudinary URL is an `authenticated` asset that 401s in the
 * browser, so View/Download cannot link to it directly — they resolve through
 * here first. `view` renders inline; `download` comes back as an attachment.
 */
export async function getDocumentFileUrl(
  documentId: string,
  mode: "view" | "download" = "view",
): Promise<string> {
  const r = await api.get<{ url: string }>(
    `/api/documents/download?id=${encodeURIComponent(documentId)}&mode=${mode}`,
    { noCache: true },
  );
  if (!r?.url) throw new Error("This document has no file attached.");
  return r.url;
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

// ─── Multi-file IM/Review documents (im_review_documents table) ─────────────
// Unlike the single deal_files_secure_url column above, these let a deal carry
// any number of IM/Review files, each keeping its own uploaded document name.
export interface ImDoc {
  id?: string;
  url: string;
  filename: string;
  publicId?: string | null;
  fileType?: string | null;
}

export async function listImDocuments(dealId: string): Promise<ImDoc[]> {
  const id = await resolveDealId(dealId);
  const page = await api.get<{ rows: Row[] }>(`/api/im-documents?deal_id=${encodeURIComponent(id)}&limit=200`);
  return (page.rows || [])
    .map((r) => ({
      id: r.id as string,
      url: (r.file_url || r.legacy_file_url || "") as string,
      filename: (r.document_name || "Document") as string,
      publicId: (r.cloudinary_public_id ?? null) as string | null,
      fileType: (r.file_type ?? null) as string | null,
    }))
    .filter((d) => d.url);
}

export async function createImDocument(dealId: string, doc: ImDoc): Promise<Row> {
  const id = await resolveDealId(dealId);
  const row = await api.post<Row>("/api/im-documents", {
    deal_id: id,
    document_name: doc.filename,
    file_url: doc.url,
    cloudinary_public_id: doc.publicId ?? null,
    file_type: doc.fileType ?? null,
    uploaded_at: new Date().toISOString(),
  });
  clearAirtableCache();
  return row;
}

export async function deleteImDocumentRow(docId: string): Promise<Row> {
  const row = await api.del<Row>(`/api/im-documents/${encodeURIComponent(docId)}`);
  clearAirtableCache();
  return row;
}

export async function replaceImDocument(dealId: string, _attachmentIndex: number, fileName: string, fileType: string, fileData: string) {
  return uploadImDocument(dealId, fileName, fileType, fileData);
}
