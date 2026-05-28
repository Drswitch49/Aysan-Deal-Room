export default async function handler(req: any, res: any) {
  const apiKey = process.env.VITE_AIRTABLE_API_KEY || process.env.AIRTABLE_API_KEY;
  const baseId = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID;
  
  let importSuccess = false;
  let importError: any = null;
  let tablesConstant: any = null;

  try {
    const airtableModule = await import("./_utils/airtable.js");
    importSuccess = true;
    tablesConstant = airtableModule.TABLES;
  } catch (err: any) {
    importError = {
      message: err.message,
      stack: err.stack,
      name: err.name,
      code: err.code
    };
  }

  return res.status(200).json({
    nodeVersion: process.version,
    importSuccess,
    importError,
    tablesConstant,
    hasApiKey: !!apiKey,
    apiKeyLength: apiKey ? apiKey.length : 0,
    hasBaseId: !!baseId,
    baseId: baseId || "",
    hasFetch: typeof fetch !== "undefined",
    hasResponse: typeof Response !== "undefined",
  });
}
