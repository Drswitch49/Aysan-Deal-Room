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

// ─── IM & supporting attachments on a deal ─────────────────────────────────
//
// Attachments live one row per file in `im_review_documents`, which keeps each
// upload's own `document_name` and lets a deal carry any number of them.
//
// `deals.deal_files_cloudinary_id/_secure_url` is a single slot with nowhere to
// put a name — uploading through it is what made every attachment render as the
// literal "Deal file" and made each upload overwrite the last. It is now only
// kept pointing at the newest attachment, so the older views that read it (the
// deal inbox list, the IM step of the deal checklist) still see that a deal has
// an IM attached.

/** Upload a standalone file to Cloudinary and return its URL (replaces the
 *  legacy upload-temp-file action that pushed to public filebin.net). */
export async function uploadTempFile(fileName: string, fileType: string, fileDataBase64: string): Promise<{ url: string; publicId: string }> {
  const asset = await uploadToCloudinary(fileName, fileType, fileDataBase64, "aysan-deal-room/uploads");
  return { url: asset.secureUrl, publicId: asset.publicId };
}

export interface ImDoc {
  id?: string;
  url: string;
  filename: string;
  publicId?: string | null;
  fileType?: string | null;
}

/** A deal's attachments, oldest first (the order they were uploaded in). */
export async function listImDocuments(dealId: string): Promise<ImDoc[]> {
  const id = await resolveDealId(dealId);
  const page = await api.get<{ rows: Row[] }>(
    `/api/im-documents?deal_id=${encodeURIComponent(id)}&limit=200&orderBy=created_at&ascending=true`,
  );
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

/** Re-point the deal's legacy single-file columns at the newest attachment. */
async function syncDealFilePointer(dealId: string): Promise<void> {
  const docs = await listImDocuments(dealId);
  const newest = docs[docs.length - 1];
  await api.patch<Row>(`/api/deals/${encodeURIComponent(dealId)}`, {
    deal_files_cloudinary_id: newest?.publicId ?? null,
    deal_files_secure_url: newest?.url ?? null,
  });
}

/** Upload a new attachment, keeping the file's own name. */
export async function uploadImDocument(
  dealId: string,
  fileName: string,
  fileType: string,
  fileData: string,
): Promise<ImDoc> {
  const id = await resolveDealId(dealId);
  const asset = await uploadToCloudinary(fileName, fileType, fileData, "aysan-deal-room/im");
  const row = await createImDocument(id, {
    url: asset.secureUrl,
    filename: fileName,
    publicId: asset.publicId,
    fileType,
  });
  await syncDealFilePointer(id);
  return { id: row.id as string, url: asset.secureUrl, filename: fileName, publicId: asset.publicId, fileType };
}

/** Remove one attachment — or, with no id, every attachment on the deal. */
export async function removeImDocument(dealId: string, docId?: string): Promise<void> {
  const id = await resolveDealId(dealId);
  if (docId) {
    await deleteImDocumentRow(docId);
  } else {
    const docs = await listImDocuments(id);
    for (const doc of docs) if (doc.id) await deleteImDocumentRow(doc.id);
  }
  await syncDealFilePointer(id);
}

/** Swap an attachment's file, dropping the row it replaces. */
export async function replaceImDocument(
  dealId: string,
  docId: string | undefined,
  fileName: string,
  fileType: string,
  fileData: string,
): Promise<ImDoc> {
  const uploaded = await uploadImDocument(dealId, fileName, fileType, fileData);
  if (docId) {
    await deleteImDocumentRow(docId);
    await syncDealFilePointer(await resolveDealId(dealId));
  }
  return uploaded;
}

/**
 * Short-lived signed URL for an IM attachment.
 *
 * The stored Cloudinary URL is an `authenticated` asset that 401s in the
 * browser, so downloads resolve through here first; the URL it returns carries
 * an attachment content-disposition.
 */
export async function getImDocumentFileUrl(
  docId: string,
  mode: "view" | "download" = "download",
): Promise<string> {
  const r = await api.get<{ url: string }>(
    `/api/im-documents/download?id=${encodeURIComponent(docId)}&mode=${mode}`,
    { noCache: true },
  );
  if (!r?.url) throw new Error("This attachment has no file to download.");
  return r.url;
}
