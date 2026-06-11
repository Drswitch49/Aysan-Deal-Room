/**
 * Document Processor — Shared utility for text extraction and AI analysis.
 *
 * Used by both the Inngest workflow steps and the legacy QStash job workers.
 * Extracted so neither the HTTP handler bodies nor the Inngest steps contain
 * duplicated logic.
 *
 * On Vercel Pro (maxDuration: 300s) these operations run without time pressure.
 */

import path from "path";
import { airtableFetchRecord, airtableUpdate } from "./airtable.js";
import { updateJobStatus, failJob } from "./job-status.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type FileType = "pdf" | "docx" | "xlsx" | "csv" | "text" | "image" | "unknown";

export interface ParseResult {
  documentId: string;
  fileType: FileType;
  characterCount: number;
  wordCount: number;
  extractedText: string;
}

export interface AnalyzeResult {
  documentId: string;
  summary: string;
  risks: string[];
  covenants: string[];
  keyClauses: Array<{ term: string; details: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function detectFileType(fileName: string, mimeType?: string): FileType {
  const ext = path.extname(fileName || "").toLowerCase();
  if (ext === ".pdf" || mimeType === "application/pdf") return "pdf";
  if (ext === ".docx" || mimeType?.includes("wordprocessingml")) return "docx";
  if (ext === ".doc") return "docx";
  if (ext === ".xlsx" || mimeType?.includes("spreadsheetml")) return "xlsx";
  if (ext === ".xls") return "xlsx";
  if (ext === ".csv") return "csv";
  if ([".txt", ".md", ".json"].includes(ext)) return "text";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".tiff"].includes(ext)) return "image";
  return "unknown";
}

export function cleanExtractedText(raw: string, maxChars = 80_000): string {
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
    const cutPoint = cleaned.lastIndexOf("\n", maxChars);
    cleaned =
      cleaned.substring(0, cutPoint > maxChars * 0.9 ? cutPoint : maxChars).trim() +
      "\n\n[... document truncated for storage ...]";
  }
  return cleaned;
}

function stripJsonFences(raw: string): string {
  let clean = raw.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  }
  return clean;
}

// ─── Stage 1: Parse ───────────────────────────────────────────────────────────

/**
 * Downloads the document file, extracts text, and persists to Airtable.
 * Updates Processing_Status: processing → extracted.
 */
export async function parseDocument(
  table: string,
  documentId: string
): Promise<ParseResult> {
  await updateJobStatus(table, documentId, {
    status: "processing",
    startedAt: new Date().toISOString(),
  });

  const docRecord = await airtableFetchRecord(table, documentId);
  if (!docRecord) {
    await failJob(table, documentId, "Document record not found in Airtable");
    throw new Error("Document not found");
  }

  const docFields = docRecord.fields as Record<string, any>;
  const documentName: string =
    docFields["Document_Name"] || docFields["Name"] || "document";

  // Resolve file URL — Drive_Link can be an attachment array or URL string
  let fileUrl = "";
  const rawLink = docFields["Drive_Link"];
  if (Array.isArray(rawLink) && rawLink.length > 0) {
    fileUrl = rawLink[0]?.url || String(rawLink[0]) || "";
  } else if (typeof rawLink === "string") {
    fileUrl = rawLink;
  }

  if (!fileUrl) {
    await failJob(table, documentId, "No file URL found on document record");
    throw new Error("No file URL");
  }

  // Download file (30s timeout on Vercel Pro — enough for large files)
  let fileResponse: Response;
  try {
    fileResponse = await fetch(fileUrl, {
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: any) {
    await failJob(table, documentId, `File download failed: ${err.message}`);
    throw new Error(`Download failed: ${err.message}`);
  }

  if (!fileResponse.ok) {
    const msg = `File host returned ${fileResponse.status}`;
    await failJob(table, documentId, msg);
    throw new Error(msg);
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length === 0) {
    await failJob(table, documentId, "Downloaded file is empty");
    throw new Error("Empty file");
  }

  // Detect type and extract text
  const contentType = fileResponse.headers.get("content-type") || undefined;
  const fileType = detectFileType(documentName, contentType);
  let rawText = "";

  switch (fileType) {
    case "pdf": {
      const pdfParse = ((await import("pdf-parse")) as any).default || ((await import("pdf-parse")) as any);
      const result = await pdfParse(buffer);
      rawText = result.text || "";
      break;
    }
    case "docx": {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      rawText = result.value || "";
      break;
    }
    case "xlsx": {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buffer, { type: "buffer" });
      const lines: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        lines.push(`=== Sheet: ${sheetName} ===`);
        const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: "",
        });
        for (const row of rows) {
          const rowText = (row as string[])
            .map((c) => String(c ?? "").trim())
            .filter(Boolean)
            .join(" | ");
          if (rowText) lines.push(rowText);
        }
        lines.push("");
      }
      rawText = lines.join("\n");
      break;
    }
    case "csv":
    case "text":
    case "unknown":
      rawText = buffer.toString("utf-8");
      break;
    case "image":
      rawText = `[Image document: ${documentName}. Manual review required.]`;
      break;
  }

  const extractedText = cleanExtractedText(rawText);

  if (extractedText.trim().length < 10) {
    await failJob(table, documentId, "Text extraction produced no usable content");
    throw new Error("Extraction yielded no content");
  }

  // Persist extracted text to Airtable
  await airtableUpdate(table, documentId, {
    Extracted_Text: extractedText,
    Processing_Status: "extracted",
    Processed_At: new Date().toISOString(),
  });

  console.log(`[Doc Parse] ✓ ${documentId} — ${fileType}, ${extractedText.length} chars`);

  return {
    documentId,
    fileType,
    characterCount: extractedText.length,
    wordCount: extractedText.split(/\s+/).filter(Boolean).length,
    extractedText,
  };
}

// ─── Stage 2: Analyze ────────────────────────────────────────────────────────

/**
 * Reads Extracted_Text from Airtable, calls Claude, and persists the structured
 * analysis back. Updates Processing_Status: analyzing → completed.
 * On Vercel Pro the Claude timeout is 120s (well within 300s function limit).
 */
export async function analyzeDocument(
  table: string,
  documentId: string
): Promise<AnalyzeResult> {
  await updateJobStatus(table, documentId, {
    status: "analyzing",
    startedAt: new Date().toISOString(),
  });

  const docRecord = await airtableFetchRecord(table, documentId);
  if (!docRecord) {
    await failJob(table, documentId, "Document record not found");
    throw new Error("Document not found");
  }

  const docFields = docRecord.fields as Record<string, any>;
  const documentName = docFields["Document_Name"] || docFields["Name"] || "Document";
  const category = docFields["Category"] || "General";
  const extractedText: string = docFields["Extracted_Text"] || "";

  if (!extractedText || extractedText.trim().length < 10) {
    await failJob(table, documentId, "No extracted text found. Run parse stage first.");
    throw new Error("No extracted text — run parse first");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await failJob(table, documentId, "ANTHROPIC_API_KEY is not configured");
    throw new Error("AI service not configured");
  }

  // On Pro we can send up to 25k chars of context comfortably
  const inputText = extractedText.substring(0, 25_000);

  const systemPrompt = `You are a senior investment associate at Aysan Capital Partners (ACP).
Analyse the document and extract critical transaction intelligence.

Document: ${documentName} | Category: ${category}

RULES:
- Base analysis ONLY on the provided text. Do NOT fabricate details.
- If information is not present in the text, omit it or note "Not specified".

Respond ONLY with this exact JSON schema:
{
  "summary": "One paragraph executive summary of the document contents and key findings",
  "keyClauses": [{ "term": "string", "details": "string" }],
  "risks": ["string"],
  "covenants": ["string"]
}`;

  let claudeResponse: Response;
  try {
    claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(120_000), // 2 minutes max for Claude on Pro
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: "user", content: inputText }],
      }),
    });
  } catch (err: any) {
    await failJob(table, documentId, `Claude call failed: ${err.message}`);
    throw new Error(`AI call failed: ${err.message}`);
  }

  if (!claudeResponse.ok) {
    const errText = await claudeResponse.text();
    await failJob(table, documentId, `Claude API ${claudeResponse.status}: ${errText}`);
    throw new Error(`AI API error: ${claudeResponse.status}`);
  }

  const claudePayload = await claudeResponse.json();
  const rawContent: string = claudePayload.content?.[0]?.text || "";

  let parsed: any = {};
  try {
    parsed = JSON.parse(stripJsonFences(rawContent));
  } catch (err: any) {
    await failJob(table, documentId, `JSON parse error: ${err.message}. Raw: ${rawContent.substring(0, 200)}`);
    throw new Error("Failed to parse AI response");
  }

  const risks: string[] = Array.isArray(parsed.risks) ? parsed.risks : [];
  const covenants: string[] = Array.isArray(parsed.covenants) ? parsed.covenants : [];
  const keyClauses: Array<{ term: string; details: string }> = Array.isArray(parsed.keyClauses)
    ? parsed.keyClauses
    : [];

  // Persist AI analysis to Airtable
  await airtableUpdate(table, documentId, {
    Summary: parsed.summary || "",
    Risks: risks.length > 0 ? "• " + risks.join("\n• ") : "",
    Covenants: covenants.length > 0 ? "• " + covenants.join("\n• ") : "",
    Processing_Status: "completed",
    Processed_At: new Date().toISOString(),
    Processing_Error: "",
  });

  console.log(`[Doc Analyze] ✓ ${documentId} — analysis complete`);

  return {
    documentId,
    summary: parsed.summary || "",
    risks,
    covenants,
    keyClauses,
  };
}
