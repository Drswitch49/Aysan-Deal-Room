import { TABLES, getTableSchema } from "./_utils/airtable.js";

export default async function handler(req: any, res: any) {
  const apiKey = process.env.VITE_AIRTABLE_API_KEY || process.env.AIRTABLE_API_KEY;
  const baseId = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID;
  
  let pipelineSchema: any = null;
  let metadataError: any = null;

  try {
    pipelineSchema = await getTableSchema(TABLES.PIPELINE);
  } catch (err: any) {
    metadataError = {
      message: err.message,
      stack: err.stack,
      name: err.name
    };
  }

  return res.status(200).json({
    nodeVersion: process.version,
    pipelineSchema,
    metadataError,
    hasApiKey: !!apiKey,
    apiKeyLength: apiKey ? apiKey.length : 0,
    hasBaseId: !!baseId,
    baseId: baseId || "",
    hasFetch: typeof fetch !== "undefined",
    hasResponse: typeof Response !== "undefined",
  });
}
