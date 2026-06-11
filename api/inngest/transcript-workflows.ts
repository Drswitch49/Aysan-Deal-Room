/**
 * Inngest Workflow: Transcript Analysis Pipeline
 *
 * Triggered by transcript/submitted events.
 * Reads transcript text from Airtable, calls Claude for structured analysis,
 * persists results, and emits transcript/analyzed for downstream listeners.
 *
 * On Vercel Pro: Claude timeout 120s.
 */

import { inngest } from "../_utils/inngest.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { airtableFetchRecord, airtableUpdate } from "../_utils/airtable.js";
import { updateJobStatus, failJob } from "../_utils/job-status.js";
import { emitEvent } from "../_events/emit.js";
import { analyzeTranscriptWithAI } from "../_services/ai.js";

const TABLE = TABLES.TRANSCRIPT_ANALYSES || "Transcript_Analyses";

// ─── Transcript Submitted → Claude Analysis ──────────────────────────────────

const onTranscriptSubmitted = inngest.createFunction(
  {
    id: "transcript-analyze",
    name: "Transcript: Submit → Claude Analysis",
    retries: 3,
    triggers: [{ event: "transcript/submitted" }],
  },
  async ({ event, step }) => {
    const { transcriptId, dealId } = event.data;

    // Step 1: Fetch transcript text from Airtable
    const transcriptText = await step.run("fetch-transcript", async () => {
      await updateJobStatus(TABLE, transcriptId, {
        status: "processing",
        startedAt: new Date().toISOString(),
      });

      const record = await airtableFetchRecord(TABLE, transcriptId);
      if (!record) {
        await failJob(TABLE, transcriptId, "Transcript record not found");
        throw new Error("Transcript record not found");
      }

      const fields = record.fields as Record<string, any>;

      // The transcript text may be stored as raw string or JSON payload
      let text = "";
      const rawTranscript: string = fields["Transcript"] || "";
      if (rawTranscript.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(rawTranscript);
          text = parsed.transcriptText || parsed.transcript || "";
        } catch {
          text = rawTranscript;
        }
      } else {
        text = rawTranscript;
      }

      if (!text.trim()) {
        await failJob(TABLE, transcriptId, "No transcript text found in record");
        throw new Error("No transcript text");
      }

      return text;
    });

    // Step 2: Claude AI analysis (120s timeout on Pro)
    const aiResponse = await step.run("analyze-transcript", async () => {
      if (!process.env.ANTHROPIC_API_KEY) {
        await failJob(TABLE, transcriptId, "ANTHROPIC_API_KEY not configured");
        throw new Error("AI service not configured");
      }

      try {
        // analyzeTranscriptWithAI sends full text to Claude
        // On Pro we can send up to 25k chars without timeout risk
        return await analyzeTranscriptWithAI(transcriptText.substring(0, 25_000));
      } catch (err: any) {
        await failJob(TABLE, transcriptId, `AI analysis failed: ${err.message}`);
        throw err;
      }
    });

    // Step 3: Persist results to Airtable
    await step.run("persist-results", async () => {
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

      await airtableUpdate(TABLE, transcriptId, {
        Transcript: finalPayload,
        Processing_Status: "completed",
        Processed_At: new Date().toISOString(),
        Processing_Error: "",
      });

      console.log(
        `[Transcript] ✓ ${transcriptId} — score: ${aiResponse.dealScore}, sentiment: ${aiResponse.sentiment}`
      );
    });

    // Step 4: Emit analyzed event for downstream deal scoring
    await step.run("emit-analyzed", async () => {
      await emitEvent("transcript/analyzed", {
        transcriptId,
        dealId,
        dealScore: aiResponse.dealScore,
      });
    });

    return {
      success: true,
      transcriptId,
      dealId,
      dealScore: aiResponse.dealScore,
      sentiment: aiResponse.sentiment,
      actionItemsCount: aiResponse.actionItems.length,
    };
  }
);

// ─── Transcript Analyzed → Update Deal Score ─────────────────────────────────
// Lightweight listener: when a transcript analysis completes, propagate the
// deal score to the Active_Pipeline record if it's higher than the current value.

const onTranscriptAnalyzed = inngest.createFunction(
  {
    id: "transcript-score-propagation",
    name: "Transcript: Propagate Deal Score to Pipeline",
    retries: 2,
    triggers: [{ event: "transcript/analyzed" }],
  },
  async ({ event, step }) => {
    const { dealId, dealScore } = event.data;
    if (!dealScore || !dealId) return { skipped: true };

    await step.run("update-deal-score", async () => {
      const pipelineTable = TABLES.PIPELINE || "Active_Pipeline";
      const dealRecord = await airtableFetchRecord(pipelineTable, dealId);

      if (!dealRecord) {
        console.warn(`[Score Propagation] Deal ${dealId} not found — skipping`);
        return;
      }

      const fields = dealRecord.fields as Record<string, any>;
      const currentScore = Number(fields["Latest_Deal_Score"] || 0);

      // Only update if the new score represents meaningful new intelligence
      if (dealScore > 0) {
        await airtableUpdate(pipelineTable, dealId, {
          Latest_Deal_Score: dealScore,
          Last_Scored_At: new Date().toISOString(),
        });
        console.log(
          `[Score Propagation] ✓ Deal ${dealId}: ${currentScore} → ${dealScore}`
        );
      }
    });

    return { success: true, dealId, dealScore };
  }
);

// ─── Export ──────────────────────────────────────────────────────────────────

export const transcriptWorkflows = [onTranscriptSubmitted, onTranscriptAnalyzed];
