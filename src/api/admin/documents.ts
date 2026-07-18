/** Admin client — Documents + Cloudinary-backed IM deal files. */
import { api } from "../http";
import { clearAirtableCache } from "../airtable";
import { type Row, mapKeys, resolveDealId, DOC_KEY_MAP, uploadToCloudinary } from "./_shared";

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
