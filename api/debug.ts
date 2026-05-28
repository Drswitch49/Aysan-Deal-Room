export default async function handler(req: any, res: any) {
  const apiKey = process.env.VITE_AIRTABLE_API_KEY || process.env.AIRTABLE_API_KEY;
  const baseId = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID;
  return res.status(200).json({
    nodeVersion: process.version,
    hasApiKey: !!apiKey,
    apiKeyLength: apiKey ? apiKey.length : 0,
    apiKeyPrefix: apiKey ? apiKey.substring(0, 5) : "",
    hasBaseId: !!baseId,
    baseId: baseId || "",
    hasFetch: typeof fetch !== "undefined",
    hasResponse: typeof Response !== "undefined",
  });
}
