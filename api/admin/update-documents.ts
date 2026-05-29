import { airtableUpdate, TABLES } from "../_utils/airtable.js";
import { authenticateAdmin } from "./lenders.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin
    authenticateAdmin(req);

    const { updates } = req.body || {};
    if (!updates || !Array.isArray(updates)) {
      return res.status(400).json({ error: "Updates list is required and must be an array" });
    }

    // 2. Perform updates in parallel
    const results = await Promise.all(
      updates.map(async (update: { id: string; fields: Record<string, any> }) => {
        const { id, fields } = update;
        if (!id || !fields) {
          throw new Error("Each update must have an 'id' and 'fields' object");
        }
        return airtableUpdate(TABLES.DOCUMENTS, id, fields);
      })
    );

    return res.status(200).json({ success: true, results });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}
