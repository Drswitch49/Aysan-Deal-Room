import { airtableFetch, airtableUpdate, airtableFetchRecord, escapeFormulaString, TABLES } from "../_utils/airtable.js";
import { authenticateAdmin } from "./lenders.js";

async function generateUniqueSlug(companyName: string): Promise<string> {
  const normalized = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const slug = `${normalized || "lender"}-${randomSuffix}`;

  const existing = await airtableFetch(TABLES.LENDERS, {
    filterByFormula: `{Portal_Slug} = '${escapeFormulaString(slug)}'`,
    maxRecords: 1
  });

  if (existing.records && existing.records.length > 0) {
    return generateUniqueSlug(companyName);
  }

  return slug;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin
    authenticateAdmin(req);

    const { lenderRecordId } = req.body || {};
    if (!lenderRecordId) {
      return res.status(400).json({ error: "Lender record ID is required" });
    }

    // 2. Fetch lender details to get Company Name
    const lenderData = await airtableFetchRecord(TABLES.LENDERS, lenderRecordId);
    const companyName = lenderData.fields.Company_Name;

    if (!companyName) {
      return res.status(400).json({ error: "Lender record does not contain a company name" });
    }

    // 3. Generate new unique slug
    const newSlug = await generateUniqueSlug(companyName);

    // 4. Update in Airtable
    await airtableUpdate(TABLES.LENDERS, lenderRecordId, {
      Portal_Slug: newSlug
    });

    return res.status(200).json({ success: true, slug: newSlug });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}
