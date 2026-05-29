import { airtableCreate, TABLES } from "../_utils/airtable.js";
import { authenticateAdmin } from "./lenders.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin
    authenticateAdmin(req);

    const { documentName, category, status, driveLink, dealId, ablCritical } = req.body || {};
    if (!documentName || !category || !dealId) {
      return res.status(400).json({ error: "Document Name, Category, and Deal ID are required" });
    }

    // 2. Format fields for Airtable (linked records must be passed as an array of IDs)
    const fields: Record<string, any> = {
      "Document_Name": documentName,
      "Category": category,
      "Status": status || "Outstanding",
      "Drive_Link": driveLink || "",
      "Deal_Ref": [dealId],
      "ABL_Critical": !!ablCritical
    };

    // 3. Create document in Airtable
    const result = await airtableCreate(TABLES.DOCUMENTS, fields);

    return res.status(200).json({ success: true, result });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}
