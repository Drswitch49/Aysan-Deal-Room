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

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await failJob(table, recordId, "ANTHROPIC_API_KEY not configured");
      return res.status(500).json({ error: "AI service not configured" });
    }

    const callTypeLabel =
      selectedCallType === "1st"
        ? "1st Seller Call"
        : selectedCallType === "2nd"
        ? "2nd Follow-up Call"
        : "Negotiation";

    const systemPrompt = `You are a senior investment associate at Aysan Capital Partners.
Prepare a Pre-call Intelligence Brief for the deal team.

Respond ONLY with valid JSON:
{
  "businessProfile": "Concise paragraph on company, sector, financials, transition risks",
  "openingAngle": "Actionable advice on how to open and position the call",
  "questionsToAsk": ["Strategic question 1", "Strategic question 2", "Strategic question 3"]
}`;

    const userContent = `Company: ${dealData.companyName || dealData.dealRef}
Sector: ${dealData.sector} | Location: ${dealData.location}
EV: ${dealData.evAsk ? `£${dealData.evAsk}` : "TBC"}
Revenue: ${dealData.revenue ? `£${dealData.revenue}` : "TBC"}
EBITDA: ${dealData.ebitda ? `£${dealData.ebitda}` : "TBC"}
EV Multiple: ${dealData.multiplier || "TBC"}
Call Type: ${callTypeLabel}
Attendees: ${(attendees || ["Ayo (lead)", "Prince"]).join(", ")}
Sources: ${(dataSources || []).join(", ")}
${pastedText ? `\nIM Text:\n${pastedText.substring(0, 3_000)}` : ""}`;

    let briefContent: any;
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

      const claudePayload = await response.json();
      let raw = claudePayload.content?.[0]?.text || "";
      if (raw.startsWith("```")) {
        raw = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      }
      const parsed = JSON.parse(raw);
      briefContent = {
        businessProfile: parsed.businessProfile || "",
        openingAngle: parsed.openingAngle || "",
        questionsToAsk: Array.isArray(parsed.questionsToAsk) ? parsed.questionsToAsk : [],
      };
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
