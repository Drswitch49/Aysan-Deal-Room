/**
 * Job Worker: Transcript Analysis
 *
 * Called by QStash. Reads transcript text stored in an Airtable record,
 * calls Claude, and persists the full structured analysis back to Airtable.
 *
 * Vercel Hobby: 10s total. Claude capped at 8.5s via AbortSignal.timeout().
 */

import { airtableFetchRecord, airtableUpdate } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { verifyQStashRequest } from "../_utils/qstash.js";
import { updateJobStatus, failJob } from "../_utils/job-status.js";
import { analyzeTranscriptWithAI } from "../_services/ai.js";

const AI_TIMEOUT_MS = 8_500;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await verifyQStashRequest(req);
  } catch (err: any) {
    return res.status(err.status || 401).json({ error: err.message });
  }

  const { recordId } = req.body || {};
  if (!recordId) {
    return res.status(400).json({ error: "recordId is required" });
  }

  const table = TABLES.TRANSCRIPT_ANALYSES || "Transcript_Analyses";

  try {
    await updateJobStatus(table, recordId, {
      status: "processing",
      startedAt: new Date().toISOString(),
    });

    // Fetch the Airtable record to get transcript text
    const record = await airtableFetchRecord(table, recordId);
    if (!record) {
      await failJob(table, recordId, "Transcript record not found");
      return res.status(404).json({ error: "Record not found" });
    }

    const fields = record.fields as Record<string, any>;

    // The transcript is stored as a JSON payload in the Transcript field.
    // We wrote { transcriptText, status: "queued" } there before queuing.
    let transcriptText = "";
    const rawTranscript: string = fields["Transcript"] || "";
    if (rawTranscript.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(rawTranscript);
        transcriptText = parsed.transcriptText || parsed.transcript || "";
      } catch {
        transcriptText = rawTranscript;
      }
    } else {
      transcriptText = rawTranscript;
    }

    if (!transcriptText.trim()) {
      await failJob(table, recordId, "No transcript text found in record");
      return res.status(422).json({ error: "No transcript text" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await failJob(table, recordId, "ANTHROPIC_API_KEY not configured");
      return res.status(500).json({ error: "AI service not configured" });
    }

    // Run analysis — wrap with our own timeout since analyzeTranscriptWithAI
    // doesn't expose AbortSignal. We call Claude directly with the timeout.
    let aiResponse;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 1500,
          system: `You are a senior investment associate at a private equity firm.
Analyse the meeting transcript and identify key deal factors.

Respond ONLY with valid JSON matching this schema:
{
  "summary": "Executive summary paragraph",
  "discussionPoints": ["string"],
  "actionItems": ["string"],
  "risks": ["string"],
  "opportunities": ["string"],
  "sentiment": "Positive",
  "dealScore": 75
}`,
          messages: [
            {
              role: "user",
              content: `Transcript:\n\n${transcriptText.substring(0, 10_000)}`,
            },
          ],
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Claude API ${response.status}: ${await response.text()}`);
      }

      const payload = await response.json();
      let raw = payload.content?.[0]?.text || "";
      if (raw.startsWith("```")) {
        raw = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      }
      const parsed = JSON.parse(raw);
      aiResponse = {
        summary: parsed.summary || "",
        discussionPoints: Array.isArray(parsed.discussionPoints) ? parsed.discussionPoints : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
        risks: Array.isArray(parsed.risks) ? parsed.risks : [],
        opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities : [],
        sentiment: (["Positive", "Neutral", "Negative"].includes(parsed.sentiment)
          ? parsed.sentiment
          : "Neutral") as "Positive" | "Neutral" | "Negative",
        dealScore:
          typeof parsed.dealScore === "number"
            ? Math.min(100, Math.max(0, parsed.dealScore))
            : 50,
      };
    } catch (err: any) {
      await failJob(table, recordId, `AI analysis failed: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }

    // Build complete JSON payload (matches existing field format)
    const finalPayload = JSON.stringify({
      summary: aiResponse.summary,
      discussionPoints: aiResponse.discussionPoints,
      actionItems: aiResponse.actionItems,
      risks: aiResponse.risks,
      opportunities: aiResponse.opportunities,
      sentiment: aiResponse.sentiment,
      dealScore: aiResponse.dealScore,
      transcriptText,
    });

    await airtableUpdate(table, recordId, {
      Transcript: finalPayload,
      Processing_Status: "completed",
      Processed_At: new Date().toISOString(),
      Processing_Error: "",
    });

    console.log(`[Transcript Analysis] ✓ ${recordId} — score: ${aiResponse.dealScore}`);

    return res.status(200).json({
      success: true,
      recordId,
      sentiment: aiResponse.sentiment,
      dealScore: aiResponse.dealScore,
    });
  } catch (err: any) {
    await failJob(table, recordId, err);
    return res.status(500).json({ error: err.message || "Worker failed" });
  }
}
