/**
 * Job Worker: Post-call Brief Generation + Scoring
 *
 * Called by QStash. Reads deal snapshot + notes stored in the Airtable record,
 * calls Claude for summary/scoring, runs scorecard calculation, and persists results.
 *
 * Vercel Hobby: 10s total. Claude capped at 8.5s via AbortSignal.
 */

import { airtableFetchRecord, airtableUpdate } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { verifyQStashRequest } from "../_utils/qstash.js";
import { updateJobStatus, failJob } from "../_utils/job-status.js";
import { calculateScore, SCORING_SCHEMAS, getPromptInstructions } from "../_services/scoring.js";

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

  const table = TABLES.POSTCALL_BRIEFS || "Postcall_Briefs";

  try {
    await updateJobStatus(table, recordId, {
      status: "processing",
      startedAt: new Date().toISOString(),
    });

    // Fetch the pre-created record which contains deal snapshot + notes
    const record = await airtableFetchRecord(table, recordId);
    if (!record) {
      await failJob(table, recordId, "Post-call brief record not found");
      return res.status(404).json({ error: "Record not found" });
    }

    const fields = record.fields as Record<string, any>;
    let jobPayload: any = {};
    try {
      jobPayload = JSON.parse(fields["Brief Data"] || "{}");
    } catch {
      await failJob(table, recordId, "Could not parse Brief Data");
      return res.status(422).json({ error: "Invalid Brief Data in record" });
    }

    const { dealData, notes, schemaId = "ACP_DEAL_ROOM" } = jobPayload;
    if (!dealData || !notes) {
      await failJob(table, recordId, "Missing dealData or notes in Brief Data");
      return res.status(422).json({ error: "Missing deal data or notes" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await failJob(table, recordId, "ANTHROPIC_API_KEY not configured");
      return res.status(500).json({ error: "AI service not configured" });
    }

    const schema = SCORING_SCHEMAS[schemaId] || SCORING_SCHEMAS.ACP_DEAL_ROOM;
    const scoringInstructions = getPromptInstructions(schemaId);

    const systemPrompt = `You are a senior investment director at Aysan Capital Partners (ACP).
Analyse the post-call notes and provide:
1. A concise executive summary (under 4 sentences)
2. Opportunity scores for each metric
3. A professional follow-up email draft

${scoringInstructions}

Respond ONLY with valid JSON:
{
  "summary": "...",
  "scores": {
    ${schema.metrics.map((m) => `"${m.id}": { "score": 7, "explanation": "..." }`).join(",\n    ")}
  },
  "followUpEmail": "Subject: ...\\n\\nDear [Name],..."
}`;

    const userContent = `Company: ${dealData.companyName || dealData.dealRef}
Sector: ${dealData.sector} | Location: ${dealData.location}
EV: ${dealData.evAsk ? `£${dealData.evAsk}` : "TBC"}
Revenue: ${dealData.revenue ? `£${dealData.revenue}` : "TBC"}
EBITDA: ${dealData.ebitda ? `£${dealData.ebitda}` : "TBC"}
EV Multiple: ${dealData.multiplier || "TBC"}

Notes:\n${notes.substring(0, 5_000)}`;

    let aiResult: any;
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
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }],
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

      // Validate and clamp scores
      const validatedScores: Record<string, { score: number; explanation: string }> = {};
      for (const m of schema.metrics) {
        const s = parsed.scores?.[m.id] || { score: 5, explanation: "No AI assessment." };
        validatedScores[m.id] = {
          score: Math.min(10, Math.max(1, Math.round(Number(s.score) || 5))),
          explanation: s.explanation || "No AI assessment.",
        };
      }

      aiResult = {
        summary: parsed.summary || "",
        scores: validatedScores,
        followUpEmail: parsed.followUpEmail || "",
      };
    } catch (err: any) {
      await failJob(table, recordId, `Claude call failed: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }

    // Run scorecard calculation
    const calculated = calculateScore(schemaId, aiResult.scores, {});

    const updatedPayload = {
      schemaId,
      dealData,
      notes,
      summary: aiResult.summary,
      aiScores: aiResult.scores,
      overrides: {},
      calculated,
      followUpEmail: aiResult.followUpEmail,
    };

    await airtableUpdate(table, recordId, {
      "Brief Data": JSON.stringify(updatedPayload),
      Processing_Status: "completed",
      Processed_At: new Date().toISOString(),
      Processing_Error: "",
    });

    console.log(
      `[Post-call Brief] ✓ ${recordId} — score: ${calculated.percentage}%`
    );

    return res.status(200).json({
      success: true,
      recordId,
      summary: aiResult.summary,
      calculated,
    });
  } catch (err: any) {
    await failJob(table, recordId, err);
    return res.status(500).json({ error: err.message || "Worker failed" });
  }
}
