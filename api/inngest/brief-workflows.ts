/**
 * Inngest Workflow: Brief Generation Pipelines
 *
 * Two functions:
 *  1. onPrecallBriefRequested  — fetch deal → Claude → persist → return
 *  2. onPostcallBriefRequested — fetch deal → Claude → score → persist → emit postcall_completed
 *
 * Emits brief/postcall_completed for downstream listeners (deal scoring, CRM sync, follow-ups).
 *
 * On Vercel Pro: Claude timeout 120s.
 */

import { inngest } from "../_utils/inngest.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { airtableFetchRecord, airtableUpdate } from "../_utils/airtable.js";
import { updateJobStatus, failJob } from "../_utils/job-status.js";
import { emitEvent } from "../_events/emit.js";
import {
  generatePrecallBriefWithAI,
  generatePostcallBriefAndScoreWithAI,
} from "../_services/ai.js";
import { calculateScore } from "../_services/scoring.js";

// ─── 1. Pre-call Brief ───────────────────────────────────────────────────────

const onPrecallBriefRequested = inngest.createFunction(
  {
    id: "brief-precall-generate",
    name: "Brief: Pre-call Intelligence Generation",
    retries: 3,
    triggers: [{ event: "brief/precall_requested" }],
  },
  async ({ event, step }) => {
    const { briefId, dealId } = event.data;
    const BRIEF_TABLE = TABLES.PRECALL_BRIEFS || "Precall_Briefs";

    // Step 1: Fetch deal snapshot + params from Airtable
    const jobPayload = await step.run("fetch-brief-payload", async () => {
      await updateJobStatus(BRIEF_TABLE, briefId, {
        status: "processing",
        startedAt: new Date().toISOString(),
      });

      const record = await airtableFetchRecord(BRIEF_TABLE, briefId);
      if (!record) {
        await failJob(BRIEF_TABLE, briefId, "Pre-call brief record not found");
        throw new Error("Brief record not found");
      }

      const fields = record.fields as Record<string, any>;
      let payload: any = {};
      try {
        payload = JSON.parse(fields["Brief Data"] || "{}");
      } catch {
        await failJob(BRIEF_TABLE, briefId, "Could not parse Brief Data");
        throw new Error("Invalid Brief Data");
      }

      if (!payload.dealData) {
        await failJob(BRIEF_TABLE, briefId, "No dealData in Brief Data");
        throw new Error("No deal data");
      }

      return payload;
    });

    // Step 2: Generate brief with Claude
    const briefContent = await step.run("generate-brief", async () => {
      if (!process.env.ANTHROPIC_API_KEY) {
        await failJob(BRIEF_TABLE, briefId, "ANTHROPIC_API_KEY not configured");
        throw new Error("AI service not configured");
      }

      const {
        dealData,
        selectedCallType,
        attendees,
        dataSources,
        pastedText,
      } = jobPayload;

      try {
        // Parse dataSources from {key: boolean} record to string[] of enabled sources
        const enabledSources = typeof dataSources === "object" && !Array.isArray(dataSources)
          ? Object.entries(dataSources as Record<string, boolean>)
              .filter(([, v]) => v)
              .map(([k]) => k)
          : Array.isArray(dataSources)
          ? dataSources
          : [];

        return await generatePrecallBriefWithAI(dealData, {
          selectedCallType: selectedCallType || "1st",
          attendees: attendees || ["Ayo (lead)", "Prince"],
          dataSources: enabledSources,
          pastedText,
        });
      } catch (err: any) {
        await failJob(BRIEF_TABLE, briefId, `Claude call failed: ${err.message}`);
        throw err;
      }
    });

    // Step 3: Persist brief to Airtable
    await step.run("persist-brief", async () => {
      const updatedPayload = {
        ...briefContent,
        dealData: jobPayload.dealData,
        attendees: jobPayload.attendees || ["Ayo (lead)", "Prince"],
        selectedCallType: jobPayload.selectedCallType || "1st",
        dataSources: jobPayload.dataSources || {},
        aiAnswers: jobPayload.aiAnswers || [],
      };

      await airtableUpdate(BRIEF_TABLE, briefId, {
        "Brief Data": JSON.stringify(updatedPayload),
        Processing_Status: "completed",
        Processed_At: new Date().toISOString(),
        Processing_Error: "",
      });

      console.log(`[Pre-call Brief] ✓ ${briefId} for deal ${dealId}`);
    });

    return {
      success: true,
      briefId,
      dealId,
      questionsCount: briefContent.questionsToAsk.length,
    };
  }
);

// ─── 2. Post-call Brief ──────────────────────────────────────────────────────

const onPostcallBriefRequested = inngest.createFunction(
  {
    id: "brief-postcall-generate",
    name: "Brief: Post-call Analysis + Scoring",
    retries: 3,
    triggers: [{ event: "brief/postcall_requested" }],
  },
  async ({ event, step }) => {
    const { briefId, dealId, schemaId, notes } = event.data;
    const BRIEF_TABLE = TABLES.POSTCALL_BRIEFS || "Postcall_Briefs";

    // Step 1: Fetch deal snapshot + params
    const jobPayload = await step.run("fetch-postcall-payload", async () => {
      await updateJobStatus(BRIEF_TABLE, briefId, {
        status: "processing",
        startedAt: new Date().toISOString(),
      });

      const record = await airtableFetchRecord(BRIEF_TABLE, briefId);
      if (!record) {
        await failJob(BRIEF_TABLE, briefId, "Post-call brief record not found");
        throw new Error("Brief record not found");
      }

      const fields = record.fields as Record<string, any>;
      let payload: any = {};
      try {
        payload = JSON.parse(fields["Brief Data"] || "{}");
      } catch {
        await failJob(BRIEF_TABLE, briefId, "Could not parse Brief Data");
        throw new Error("Invalid Brief Data");
      }

      if (!payload.dealData) {
        await failJob(BRIEF_TABLE, briefId, "No dealData in Brief Data");
        throw new Error("No deal data");
      }

      return payload;
    });

    // Step 2: Claude post-call analysis + scoring
    const aiResult: any = await step.run("generate-postcall", async () => {
      if (!process.env.ANTHROPIC_API_KEY) {
        await failJob(BRIEF_TABLE, briefId, "ANTHROPIC_API_KEY not configured");
        throw new Error("AI service not configured");
      }

      // Prefer notes from event payload, fallback to stored payload
      const callNotes = notes || jobPayload.notes || "";
      const scoreSchemaId = schemaId || jobPayload.schemaId || "ACP_DEAL_ROOM";

      try {
        return await generatePostcallBriefAndScoreWithAI(
          jobPayload.dealData,
          callNotes,
          scoreSchemaId
        );
      } catch (err: any) {
        await failJob(BRIEF_TABLE, briefId, `Claude call failed: ${err.message}`);
        throw err;
      }
    });

    // Step 3: Calculate weighted score
    const scoreResult: any = await step.run("calculate-score", async () => {
      const scoreSchemaId = schemaId || jobPayload.schemaId || "ACP_DEAL_ROOM";
      return calculateScore(scoreSchemaId, aiResult.scores);
    });

    // Step 4: Persist results to Airtable
    await step.run("persist-results", async () => {
      const updatedPayload = {
        ...aiResult,
        dealData: jobPayload.dealData,
        schemaId: schemaId || jobPayload.schemaId || "ACP_DEAL_ROOM",
        notes: notes || jobPayload.notes || "",
        scoreOutOf50: scoreResult.total,
        overrides: jobPayload.overrides || {},
      };

      await airtableUpdate(BRIEF_TABLE, briefId, {
        "Brief Data": JSON.stringify(updatedPayload),
        Processing_Status: "completed",
        Processed_At: new Date().toISOString(),
        Processing_Error: "",
      });

      console.log(
        `[Post-call Brief] ✓ ${briefId} — score: ${scoreResult.total}/50`
      );
    });

    // Step 5: Emit postcall_completed — enables downstream deal score + CRM workflows
    await step.run("emit-completed", async () => {
      await emitEvent("brief/postcall_completed", {
        briefId,
        dealId,
        scoreOutOf50: scoreResult.total,
        scores: aiResult.scores,
        summary: aiResult.summary,
        followUpEmail: aiResult.followUpEmail,
        schemaId: schemaId || jobPayload.schemaId || "ACP_DEAL_ROOM",
      });
    });

    return {
      success: true,
      briefId,
      dealId,
      scoreOutOf50: scoreResult.total,
      sentiment: "Analyzed",
    };
  }
);

// ─── 3. Postcall Completed → Propagate Score ─────────────────────────────────
// Lightweight downstream listener: update Latest_Deal_Score on Active_Pipeline.

const onPostcallCompleted = inngest.createFunction(
  {
    id: "postcall-score-propagation",
    name: "Postcall: Propagate Score to Pipeline",
    retries: 2,
    triggers: [{ event: "brief/postcall_completed" }],
  },
  async ({ event, step }) => {
    const { dealId, scoreOutOf50 } = event.data;
    if (!dealId) return { skipped: true };

    await step.run("update-pipeline-score", async () => {
      const pipelineTable = TABLES.PIPELINE || "Active_Pipeline";
      await airtableUpdate(pipelineTable, dealId, {
        Latest_Deal_Score: scoreOutOf50,
        Last_Scored_At: new Date().toISOString(),
      });
      console.log(`[Postcall Score] ✓ Deal ${dealId}: ${scoreOutOf50}/50`);
    });

    return { success: true, dealId, scoreOutOf50 };
  }
);

// ─── Export ──────────────────────────────────────────────────────────────────

export const briefWorkflows = [
  onPrecallBriefRequested,
  onPostcallBriefRequested,
  onPostcallCompleted,
];
