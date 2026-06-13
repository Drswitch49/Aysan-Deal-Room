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
import { generatePostcallBriefAndScoreWithAI } from "../_services/ai.js";
import { calculateScore } from "../_services/scoring.js";

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

    let aiResult: any;
    try {
      aiResult = await generatePostcallBriefAndScoreWithAI(dealData, notes, schemaId);
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
      strategicAlignment: aiResult.strategicAlignment || "",
      financialReality: aiResult.financialReality || "",
      redFlags: aiResult.redFlags || "",
      dealStructure: aiResult.dealStructure || "",
      nextSteps: aiResult.nextSteps || "",
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
