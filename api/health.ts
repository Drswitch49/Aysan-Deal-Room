import { getBaseSchema } from "../src/lib/airtable/client.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.AIRTABLE_API_KEY || process.env.VITE_AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID || process.env.VITE_AIRTABLE_BASE_ID;

  const envStatus = {
    apiKeyConfigured: !!apiKey,
    baseIdConfigured: !!baseId,
    apiRoot: "https://api.airtable.com/v0"
  };

  try {
    // Attempt to connect to Airtable by querying the tables schema
    const schema = await getBaseSchema();
    const tableNames = schema.tables?.map((t: any) => t.name) || [];
    
    return res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: envStatus,
      airtable: {
        connection: "successful",
        availableTables: tableNames
      }
    });
  } catch (err: any) {
    return res.status(500).json({
      status: "error",
      timestamp: new Date().toISOString(),
      environment: envStatus,
      airtable: {
        connection: "failed",
        error: err.message || err
      }
    });
  }
}
