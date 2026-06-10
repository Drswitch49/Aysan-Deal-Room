/**
 * Document Parse — Trigger Endpoint
 *
 * POST /api/documents/parse
 *
 * Queues a document-analysis job (stage="parse") and returns 202 immediately.
 * When QStash is not configured (local dev), falls back to inline synchronous processing.
 *
 * Job worker: /api/jobs/document-analysis (stage=parse)
 */

import { airtableFetchRecord, airtableUpdate } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { authenticateAdmin } from "../admin/lenders.js";
import { emitEvent, hasInngest } from "../_events/emit.js";
import { updateJobStatus } from "../_utils/job-status.js";

// ─── Inline Sync Fallback (local dev without QStash) ──────────────────────
// Reuses the same logic as the worker for consistency.

import path from "path";

type FileType = "pdf" | "docx" | "xlsx" | "csv" | "text" | "image" | "unknown";

function detectFileType(fileName: string, mimeType?: string): FileType {
  const ext = path.extname(fileName || "").toLowerCase();
  if (ext === ".pdf" || mimeType === "application/pdf") return "pdf";
  if (ext === ".docx" || mimeType?.includes("wordprocessingml")) return "docx";
  if (ext === ".doc") return "docx";
  if (ext === ".xlsx" || mimeType?.includes("spreadsheetml")) return "xlsx";
  if (ext === ".xls") return "xlsx";
  if (ext === ".csv" || mimeType === "text/csv") return "csv";
  if ([".txt", ".md", ".json", ".log"].includes(ext)) return "text";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return "image";
  return "unknown";
}

function cleanExtractedText(raw: string, maxChars = 60_000): string {
  if (!raw) return "";
  let cleaned = raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .trim();
  if (cleaned.length > maxChars) {
    const cut = cleaned.lastIndexOf("\n", maxChars);
    cleaned =
      cleaned.substring(0, cut > maxChars * 0.9 ? cut : maxChars).trim() +
      "\n\n[... document truncated for storage ...]";
  }
  return cleaned;
}

async function runInlineSync(
  table: string,
  documentId: string,
  docFields: Record<string, any>
): Promise<{ fileType: string; characterCount: number; wordCount: number }> {
  const documentName: string =
    docFields["Document_Name"] || docFields["Name"] || "document";

  let fileUrl = "";
  const rawLink = docFields["Drive_Link"];
  if (Array.isArray(rawLink) && rawLink.length > 0) {
    fileUrl = rawLink[0]?.url || String(rawLink[0]) || "";
  } else if (typeof rawLink === "string") {
    fileUrl = rawLink;
  }

  if (!fileUrl) throw new Error("No file URL on document record");

  const fileResponse = await fetch(fileUrl, {
    signal: AbortSignal.timeout(25_000),
  });
  if (!fileResponse.ok) throw new Error(`File download: ${fileResponse.status}`);

  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  if (buffer.length === 0) throw new Error("Downloaded file is empty");

  const contentType = fileResponse.headers.get("content-type") || undefined;
  const fileType = detectFileType(documentName, contentType);
  let rawText = "";

  switch (fileType) {
    case "pdf": {
      const pdfParse = (await import("pdf-parse")).default;
      rawText = (await pdfParse(buffer)).text || "";
      break;
    }
    case "docx": {
      const mammoth = await import("mammoth");
      rawText = (await mammoth.extractRawText({ buffer })).value || "";
      break;
    }
    case "xlsx": {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buffer, { type: "buffer" });
      const lines: string[] = [];
      for (const sn of wb.SheetNames) {
        const sheet = wb.Sheets[sn];
        lines.push(`=== Sheet: ${sn} ===`);
        const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        for (const row of rows) {
          const t = (row as string[]).map((c) => String(c ?? "").trim()).filter(Boolean).join(" | ");
          if (t) lines.push(t);
        }
        lines.push("");
      }
      rawText = lines.join("\n");
      break;
    }
    case "image":
      rawText = `[Image document: ${documentName}. OCR extraction pending.]`;
      break;
    default:
      rawText = buffer.toString("utf-8");
  }

  const extractedText = cleanExtractedText(rawText);
  if (extractedText.trim().length < 10) {
    throw new Error("Text extraction produced no usable content");
  }

  await airtableUpdate(table, documentId, {
    Extracted_Text: extractedText,
    Processing_Status: "extracted",
    Processed_At: new Date().toISOString(),
    Processing_Error: "",
  });

  return {
    fileType,
    characterCount: extractedText.length,
    wordCount: extractedText.split(/\s+/).filter(Boolean).length,
  };
}

// ─── Main Handler ──────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await authenticateAdmin(req);

    const { documentId } = req.body || {};
    if (!documentId) {
      return res.status(400).json({ error: "documentId is required" });
    }

    const table = TABLES.DOCUMENTS || "Documents";

    // Fetch record to validate it exists and get file URL for sync fallback
    const docRecord = await airtableFetchRecord(table, documentId);
    if (!docRecord) {
      return res.status(404).json({ error: "Document record not found" });
    }

    const docFields = docRecord.fields as Record<string, any>;

    // Mark as queued immediately
    await updateJobStatus(table, documentId, { status: "queued" });

    // Emit Inngest event — if configured, return 202 immediately
    if (hasInngest()) {
      await emitEvent("document/parse_requested", { documentId });
      return res.status(202).json({
        status: "queued",
        documentId,
        message: "Document parse queued via Inngest. Poll /api/jobs/status for progress.",
      });
    }

    // ── Sync fallback (no QStash configured) ───────────────────────────────
    console.log("[Document Parse] QStash not configured — running synchronously");
    await updateJobStatus(table, documentId, {
      status: "processing",
      startedAt: new Date().toISOString(),
    });

    const result = await runInlineSync(table, documentId, docFields);

    return res.status(200).json({
      status: "completed",
      documentId,
      ...result,
      sync: true,
    });
  } catch (err: any) {
    console.error("[Document Parse Trigger Error]:", err);

    if (req.body?.documentId) {
      try {
        await airtableUpdate(TABLES.DOCUMENTS || "Documents", req.body.documentId, {
          Processing_Status: "failed",
          Processing_Error: err.message?.substring(0, 500) || "Unknown error",
          Processed_At: new Date().toISOString(),
        });
      } catch (_) {}
    }

    return res.status(err.status || 500).json({
      error: err.message || "Failed to queue document parse job",
    });
  }
}
