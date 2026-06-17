/**
 * API endpoint for Team Member CRUD operations
 * POST /api/team-members-crud - Create team member
 * GET /api/team-members-crud - List all team members
 * PATCH /api/team-members-crud?id=X - Update team member
 */
import { airtableCreate, airtableUpdate, airtableFetch, airtableFetchRecord, TABLES } from "./_utils/airtable.js";

export default async function handler(req: any, res: any) {
  try {
    if (req.method === "GET") {
      const { id } = req.query;
      if (id) {
        const record = await airtableFetchRecord(TABLES.TEAM, id);
        return res.status(200).json(record);
      }
      const data = await airtableFetch(TABLES.TEAM);
      return res.status(200).json(data.records || []);
    }

    if (req.method === "POST") {
      const { name, email, phone, role, status } = req.body;
      if (!name || !email) {
        return res.status(400).json({ error: "Missing required fields: name, email" });
      }
      const fields: Record<string, any> = {
        "Name": name,
        "Email": email,
      };
      if (phone) fields["Phone"] = phone;
      if (role) fields["Role"] = role;
      if (status) fields["Status"] = status;

      const record = await airtableCreate(TABLES.TEAM, fields);
      return res.status(201).json(record);
    }

    if (req.method === "PATCH") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "Team member ID is required" });
      const fields: Record<string, any> = {};
      const body = req.body;
      if (body.name) fields["Name"] = body.name;
      if (body.email) fields["Email"] = body.email;
      if (body.phone !== undefined) fields["Phone"] = body.phone;
      if (body.role) fields["Role"] = body.role;
      if (body.status) fields["Status"] = body.status;

      const record = await airtableUpdate(TABLES.TEAM, id, fields);
      return res.status(200).json(record);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    console.error("[team-members-crud] Error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}
