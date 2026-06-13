import { airtableCreate, airtableFetch, airtableFetchRecord, airtableUpdate } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { cleanTranscript, truncateTranscript } from "../_services/transcripts.js";
import { analyzeTranscriptWithAI } from "../_services/ai.js";
import { authenticateAdmin } from "./lenders_auth_helper.js";
import { escapeFormulaString } from "../../src/lib/airtable/queries.js";
import { emitEvent, hasInngest } from "../_events/emit.js";

function parseBulletLines(text: string): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[-*•]\s*/, ""))
    .filter(Boolean);
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin
    await authenticateAdmin(req);

    // 2. Handle GET (fetch past analyses for a deal)
    if (req.method === "GET") {
      const dealId = req.query.dealId || "";
      if (!dealId) {
        return res.status(400).json({ error: "Deal ID query parameter is required." });
      }

      // Fetch the deal record to resolve its primary field Name
      let dealName = dealId;
      let dealRef = "";
      try {
        const dealRecord = await airtableFetchRecord(TABLES.PIPELINE || "Active_Pipeline", dealId);
        if (dealRecord && dealRecord.fields) {
          dealName = dealRecord.fields["Deal Name"] || dealRecord.fields["Deal_Name"] || dealRecord.fields["Name"] || dealName;
          const rawRef = dealRecord.fields["REF No."] || dealRecord.fields["Deal Ref"] || dealRecord.fields["REF. NO"] || "";
          dealRef = Array.isArray(rawRef) ? rawRef[0] : rawRef;
        }
      } catch (err) {
        console.warn(`[Transcript GET] Could not resolve dealName for ID ${dealId}:`, err);
      }

      // Query table 'Transcript_Analyses'
      // Construct a robust formula matching by Record ID, exact Deal Name, or REF No.
      const conditions = [
        `{Deal Name} = '${escapeFormulaString(dealId)}'`,
        `{Deal Name} = '${escapeFormulaString(dealName)}'`
      ];
      if (dealRef) {
        conditions.push(`{Deal Name} = '${escapeFormulaString(dealRef)}'`);
        conditions.push(`FIND('${escapeFormulaString(dealRef)}', {Deal Name})`);
      }
      const formula = `OR(${conditions.join(", ")})`;
      const response = await airtableFetch(TABLES.TRANSCRIPT_ANALYSES || "Transcript_Analyses", {
        filterByFormula: formula
      });

      const list = response.records.map((rec: any) => {
        const fields = rec.fields;
        const name = fields.Name || "";
        const dealIdFromField = Array.isArray(fields["Deal Name"]) ? fields["Deal Name"][0] : (fields["Deal Name"] || dealId);
        
        let summary = "";
        let discussionPoints: string[] = [];
        let actionItems: string[] = [];
        let risks: string[] = [];
        let opportunities: string[] = [];
        let sentiment = "Neutral";
        let dealScore = 50;
        let transcriptText = "";

        const rawTranscript = fields.Transcript || "";
        if (rawTranscript.trim().startsWith("{") && rawTranscript.trim().endsWith("}")) {
          try {
            const parsed = JSON.parse(rawTranscript);
            summary = parsed.summary || "";
            discussionPoints = Array.isArray(parsed.discussionPoints) ? parsed.discussionPoints : parseBulletLines(parsed.discussionPoints || "");
            actionItems = Array.isArray(parsed.actionItems) ? parsed.actionItems : parseBulletLines(parsed.actionItems || "");
            risks = Array.isArray(parsed.risks) ? parsed.risks : parseBulletLines(parsed.risks || "");
            opportunities = Array.isArray(parsed.opportunities) ? parsed.opportunities : parseBulletLines(parsed.opportunities || "");
            sentiment = parsed.sentiment || "Neutral";
            dealScore = typeof parsed.dealScore === "number" ? parsed.dealScore : 50;
            transcriptText = parsed.transcriptText || "";
          } catch (e) {
            // Fallback if JSON parsing fails
            transcriptText = rawTranscript;
            summary = "Error parsing saved analysis.";
          }
        } else {
          // Plain text fallback
          transcriptText = rawTranscript;
          summary = rawTranscript.substring(0, 200) + (rawTranscript.length > 200 ? "..." : "");
        }

        return {
          id: rec.id,
          name,
          dealId: dealIdFromField,
          summary,
          discussionPoints,
          actionItems,
          risks,
          opportunities,
          sentiment,
          dealScore,
          transcriptText,
          timestamp: rec.createdTime || new Date().toISOString()
        };
      });

      // Sort by created time descending
      list.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return res.status(200).json(list);
    }

    // 3. Handle POST (perform a new analysis)
    if (req.method === "POST") {
      const { dealId, text, fileName } = req.body || {};

      if (!dealId) {
        return res.status(400).json({ error: "Deal ID is required." });
      }
      if (!text || text.trim() === "") {
        return res.status(400).json({ error: "Transcript content is required." });
      }

      const table = TABLES.TRANSCRIPT_ANALYSES || "Transcript_Analyses";

      // Clean and truncate transcript text before storing
      const cleaned = cleanTranscript(text);
      const truncated = truncateTranscript(cleaned, 15000);

      // Create the Airtable record immediately with the raw transcript text.
      // The worker will read this text, run Claude, and update the record.
      const pendingPayload = JSON.stringify({
        transcriptText: truncated,
        status: "queued",
      });

      const recordName = `Analysis: ${fileName || "Pasted Text"} - ${new Date().toLocaleDateString()}`;
      const createdRecord = await airtableCreate(table, {
        Name: recordName,
        "Deal Name": [dealId],
        Transcript: pendingPayload,
        Processing_Status: "queued",
      });

      const recordId = createdRecord.id;

      // Emit Inngest event — if configured, return 202 immediately
      if (hasInngest()) {
        const emitRes = await emitEvent("transcript/submitted", { transcriptId: recordId, dealId });
        if (emitRes) {
          return res.status(202).json({
            status: "queued",
            id: recordId,
            name: recordName,
            dealId,
            message: "Transcript analysis queued via Inngest.",
            timestamp: createdRecord.createdTime || new Date().toISOString(),
          });
        }
        console.warn("[Transcript Analysis] Inngest was active but emitEvent failed. Falling back to synchronous processing.");
      }

      // ── Sync fallback (no QStash configured) ─────────────────────────────
      console.log("[Transcript Analysis] Running synchronously (no QStash)");

      await airtableUpdate(table, recordId, { Processing_Status: "processing" });

      const aiResponse = await analyzeTranscriptWithAI(truncated);

      const finalPayload = JSON.stringify({
        summary: aiResponse.summary,
        discussionPoints: aiResponse.discussionPoints,
        actionItems: aiResponse.actionItems,
        risks: aiResponse.risks,
        opportunities: aiResponse.opportunities,
        sentiment: aiResponse.sentiment,
        dealScore: aiResponse.dealScore,
        transcriptText: truncated,
      });

      await airtableUpdate(table, recordId, {
        Transcript: finalPayload,
        Processing_Status: "completed",
        Processed_At: new Date().toISOString(),
        Processing_Error: "",
      });

      return res.status(200).json({
        id: recordId,
        name: recordName,
        dealId,
        summary: aiResponse.summary,
        discussionPoints: aiResponse.discussionPoints,
        actionItems: aiResponse.actionItems,
        risks: aiResponse.risks,
        opportunities: aiResponse.opportunities,
        sentiment: aiResponse.sentiment,
        dealScore: aiResponse.dealScore,
        transcriptText: truncated,
        timestamp: createdRecord.createdTime || new Date().toISOString(),
        sync: true,
      });
    }

  } catch (err: any) {
    console.error("[Transcript Analysis Endpoint Error]:", err);
    return res.status(err.status || 500).json({
      error: err.message || "Failed to process transcript analysis",
      type: err.type || "INTERNAL_ERROR"
    });
  }
}
