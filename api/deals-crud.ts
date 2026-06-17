/**
 * API endpoint for Deal CRUD operations
 * POST /api/deals - Create deal
 * GET /api/deals - List all deals
 * GET /api/deals?stage=... - Filter deals by stage
 * GET /api/deals/:id - Get deal by ID
 * PATCH /api/deals/:id - Update deal
 */

import {
  createDeal,
  getDeal,
  updateDeal,
  getAllDeals,
  getDealsByStage
} from "../src/lib/crud.js";
import {
  extractUserFromRequest,
  canCreateDeal,
  canEditDeal,
  requirePermission
} from "../src/lib/rbac.js";
import {
  auditDealCreated,
  auditDealUpdated
} from "../src/lib/audit.js";
import type { CreateDealInput } from "../src/types/entities.js";

export default async function handler(req: any, res: any) {
  const user = extractUserFromRequest(req);
  const ipAddress = req.headers["x-forwarded-for"] || req.connection?.remoteAddress;

  try {
    // GET /api/deals - List all deals or filter by stage
    if (req.method === "GET") {
      const { id, stage } = req.query;

      if (id) {
        // Get single deal
        const deal = await getDeal(id);
        if (!deal) {
          return res.status(404).json({ error: "Deal not found" });
        }
        return res.status(200).json(deal);
      }

      if (stage) {
        // Get deals by stage
        const deals = await getDealsByStage(stage);
        return res.status(200).json(deals);
      }

      // Get all deals
      const deals = await getAllDeals();
      return res.status(200).json(deals);
    }

    // POST /api/deals - Create deal
    if (req.method === "POST") {
      requirePermission(user, "create_deal", "You don't have permission to create deals");

      const body: CreateDealInput = req.body;

      // Validate required fields
      if (!body.companyName || !body.projectName || !body.industry || !body.location || !body.owner || !body.analyst || !body.source) {
        return res.status(400).json({
          error: "Missing required fields: companyName, projectName, industry, location, owner, analyst, source"
        });
      }

      const deal = await createDeal(body);

      // Log audit event
      if (user) {
        await auditDealCreated(deal.id, deal.dealRef, user.id, ipAddress);
      }

      return res.status(201).json(deal);
    }

    // PATCH /api/deals/:id - Update deal
    if (req.method === "PATCH") {
      const { id } = req.query;
      requirePermission(user, "edit_deal", "You don't have permission to edit deals");

      if (!id) {
        return res.status(400).json({ error: "Deal ID is required" });
      }

      const body: Partial<CreateDealInput> = req.body;
      const deal = await updateDeal(id, body);

      // Log audit event
      if (user) {
        await auditDealUpdated(deal.id, deal.dealRef, user.id, body, ipAddress);
      }

      return res.status(200).json(deal);
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
