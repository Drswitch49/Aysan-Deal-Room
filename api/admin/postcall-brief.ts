import { airtableCreate, airtableFetch, airtableFetchRecord, airtableUpdate } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { generatePostcallBriefAndScoreWithAI } from "../_services/ai.js";
import { calculateScore } from "../_services/scoring.js";
import { authenticateAdmin } from "./lenders_auth_helper.js";
import { escapeFormulaString } from "../../src/lib/airtable/queries.js";
import { emitEvent, hasInngest } from "../_events/emit.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin
    await authenticateAdmin(req);

    const postcallTable = TABLES.POSTCALL_BRIEFS || "Postcall_Briefs";
    const pipelineTable = TABLES.PIPELINE || "Active_Pipeline";

    // 2. Handle GET (fetch past briefs and scores for a deal)
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
        console.warn(`[Post-call GET] Could not resolve dealName for ID ${dealId}:`, err);
      }

      // Query table 'Postcall_Briefs'
      const formula = `OR({Active_Pipeline} = '${escapeFormulaString(dealId)}', {Active_Pipeline} = '${escapeFormulaString(dealName)}')`;
      const response = await airtableFetch(postcallTable, {
        filterByFormula: formula
      });

      const list = response.records.map((rec: any) => {
        const fields = rec.fields;
        const name = fields.Name || "";
        const dealIdFromField = Array.isArray(fields["Active_Pipeline"]) ? fields["Active_Pipeline"][0] : dealId;
        
        let schemaId = "ACP_DEAL_ROOM";
        let summary = "";
        let aiScores: Record<string, { score: number; explanation: string }> = {};
        let overrides: Record<string, number> = {};
        let calculated = null;
        let followUpEmail = "";

        const rawBriefData = fields["Brief Data"] || "";
        if (rawBriefData.trim().startsWith("{") && rawBriefData.trim().endsWith("}")) {
          try {
            const parsed = JSON.parse(rawBriefData);
            schemaId = parsed.schemaId || "ACP_DEAL_ROOM";
            summary = parsed.summary || "";
            aiScores = parsed.aiScores || {};
            overrides = parsed.overrides || {};
            calculated = parsed.calculated || null;
            followUpEmail = parsed.followUpEmail || "";
          } catch (e) {
            summary = "Error parsing brief data.";
          }
        } else {
          // Plain text fallback
          summary = rawBriefData;
        }

        // If calculated is missing, run it on the fly
        if (!calculated && Object.keys(aiScores).length > 0) {
          calculated = calculateScore(schemaId, aiScores, overrides);
        }

        return {
          id: rec.id,
          name,
          dealId: dealIdFromField,
          schemaId,
          summary,
          aiScores,
          overrides,
          calculated,
          followUpEmail,
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

      // action: "override"
      if (action === "override") {
        const { briefId, overrides } = req.body || {};
        if (!briefId) {
          return res.status(400).json({ error: "Brief ID is required for overrides." });
        }
        if (!overrides) {
          return res.status(400).json({ error: "Overrides object is required." });
        }

        // Fetch existing brief
        const briefRecord = await airtableFetchRecord(postcallTable, briefId);
        if (!briefRecord) {
          return res.status(404).json({ error: "Brief record not found." });
        }

        const briefFields = briefRecord.fields;
        let briefPayload: any = {};
        try {
          briefPayload = JSON.parse(briefFields["Brief Data"] || "{}");
        } catch (e) {
          return res.status(400).json({ error: "Invalid brief data JSON in database." });
        }

        // Merge overrides
        const existingOverrides = briefPayload.overrides || {};
        const mergedOverrides = { ...existingOverrides };
        
        // Apply new overrides and convert string values to numbers
        Object.keys(overrides).forEach(key => {
          mergedOverrides[key] = Number(overrides[key]);
        });

        // Recalculate
        const calculated = calculateScore(briefPayload.schemaId, briefPayload.aiScores, mergedOverrides);

        // Update brief payload
        briefPayload.overrides = mergedOverrides;
        briefPayload.calculated = calculated;

        // Update in Airtable
        await airtableUpdate(postcallTable, briefId, {
          "Brief Data": JSON.stringify(briefPayload)
        });

        return res.status(200).json({
          id: briefId,
          name: briefRecord.fields.Name,
          dealId,
          schemaId: briefPayload.schemaId,
          summary: briefPayload.summary,
          aiScores: briefPayload.aiScores,
          overrides: mergedOverrides,
          calculated,
          followUpEmail: briefPayload.followUpEmail,
          timestamp: briefRecord.createdTime || new Date().toISOString()
        });
      }

      // action: "generate" — queue async job
      if (action === "generate") {
        const { notes, schemaId } = req.body || {};
        if (!notes || !notes.trim()) {
          return res.status(400).json({ error: "Notes/transcript content is required." });
        }

        const activeSchemaId = schemaId || "ACP_DEAL_ROOM";

        const dateStr = new Date().toLocaleDateString("en-GB");
        const schemaLabel = activeSchemaId === "ACP_DEAL_ROOM" ? "ACP Default" : "Modular";
        const briefName = `Post-call Brief: ${dealData.companyName || dealData.dealRef} (${schemaLabel}) - ${dateStr}`;

        // Store deal + notes snapshot so the worker can run Claude independently
        const jobPayload = {
          dealData,
          notes,
          schemaId: activeSchemaId,
        };

        const createdRecord = await airtableCreate(postcallTable, {
          Name: briefName,
          Active_Pipeline: [dealId],
          "Brief Data": JSON.stringify(jobPayload),
          Website: dealFields["Website"] || "",
          Processing_Status: "queued",
        });

        const recordId = createdRecord.id;

        // Emit Inngest event — if configured, return 202 immediately
        if (hasInngest()) {
          await emitEvent("brief/postcall_requested", {
            briefId: recordId,
            dealId,
            schemaId: activeSchemaId,
            notes: notes || "",
          });
          return res.status(202).json({
            status: "queued",
            id: recordId,
            name: briefName,
            dealId,
            schemaId: activeSchemaId,
            message: "Post-call brief generation queued via Inngest.",
            timestamp: createdRecord.createdTime || new Date().toISOString(),
          });
        }

        // ── Sync fallback ─────────────────────────────────────────────
        console.log("[Postcall Brief] Running synchronously (no QStash)");
        await airtableUpdate(postcallTable, recordId, { Processing_Status: "processing" });

        const aiResult = await generatePostcallBriefAndScoreWithAI(dealData, notes, activeSchemaId);
        const calculated = calculateScore(activeSchemaId, aiResult.scores, {});

        const finalBriefPayload = {
          schemaId: activeSchemaId,
          dealData,
          notes,
          summary: aiResult.summary,
          aiScores: aiResult.scores,
          overrides: {},
          calculated,
          followUpEmail: aiResult.followUpEmail,
        };

        await airtableUpdate(postcallTable, recordId, {
          "Brief Data": JSON.stringify(finalBriefPayload),
          Processing_Status: "completed",
          Processed_At: new Date().toISOString(),
          Processing_Error: "",
        });

        return res.status(200).json({
          id: recordId,
          name: briefName,
          dealId,
          schemaId: activeSchemaId,
          summary: aiResult.summary,
          aiScores: aiResult.scores,
          overrides: {},
          calculated,
          followUpEmail: aiResult.followUpEmail,
          timestamp: createdRecord.createdTime || new Date().toISOString(),
          sync: true,
        });
      }

      return res.status(400).json({ error: "Unsupported action." });
    }
  } catch (err: any) {
    console.error("[Post-call Brief Endpoint Error]:", err);
    return res.status(err.status || 500).json({
      error: err.message || "Failed to process post-call brief request",
      type: err.type || "INTERNAL_ERROR"
    });
  }
}
