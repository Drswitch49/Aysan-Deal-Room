/**
 * API endpoint for Deal Stage Management
 * PATCH /api/deals/:id/stage - Change deal stage
 * GET /api/deals/:id/stage-history - Get stage history
 */

import { airtableUpdate, airtableCreate, airtableFetchAll } from "../src/lib/airtable/client.js";
import { ensureTable } from "../src/lib/airtable/schema-manager.js";
import { extractUserFromRequest, requirePermission } from "../src/lib/rbac.js";
import { auditStageChanged } from "../src/lib/audit.js";

export default async function handler(req: any, res: any) {
  const user = extractUserFromRequest(req);
  const ipAddress = req.headers["x-forwarded-for"] || req.connection?.remoteAddress;
  const { id, action } = req.query;

  try {
    // GET /api/deals/:id/stage-history - Get stage change history
    if (req.method === "GET" && action === "history") {
      if (!id) {
        return res.status(400).json({ error: "Deal ID is required" });
      }

      const result = await airtableFetchAll("Deal_Stage_History", {
        filterByFormula: `{Deal_Ref} = "${id}"`,
        sort: [{ field: "Changed_At", direction: "desc" }]
      });

      return res.status(200).json(result.records.map((r: any) => ({
        id: r.id,
        dealRef: r.fields.Deal_Ref,
        fromStage: r.fields.From_Stage,
        toStage: r.fields.To_Stage,
        changedBy: r.fields.Changed_By,
        changedAt: r.fields.Changed_At,
        notes: r.fields.Notes
      })));
    }

    // PATCH /api/deals/:id/stage - Change stage
    if (req.method === "PATCH") {
      requirePermission(user, "manage_stages", "You don't have permission to manage stages");

      if (!id) {
        return res.status(400).json({ error: "Deal ID is required" });
      }

      const { toStage, notes } = req.body;

      if (!toStage) {
        return res.status(400).json({ error: "toStage is required" });
      }

      // Get current deal to find current stage
      const { airtableFetchRecord } = await import("../src/lib/airtable/client.js");
      const deal = await airtableFetchRecord("Deals", id);

      if (!deal) {
        return res.status(404).json({ error: "Deal not found" });
      }

      const currentStage = deal.fields.Stage || "Intro";

      // Update deal stage
      const updatedDeal = await airtableUpdate("Deals", id, {
        Stage: toStage
      });

      // Ensure stage history table exists
      await ensureTable("Deal_Stage_History");

      // Record stage change
      await airtableCreate("Deal_Stage_History", {
        Deal_Ref: deal.fields.Deal_Ref || id,
        From_Stage: currentStage,
        To_Stage: toStage,
        Changed_By: user?.name || "System",
        Notes: notes
      });

      // Log audit event
      if (user) {
        await auditStageChanged(id, deal.fields.Deal_Ref || id, currentStage, toStage, user.id, ipAddress);
      }

      return res.status(200).json({
        id: updatedDeal.id,
        stage: updatedDeal.fields.Stage,
        changedAt: new Date().toISOString()
      });
    }

    // Method not allowed
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    console.error("[API] Error:", error);

    if (error.message.includes("Authentication required")) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (error.message.includes("Permission denied")) {
      return res.status(403).json({ error: error.message });
    }

    return res.status(500).json({
      error: error.message || "Internal server error"
    });
  }
}
