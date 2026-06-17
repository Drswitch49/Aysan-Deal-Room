/**
 * API endpoint for External Stakeholder CRUD operations
 * POST /api/stakeholders - Create stakeholder
 * GET /api/stakeholders - List all stakeholders
 * GET /api/stakeholders/:id - Get stakeholder by ID
 * PATCH /api/stakeholders/:id - Update stakeholder
 */

import { airtableCreate, airtableUpdate, airtableFetchRecord, airtableFetchAll } from "../src/lib/airtable/client.js";
import { ensureTable } from "../src/lib/airtable/schema-manager.js";
import { extractUserFromRequest, requirePermission } from "../src/lib/rbac.js";
import { auditStakeholderCreated, auditStakeholderUpdated } from "../src/lib/audit.js";
import type { CreateExternalStakeholderInput } from "../src/types/entities.js";

export default async function handler(req: any, res: any) {
  const user = extractUserFromRequest(req);
  const ipAddress = req.headers["x-forwarded-for"] || req.connection?.remoteAddress;

  try {
    // GET /api/stakeholders - List all stakeholders
    if (req.method === "GET") {
      const { id, type } = req.query;

      if (id) {
        // Get single stakeholder
        const record = await airtableFetchRecord("External_Stakeholders", id);
        if (!record) {
          return res.status(404).json({ error: "Stakeholder not found" });
        }
        return res.status(200).json({
          id: record.id,
          name: record.fields.Name,
          type: record.fields.Type,
          email: record.fields.Email,
          phone: record.fields.Phone,
          organization: record.fields.Organization,
          notes: record.fields.Notes,
          status: record.fields.Status,
          createdAt: record.createdTime
        });
      }

      // Get all stakeholders or filter by type
      let filterFormula = "";
      if (type) {
        filterFormula = `{Type} = "${type}"`;
      }

      const result = await airtableFetchAll("External_Stakeholders", {
        filterByFormula: filterFormula || undefined
      });

      const stakeholders = result.records.map((r: any) => ({
        id: r.id,
        name: r.fields.Name,
        type: r.fields.Type,
        email: r.fields.Email,
        phone: r.fields.Phone,
        organization: r.fields.Organization,
        notes: r.fields.Notes,
        status: r.fields.Status,
        createdAt: r.createdTime
      }));
      return res.status(200).json(stakeholders);
    }

    // POST /api/stakeholders - Create stakeholder
    if (req.method === "POST") {
      requirePermission(user, "manage_stakeholders", "You don't have permission to manage stakeholders");

      const body: CreateExternalStakeholderInput = req.body;

      // Validate required fields
      if (!body.name || !body.type) {
        return res.status(400).json({
          error: "Missing required fields: name, type"
        });
      }

      await ensureTable("External_Stakeholders");

      const record = await airtableCreate("External_Stakeholders", {
        Name: body.name,
        Type: body.type,
        Email: body.email,
        Phone: body.phone,
        Organization: body.organization,
        Notes: body.notes,
        Status: "Active"
      });

      // Log audit event
      if (user) {
        await auditStakeholderCreated(record.id, body.name, user.id, ipAddress);
      }

      return res.status(201).json({
        id: record.id,
        name: record.fields.Name,
        type: record.fields.Type,
        email: record.fields.Email,
        phone: record.fields.Phone,
        organization: record.fields.Organization,
        notes: record.fields.Notes,
        status: record.fields.Status
      });
    }

    // PATCH /api/stakeholders/:id - Update stakeholder
    if (req.method === "PATCH") {
      const { id } = req.query;
      requirePermission(user, "manage_stakeholders", "You don't have permission to manage stakeholders");

      if (!id) {
        return res.status(400).json({ error: "Stakeholder ID is required" });
      }

      const body: Partial<CreateExternalStakeholderInput> & { status?: string } = req.body;
      const fields: Record<string, any> = {};

      if (body.name) fields.Name = body.name;
      if (body.type) fields.Type = body.type;
      if (body.email) fields.Email = body.email;
      if (body.phone) fields.Phone = body.phone;
      if (body.organization) fields.Organization = body.organization;
      if (body.notes) fields.Notes = body.notes;
      if (body.status) fields.Status = body.status;

      const record = await airtableUpdate("External_Stakeholders", id, fields);

      // Log audit event
      if (user) {
        await auditStakeholderUpdated(id, record.fields.Name, user.id, body, ipAddress);
      }

      return res.status(200).json({
        id: record.id,
        name: record.fields.Name,
        type: record.fields.Type,
        email: record.fields.Email,
        phone: record.fields.Phone,
        organization: record.fields.Organization,
        notes: record.fields.Notes,
        status: record.fields.Status
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
