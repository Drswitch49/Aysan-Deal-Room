/**
 * API endpoint for Team Member CRUD operations
 * POST /api/team-members - Create team member
 * GET /api/team-members - List all team members
 * GET /api/team-members/:id - Get team member by ID
 * PATCH /api/team-members/:id - Update team member
 */

import { airtableCreate, airtableUpdate, airtableFetchRecord, airtableFetchAll } from "../src/lib/airtable/client.js";
import { ensureTable } from "../src/lib/airtable/schema-manager.js";
import { extractUserFromRequest, requirePermission } from "../src/lib/rbac.js";
import { auditTeamMemberCreated, auditTeamMemberUpdated } from "../src/lib/audit.js";
import type { CreateTeamMemberInput } from "../src/types/entities.js";

export default async function handler(req: any, res: any) {
  const user = extractUserFromRequest(req);
  const ipAddress = req.headers["x-forwarded-for"] || req.connection?.remoteAddress;

  try {
    // GET /api/team-members - List all team members
    if (req.method === "GET") {
      const { id } = req.query;

      if (id) {
        // Get single team member
        const record = await airtableFetchRecord("ACP_Team", id);
        if (!record) {
          return res.status(404).json({ error: "Team member not found" });
        }
        return res.status(200).json({
          id: record.id,
          name: record.fields.Name,
          email: record.fields.Email,
          phone: record.fields.Phone,
          role: record.fields.Role,
          status: record.fields.Status,
          createdAt: record.createdTime
        });
      }

      // Get all team members
      const result = await airtableFetchAll("ACP_Team");
      const members = result.records.map((r: any) => ({
        id: r.id,
        name: r.fields.Name,
        email: r.fields.Email,
        phone: r.fields.Phone,
        role: r.fields.Role,
        status: r.fields.Status,
        createdAt: r.createdTime
      }));
      return res.status(200).json(members);
    }

    // POST /api/team-members - Create team member
    if (req.method === "POST") {
      requirePermission(user, "manage_team", "You don't have permission to manage team members");

      const body: CreateTeamMemberInput = req.body;

      // Validate required fields
      if (!body.name || !body.email || !body.role) {
        return res.status(400).json({
          error: "Missing required fields: name, email, role"
        });
      }

      await ensureTable("ACP_Team");

      const record = await airtableCreate("ACP_Team", {
        Name: body.name,
        Email: body.email,
        Phone: body.phone,
        Role: body.role,
        Status: body.status || "Active"
      });

      // Log audit event
      if (user) {
        await auditTeamMemberCreated(record.id, body.name, body.email, user.id, ipAddress);
      }

      return res.status(201).json({
        id: record.id,
        name: record.fields.Name,
        email: record.fields.Email,
        phone: record.fields.Phone,
        role: record.fields.Role,
        status: record.fields.Status
      });
    }

    // PATCH /api/team-members/:id - Update team member
    if (req.method === "PATCH") {
      const { id } = req.query;
      requirePermission(user, "manage_team", "You don't have permission to manage team members");

      if (!id) {
        return res.status(400).json({ error: "Team member ID is required" });
      }

      const body: Partial<CreateTeamMemberInput> = req.body;
      const fields: Record<string, any> = {};

      if (body.name) fields.Name = body.name;
      if (body.email) fields.Email = body.email;
      if (body.phone) fields.Phone = body.phone;
      if (body.role) fields.Role = body.role;
      if (body.status) fields.Status = body.status;

      const record = await airtableUpdate("ACP_Team", id, fields);

      // Log audit event
      if (user) {
        await auditTeamMemberUpdated(id, record.fields.Name, user.id, body, ipAddress);
      }

      return res.status(200).json({
        id: record.id,
        name: record.fields.Name,
        email: record.fields.Email,
        phone: record.fields.Phone,
        role: record.fields.Role,
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
