import { airtableCreate, airtableFetch, airtableFetchRecord, airtableUpdate } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { generatePrecallBriefWithAI, answerPrecallQuestionWithAI } from "../_services/ai.js";
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

    const precallTable = TABLES.PRECALL_BRIEFS || "Precall_Briefs";
    const pipelineTable = TABLES.PIPELINE || "Active_Pipeline";

    // 2. Handle GET (fetch past briefs for a deal)
    if (req.method === "GET") {
      const dealId = req.query.dealId || "";
      if (!dealId) {
        return res.status(400).json({ error: "Deal ID query parameter is required." });
      }

      // Fetch the deal record to resolve its primary field Name/Ref
      let dealName = dealId;
      try {
        const dealRecord = await airtableFetchRecord(pipelineTable, dealId);
        if (dealRecord && dealRecord.fields) {
          dealName = dealRecord.fields["REF No."] || dealRecord.fields["Deal Ref"] || dealRecord.fields["Deal Name"] || dealName;
        }
      } catch (err) {
        console.warn(`[Pre-call GET] Could not resolve dealName for ID ${dealId}:`, err);
      }

      // Query table 'Precall_Briefs'
      const formula = `OR({Active_Pipeline} = '${escapeFormulaString(dealId)}', {Deal Name (from Active_Pipeline)} = '${escapeFormulaString(dealName)}')`;
      const response = await airtableFetch(precallTable, {
        filterByFormula: formula
      });

      const list = response.records.map((rec: any) => {
        const fields = rec.fields;
        const name = fields.Name || "";
        const dealIdFromField = Array.isArray(fields["Active_Pipeline"]) ? fields["Active_Pipeline"][0] : dealId;
        
        let businessProfile = "";
        let openingAngle = "";
        let questionsToAsk: string[] = [];
        let attendees: string[] = ["Ayo (lead)", "Prince"];
        let selectedCallType = "1st";
        let dataSources = { companiesHouse: true, linkedIn: true, notionSops: true, airtable: true };
        let aiAnswers: Array<{ q: string; a: string }> = [];

        const rawBriefData = fields["Brief Data"] || "";
        if (rawBriefData.trim().startsWith("{") && rawBriefData.trim().endsWith("}")) {
          try {
            const parsed = JSON.parse(rawBriefData);
            businessProfile = parsed.businessProfile || "";
            openingAngle = parsed.openingAngle || "";
            questionsToAsk = Array.isArray(parsed.questionsToAsk) ? parsed.questionsToAsk : [];
            attendees = Array.isArray(parsed.attendees) ? parsed.attendees : attendees;
            selectedCallType = parsed.selectedCallType || selectedCallType;
            dataSources = parsed.dataSources || dataSources;
            aiAnswers = Array.isArray(parsed.aiAnswers) ? parsed.aiAnswers : [];
          } catch (e) {
            businessProfile = "Error parsing brief data.";
          }
        } else {
          // Plain text fallback
          businessProfile = rawBriefData;
        }

        return {
          id: rec.id,
          name,
          dealId: dealIdFromField,
          businessProfile,
          openingAngle,
          questionsToAsk,
          attendees,
          selectedCallType,
          dataSources,
          aiAnswers,
          timestamp: rec.createdTime || new Date().toISOString()
        };
      });

      // Sort by created time descending
      list.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return res.status(200).json(list);
    }

    // 3. Handle POST
    if (req.method === "POST") {
      const { action, dealId } = req.body || {};

      if (!dealId) {
        return res.status(400).json({ error: "Deal ID is required." });
      }

      // Fetch the deal details
      const dealRecord = await airtableFetchRecord(pipelineTable, dealId);
      if (!dealRecord) {
        return res.status(404).json({ error: "Deal record not found." });
      }

      const dealFields = dealRecord.fields;
      const dealData = {
        id: dealRecord.id,
        dealRef: dealFields["REF No."] || dealFields["Deal Ref"] || dealFields["REF. NO"] || "",
        companyName: dealFields["Company_Name"] || dealFields["Company Name"] || "",
        sector: dealFields["Sector"] || "General",
        location: dealFields["Location"] || "UK",
        evAsk: dealFields["Asking_Price_GBP"] || dealFields["EV"] || "",
        revenue: dealFields["Turnover"] || "",
        ebitda: dealFields["EBITDA_GBP"] || "",
        multiplier: dealFields["EV Multiple"] || ""
      };

      // action: "ask-question"
      if (action === "ask-question") {
        const { briefId, question, history } = req.body || {};
        if (!briefId) {
          return res.status(400).json({ error: "Brief ID is required for interactive Q&A." });
        }
        if (!question || !question.trim()) {
          return res.status(400).json({ error: "Question content is required." });
        }

        // Fetch existing brief
        const briefRecord = await airtableFetchRecord(precallTable, briefId);
        if (!briefRecord) {
          return res.status(404).json({ error: "Brief record not found." });
        }

        const briefFields = briefRecord.fields;
        let briefPayload: any = {};
        try {
          briefPayload = JSON.parse(briefFields["Brief Data"] || "{}");
        } catch (e) {
          briefPayload = { businessProfile: briefFields["Brief Data"] || "" };
        }

        // Call Claude Q&A service
        const aiAnswer = await answerPrecallQuestionWithAI(dealData, briefPayload, question, history || []);

        // Append to history
        const currentAnswers = Array.isArray(briefPayload.aiAnswers) ? briefPayload.aiAnswers : [];
        const updatedAnswers = [...currentAnswers, { q: question, a: aiAnswer }];
        briefPayload.aiAnswers = updatedAnswers;

        // Update in Airtable
        await airtableUpdate(precallTable, briefId, {
          "Brief Data": JSON.stringify(briefPayload)
        });

        return res.status(200).json({ q: question, a: aiAnswer, aiAnswers: updatedAnswers });
      }

      // action: "generate" — queue async job
      const { attendees, selectedCallType, dataSources, pastedText } = req.body || {};

      const dateStr = new Date().toLocaleDateString("en-GB");
      const callTypeLabel =
        selectedCallType === "1st" ? "1st Call" : selectedCallType === "2nd" ? "2nd Call" : "Negotiation";
      const briefName = `Pre-call Brief: ${dealData.companyName || dealData.dealRef} (${callTypeLabel}) - ${dateStr}`;

      // Store deal snapshot + job params in Brief Data so the worker can read them
      const jobPayload = {
        dealData,
        selectedCallType: selectedCallType || "1st",
        attendees: attendees || ["Ayo (lead)", "Prince"],
        dataSources: Object.keys(dataSources || {}).filter((k) => dataSources[k]),
        pastedText: pastedText || "",
        aiAnswers: [],
      };

      const createdRecord = await airtableCreate(precallTable, {
        Name: briefName,
        Active_Pipeline: [dealId],
        "Brief Data": JSON.stringify(jobPayload),
        Website: dealFields["Website"] || "",
        Processing_Status: "queued",
      });

      const recordId = createdRecord.id;

      // Emit Inngest event — if configured, return 202 immediately
      if (hasInngest()) {
        await emitEvent("brief/precall_requested", {
          briefId: recordId,
          dealId,
          callType: selectedCallType || "1st",
          attendees: attendees || ["Ayo (lead)", "Prince"],
          dataSources: dataSources || {},
          pastedText: pastedText || "",
        });
        return res.status(202).json({
          status: "queued",
          id: recordId,
          name: briefName,
          dealId,
          message: "Pre-call brief generation queued via Inngest.",
          timestamp: createdRecord.createdTime || new Date().toISOString(),
        });
      }

      // ── Sync fallback ─────────────────────────────────────────────
      console.log("[Precall Brief] Running synchronously (no QStash)");
      await airtableUpdate(precallTable, recordId, { Processing_Status: "processing" });

      const briefContent = await generatePrecallBriefWithAI(dealData, {
        selectedCallType: selectedCallType || "1st",
        attendees: attendees || ["Ayo (lead)", "Prince"],
        dataSources: Object.keys(dataSources || {}).filter((k) => dataSources[k]),
        pastedText,
      });

      const finalPayload = {
        ...briefContent,
        dealData,
        attendees: attendees || ["Ayo (lead)", "Prince"],
        selectedCallType: selectedCallType || "1st",
        dataSources: dataSources || {},
        aiAnswers: [],
      };

      await airtableUpdate(precallTable, recordId, {
        "Brief Data": JSON.stringify(finalPayload),
        Processing_Status: "completed",
        Processed_At: new Date().toISOString(),
        Processing_Error: "",
      });

      return res.status(200).json({
        id: recordId,
        name: briefName,
        dealId,
        ...briefContent,
        attendees: finalPayload.attendees,
        selectedCallType: finalPayload.selectedCallType,
        dataSources: finalPayload.dataSources,
        aiAnswers: [],
        timestamp: createdRecord.createdTime || new Date().toISOString(),
        sync: true,
      });
    }
  } catch (err: any) {
    console.error("[Pre-call Brief Endpoint Error]:", err);
    return res.status(err.status || 500).json({
      error: err.message || "Failed to process pre-call brief request",
      type: err.type || "INTERNAL_ERROR"
    });
  }
}
