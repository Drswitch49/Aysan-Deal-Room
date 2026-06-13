/**
 * Job Worker: Pre-call Brief Generation
 *
 * Called by QStash. Reads deal snapshot + params stored in the Airtable record,
 * calls Claude, and persists the generated brief back to Airtable.
 *
 * Vercel Hobby: 10s total. Claude capped at 8.5s via AbortSignal.
 */

import { airtableFetchRecord, airtableUpdate } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { verifyQStashRequest } from "../_utils/qstash.js";
import { updateJobStatus, failJob } from "../_utils/job-status.js";
import { generatePrecallBriefWithAI } from "../_services/ai.js";

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

  const table = TABLES.PRECALL_BRIEFS || "Precall_Briefs";

  try {
    await updateJobStatus(table, recordId, {
      status: "processing",
      startedAt: new Date().toISOString(),
    });

    // Fetch the record — it was created with deal snapshot + params in Brief Data
    const record = await airtableFetchRecord(table, recordId);
    if (!record) {
      await failJob(table, recordId, "Pre-call brief record not found");
      return res.status(404).json({ error: "Record not found" });
    }

    const fields = record.fields as Record<string, any>;
    let jobPayload: any = {};
    try {
      jobPayload = JSON.parse(fields["Brief Data"] || "{}");
    } catch {
      await failJob(table, recordId, "Could not parse Brief Data from record");
      return res.status(422).json({ error: "Invalid Brief Data in record" });
    }

    const { dealData, selectedCallType, attendees, dataSources, pastedText } = jobPayload;
    if (!dealData) {
      await failJob(table, recordId, "No dealData found in Brief Data");
      return res.status(422).json({ error: "No deal data in record" });
    }

    const enabledSources = typeof dataSources === "object" && !Array.isArray(dataSources)
      ? Object.entries(dataSources as Record<string, boolean>)
          .filter(([, v]) => v)
          .map(([k]) => k)
      : Array.isArray(dataSources)
      ? dataSources
      : [];

    let briefContent: any;
    try {
      briefContent = await generatePrecallBriefWithAI(dealData, {
        selectedCallType: selectedCallType || "1st",
        attendees: attendees || ["Ayo (lead)", "Prince"],
        dataSources: enabledSources,
        pastedText,
      });
    } catch (err: any) {
      await failJob(table, recordId, `Claude call failed: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }

    // Update record with generated brief + completed status
    const updatedPayload = {
      ...briefContent,
      dealData,
      attendees: attendees || ["Ayo (lead)", "Prince"],
      selectedCallType: selectedCallType || "1st",
      dataSources: dataSources || {},
      aiAnswers: jobPayload.aiAnswers || [],
    };

    await airtableUpdate(table, recordId, {
      "Brief Data": JSON.stringify(updatedPayload),
      Processing_Status: "completed",
      Processed_At: new Date().toISOString(),
      Processing_Error: "",
    });

    console.log(`[Pre-call Brief] ✓ ${recordId}`);

    return res.status(200).json({ success: true, recordId, ...briefContent });
  } catch (err: any) {
    await failJob(table, recordId, err);
    return res.status(500).json({ error: err.message || "Worker failed" });
  }
}
