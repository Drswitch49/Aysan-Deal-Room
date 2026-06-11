/**
 * Job Worker: Document Analysis
 *
 * Called by QStash. Processes documents in two stages:
 *   stage="parse"   — download file, extract text, persist to Airtable
 *   stage="analyze" — read extracted text, call Claude, persist AI analysis
 *
 * Vercel Hobby plan hard-limit: 10 seconds total.
 * Claude calls are capped at 8.5s via AbortSignal.timeout().
 * QStash retries up to 3× on any non-2xx response.
 */

import path from "path";
import { airtableFetchRecord, airtableUpdate } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { verifyQStashRequest } from "../_utils/qstash.js";
import { updateJobStatus, failJob } from "../_utils/job-status.js";

// ─── Timeout Constants ────────────────────────────────────────────────────
// Hobby plan = 10s total. We budget 8.5s for Claude leaving ~1.5s for Airtable I/O.

const AI_TIMEOUT_MS = 8_500;
const FETCH_TIMEOUT_MS = 15_000; // File host download

// ─── Text Cleaning ────────────────────────────────────────────────────────

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
    const cutPoint = cleaned.lastIndexOf("\n", maxChars);
    cleaned =
      cleaned.substring(0, cutPoint > maxChars * 0.9 ? cutPoint : maxChars).trim() +
      "\n\n[... document truncated for storage ...]";
  }
  return cleaned;
}

// ─── File Type Detection ──────────────────────────────────────────────────

type FileType = "pdf" | "docx" | "xlsx" | "csv" | "text" | "image" | "unknown";

function detectFileType(fileName: string, mimeType?: string): FileType {
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

// ─── Main Handler ─────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await verifyQStashRequest(req);
  } catch (err: any) {
    return res.status(err.status || 401).json({ error: err.message });
  }

  const { documentId, stage = "parse" } = req.body || {};

  if (!documentId) {
    return res.status(400).json({ error: "documentId is required" });
  }

  const table = TABLES.DOCUMENTS || "Documents";

  try {
    if (stage === "parse") {
      return await handleParse(table, documentId, res);
    }
    if (stage === "analyze") {
      return await handleAnalyze(table, documentId, res);
    }
    return res.status(400).json({ error: `Unknown stage: ${stage}` });
  } catch (err: any) {
    await failJob(table, documentId, err);
    // Return 500 so QStash retries the job
    return res.status(500).json({ error: err.message || "Worker failed" });
  }
}

// ─── Stage 1: Parse ───────────────────────────────────────────────────────

async function handleParse(table: string, documentId: string, res: any) {
  await updateJobStatus(table, documentId, {
    status: "processing",
    startedAt: new Date().toISOString(),
  });

  // Fetch document record from Airtable
  const docRecord = await airtableFetchRecord(table, documentId);
  if (!docRecord) {
    await failJob(table, documentId, "Document record not found in Airtable");
    return res.status(404).json({ error: "Document not found" });
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
    return res.status(422).json({ error: "No file URL" });
  }

  // Download file
  let fileResponse: Response;
  try {
    fileResponse = await fetch(fileUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err: any) {
    await failJob(table, documentId, `File download failed: ${err.message}`);
    return res.status(500).json({ error: `Download failed: ${err.message}` });
  }

  if (!fileResponse.ok) {
    const msg = `File host returned ${fileResponse.status}`;
    await failJob(table, documentId, msg);
    return res.status(500).json({ error: msg });
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length === 0) {
    await failJob(table, documentId, "Downloaded file is empty");
    return res.status(422).json({ error: "Empty file" });
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
    return res.status(422).json({ error: "Extraction yielded no content" });
  }

  // Persist extracted text to Airtable
  await airtableUpdate(table, documentId, {
    Extracted_Text: extractedText,
    Processing_Status: "extracted",
    Processed_At: new Date().toISOString(),
  });

  console.log(
    `[Doc Parse] ✓ ${documentId} — ${fileType}, ${extractedText.length} chars`
  );

  return res.status(200).json({
    success: true,
    documentId,
    fileType,
    characterCount: extractedText.length,
    wordCount: extractedText.split(/\s+/).filter(Boolean).length,
  });
}

// ─── Stage 2: Analyze ─────────────────────────────────────────────────────

async function handleAnalyze(table: string, documentId: string, res: any) {
  await updateJobStatus(table, documentId, {
    status: "analyzing",
    startedAt: new Date().toISOString(),
  });

  // Fetch document record
  const docRecord = await airtableFetchRecord(table, documentId);
  if (!docRecord) {
    await failJob(table, documentId, "Document record not found");
    return res.status(404).json({ error: "Document not found" });
  }

  const docFields = docRecord.fields as Record<string, any>;
  const documentName = docFields["Document_Name"] || docFields["Name"] || "Document";
  const category = docFields["Category"] || "General";
  const extractedText: string = docFields["Extracted_Text"] || "";

  if (!extractedText || extractedText.trim().length < 10) {
    await failJob(
      table,
      documentId,
      "No extracted text found. Run parse stage first."
    );
    return res.status(422).json({ error: "No extracted text — run parse first" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await failJob(table, documentId, "ANTHROPIC_API_KEY is not configured");
    return res.status(500).json({ error: "AI service not configured" });
  }

  // Cap input to Claude at 12,000 chars to stay well within Hobby timeout
  const inputText = extractedText.substring(0, 12_000);

  const systemPrompt = `You are a senior investment associate at Aysan Capital Partners (ACP).
Analyse the document and extract critical transaction intelligence.

Document: ${documentName} | Category: ${category}

RULES:
- Base analysis ONLY on the provided text. Do NOT fabricate details.
- Keep responses concise to fit within token budget.

Respond ONLY with this exact JSON schema:
{
  "summary": "One paragraph executive summary",
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
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: "user", content: inputText }],
      }),
    });
  } catch (err: any) {
    // Timeout or network error — return 500 so QStash retries
    await failJob(table, documentId, `Claude call failed: ${err.message}`);
    return res.status(500).json({ error: `AI call failed: ${err.message}` });
  }

  if (!claudeResponse.ok) {
    const errText = await claudeResponse.text();
    await failJob(table, documentId, `Claude API ${claudeResponse.status}: ${errText}`);
    return res.status(500).json({ error: `AI API error: ${claudeResponse.status}` });
  }

  const claudePayload = await claudeResponse.json();
  const rawContent: string = claudePayload.content?.[0]?.text || "";

  let parsed: any = {};
  try {
    let clean = rawContent.trim();
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }
    parsed = JSON.parse(clean);
  } catch (err: any) {
    await failJob(table, documentId, `JSON parse error: ${err.message}`);
    return res.status(500).json({ error: "Failed to parse AI response" });
  }

  // Persist AI analysis to Airtable
  await airtableUpdate(table, documentId, {
    Summary: parsed.summary || "",
    Risks: Array.isArray(parsed.risks) ? "• " + parsed.risks.join("\n• ") : "",
    Covenants: Array.isArray(parsed.covenants)
      ? "• " + parsed.covenants.join("\n• ")
      : "",
    Processing_Status: "completed",
    Processed_At: new Date().toISOString(),
    Processing_Error: "",
  });

  console.log(`[Doc Analyze] ✓ ${documentId} — analysis complete`);

  return res.status(200).json({ success: true, documentId });
}
