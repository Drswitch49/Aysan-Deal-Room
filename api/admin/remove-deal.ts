import { airtableDelete, TABLES } from "../_utils/airtable.js";
import { authenticateAdmin } from "./lenders.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin
    authenticateAdmin(req);

    const { assignmentId } = req.body || {};
    if (!assignmentId) {
      return res.status(400).json({ error: "Assignment ID is required" });
    }

    // 2. Delete the record from Lender_Deal_Assignments
    await airtableDelete(TABLES.ASSIGNMENTS, assignmentId);

    return res.status(200).json({ success: true, message: "Deal assignment successfully removed." });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}
