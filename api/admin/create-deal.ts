import { airtableCreate, TABLES } from "../_utils/airtable.js";
import { authenticateAdmin } from "./lenders.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin
    authenticateAdmin(req);

    const { companyName, dealRef, stage, sector, location, broker, dealFiles } = req.body || {};
    if (!companyName) {
      return res.status(400).json({ error: "Company Name is required" });
    }

    // Generate a reference number if not provided
    const generatedRef = dealRef || `ACP-${Math.floor(1000 + Math.random() * 9000)}`;

    // 2. Create record in Deal_Inbox table
    const inboxFields: Record<string, any> = {
      "Deal Name": companyName,
      "REF. NO": generatedRef,
      "Sector": sector || "",
      "Location": location || "",
      "BROKER": broker || "",
      "Deal Files": dealFiles || "",
      "Status": "Passed Review"
    };

    const inboxRecord = await airtableCreate("Deal_Inbox", inboxFields);

    // 3. Create record in Active_Pipeline linked to Deal_Inbox
    const pipelineFields: Record<string, any> = {
      "Deal Name": companyName,
      "Stage": stage || "Intro",
      "Deal_Inbox": [inboxRecord.id]
    };

    const pipelineRecord = await airtableCreate(TABLES.PIPELINE, pipelineFields);

    return res.status(200).json({
      success: true,
      inboxRecord,
      pipelineRecord
    });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}
