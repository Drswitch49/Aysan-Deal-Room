/**
 * API endpoint for Stakeholder CRUD operations
 * POST /api/stakeholders-crud - Create stakeholder
 * GET /api/stakeholders-crud - List all stakeholders
 * PATCH /api/stakeholders-crud?id=X - Update stakeholder
 */
import { airtableCreate, airtableUpdate, airtableFetch, airtableFetchRecord, TABLES } from "./_utils/airtable.js";

export default async function handler(req: any, res: any) {
  try {
    if (req.method === "GET") {
      const { id, type } = req.query;
      if (id) {
        const record = await airtableFetchRecord(TABLES.STAKEHOLDERS, id);
        return res.status(200).json(record);
      }
      const params: any = {};
      if (type) {
        params.filterByFormula = `{Type} = "${type}"`;
      }
      const data = await airtableFetch(TABLES.STAKEHOLDERS, params);
      return res.status(200).json(data.records || []);
    }

    if (req.method === "POST") {
      const { name, type, email, phone, organization, notes } = req.body;
      if (!name || !type) {
        return res.status(400).json({ error: "Missing required fields: name, type" });
      }
      const fields: Record<string, any> = {
        "Name": name,
        "Type": type,
      };
      if (email) fields["Email"] = email;
      if (phone) fields["Phone"] = phone;
      if (organization) fields["Organization"] = organization;
      if (notes) fields["Notes"] = notes;
      fields["Status"] = "Active";

      const record = await airtableCreate(TABLES.STAKEHOLDERS, fields);
      return res.status(201).json(record);
    }

    if (req.method === "PATCH") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "Stakeholder ID is required" });
      const fields: Record<string, any> = {};
      const body = req.body;
      if (body.name) fields["Name"] = body.name;
      if (body.type) fields["Type"] = body.type;
      if (body.email !== undefined) fields["Email"] = body.email;
      if (body.phone !== undefined) fields["Phone"] = body.phone;
      if (body.organization !== undefined) fields["Organization"] = body.organization;
      if (body.notes !== undefined) fields["Notes"] = body.notes;
      if (body.status) fields["Status"] = body.status;

      const record = await airtableUpdate(TABLES.STAKEHOLDERS, id, fields);
      return res.status(200).json(record);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    console.error("[stakeholders-crud] Error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}
