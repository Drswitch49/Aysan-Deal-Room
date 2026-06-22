/**
 * Document Analyze — Trigger Endpoint
 *
 * POST /api/documents/analyze
 *
 * Queues a document-analysis job (stage="analyze") and returns 202 immediately.
 * Requires document to already have Extracted_Text (run parse first).
 * Falls back to synchronous processing when QStash is not configured.
 *
 * Job worker: /api/jobs/document-analysis (stage=analyze)
 */

import { airtableFetchRecord, airtableUpdate } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { authenticateAdmin } from "../admin/lenders.js";
import { emitEvent, hasInngest } from "../_events/emit.js";
import { updateJobStatus } from "../_utils/job-status.js";

// ─── Inline Sync Fallback ─────────────────────────────────────────────────

async function runInlineAnalyze(
  table: string,
  documentId: string,
  docFields: Record<string, any>,
  pipelineTable: string
): Promise<any> {
  const documentName: string =
    docFields["Document_Name"] || docFields["Name"] || "Document";
  const category: string = docFields["Category"] || "General";

  // Require real extracted text — no hallucination
  let fileTextContent: string = docFields["Extracted_Text"] || "";

  if (!fileTextContent) {
    // Lightweight plain-text fallback only
    const rawLink = docFields["Drive_Link"];
    let fileUrl = "";
    if (Array.isArray(rawLink) && rawLink.length > 0) {
      fileUrl = rawLink[0]?.url || String(rawLink[0]) || "";
    } else if (typeof rawLink === "string") {
      fileUrl = rawLink;
    }

    if (fileUrl) {
      const lowerName = (documentName || "").toLowerCase();
      const isPlainText = [".txt", ".csv", ".json", ".md"].some((e) => lowerName.endsWith(e));
      if (isPlainText) {
        const r = await fetch(fileUrl, { signal: AbortSignal.timeout(10_000) });
        if (r.ok) fileTextContent = (await r.text()).substring(0, 10_000);
      }
    }
  }

  if (!fileTextContent) {
    throw Object.assign(
      new Error(
        "No extracted text found. Run /api/documents/parse first to extract text from binary files."
      ),
      { status: 422 }
    );
  }

  // Resolve deal context
  let dealData: Record<string, string> = {};
  const dealRefs = docFields["Deal_Ref"] || docFields["Deal Reference"] || [];
  const dealId = Array.isArray(dealRefs) ? dealRefs[0] : dealRefs;
  if (dealId) {
    try {
      const dealRecord = await airtableFetchRecord(pipelineTable, dealId);
      if (dealRecord?.fields) {
        const f = dealRecord.fields as Record<string, any>;
        dealData = {
          companyName: f["Company_Name"] || f["Company Name"] || "",
          sector: f["Sector"] || "General",
          location: f["Location"] || "UK",
          ebitda: String(f["EBITDA_GBP"] || f["EBITDA"] || ""),
          revenue: String(f["Turnover"] || ""),
          multiplier: String(f["EV Multiple"] || ""),
        };
      }
    } catch { }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const companyContext = dealData.companyName
    ? `\nContext:\n- Company: ${dealData.companyName}\n- Sector: ${dealData.sector}\n- Location: ${dealData.location}`
    : "";

  const systemPrompt = `You are a senior investment associate at Aysan Capital Partners.
Analyse the provided document text and extract critical transaction intelligence.
Document: ${documentName} (${category})${companyContext}

IMPORTANT: Base analysis ONLY on the provided text. Do NOT fabricate details.

Respond ONLY with valid JSON:
{
  "summary": "Executive summary",
  "keyClauses": [{ "term": "string", "details": "string" }],
  "risks": ["string"],
  "covenants": ["string"]
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(8_500),
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: "user", content: fileTextContent.substring(0, 12_000) }],
    }),
  });

  if (!response.ok) throw new Error(`Claude API ${response.status}: ${await response.text()}`);

  const payload = await response.json();
  let raw = payload.content?.[0]?.text || "";
  if (raw.startsWith("```")) raw = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();

  const parsed = JSON.parse(raw);

  await airtableUpdate(table, documentId, {
    Summary: parsed.summary || "",
    Risks: Array.isArray(parsed.risks) ? "• " + parsed.risks.join("\n• ") : "",
    Covenants: Array.isArray(parsed.covenants) ? "• " + parsed.covenants.join("\n• ") : "",
    Processing_Status: "completed",
    Processed_At: new Date().toISOString(),
    Processing_Error: "",
  });

  return parsed;
}

// ─── Main Handler ──────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await authenticateAdmin(req);
    const roleLower = (req.user?.role || "").toLowerCase();
    if (roleLower === "stakeholder" || roleLower === "read only") {
      return res.status(403).json({ error: "Access denied: External stakeholders cannot trigger document intelligence operations." });
    }

    const { documentId } = req.body || {};
    if (!documentId) {
      return res.status(400).json({ error: "Document ID is required" });
    }

    const table = TABLES.DOCUMENTS || "Documents";
    const pipelineTable = TABLES.PIPELINE || "Active_Pipeline";

    const docRecord = await airtableFetchRecord(table, documentId);
    if (!docRecord) {
      return res.status(404).json({ error: "Document not found" });
    }

    const docFields = docRecord.fields as Record<string, any>;

    // Guard: must have extracted text before analysis
    const hasExtractedText = !!(docFields["Extracted_Text"] || "").trim();

    // For QStash path — allow queuing even without text (worker will fail gracefully)
    // For sync fallback — validate immediately

    // Mark as queued
    await updateJobStatus(table, documentId, { status: "queued" });

    // Emit Inngest event — if configured, return 202 immediately
    if (hasInngest()) {
      const emitRes = await emitEvent("document/analyze_requested", { documentId });
      if (emitRes) {
        return res.status(202).json({
          status: "queued",
          documentId,
          message: "Document analysis queued via Inngest. Poll /api/jobs/status for progress.",
        });
      }
      console.warn("[Document Analyze] Inngest was active but emitEvent failed. Falling back to synchronous processing.");
    }

    // ── Sync fallback ──────────────────────────────────────────────────────
    console.log("[Document Analyze] Running synchronously (no QStash)");
    await updateJobStatus(table, documentId, {
      status: "analyzing",
      startedAt: new Date().toISOString(),
    });

    const result = await runInlineAnalyze(table, documentId, docFields, pipelineTable);

    return res.status(200).json({ status: "completed", documentId, ...result, sync: true });
  } catch (err: any) {
    console.error("[Document Analyze Trigger Error]:", err);

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
      error: err.message || "Failed to queue analysis job",
    });
  }
}
