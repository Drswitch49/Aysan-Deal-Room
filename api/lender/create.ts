import { airtableCreate, escapeFormulaString, airtableFetch, TABLES } from "../_utils/airtable";

// Helper to generate a secure random password
function generatePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%&*";
  let pass = "";
  for (let i = 0; i < 8; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

// Helper to generate a unique portal slug
async function generateUniqueSlug(companyName: string): Promise<string> {
  const normalized = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const slug = `${normalized || "lender"}-${randomSuffix}`;

  // Verify uniqueness in Airtable
  try {
    const existing = await airtableFetch(TABLES.LENDERS, {
      filterByFormula: `{Portal_Slug} = '${escapeFormulaString(slug)}'`,
      maxRecords: 1
    });
    if (existing.records && existing.records.length > 0) {
      // Re-generate if duplicate
      return generateUniqueSlug(companyName);
    }
  } catch (err: any) {
    // If table doesn't exist, we don't block here, let the create action trigger the table setup error
    if (err.type === "TABLE_NOT_FOUND") {
      throw err;
    }
  }

  return slug;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  const adminPasscode = req.headers["x-admin-passcode"];
  const requiredPass = process.env.VITE_LENDER_ROOM_PASSWORD || "acp-deal-room";
  if (adminPasscode !== requiredPass) {
    return res.status(401).json({ error: "Unauthorized admin request" });
  }

  const { companyName, contactName, email, phone, status } = req.body || {};
  if (!companyName) {
    return res.status(400).json({ error: "Company name is required" });
  }

  try {
    const slug = await generateUniqueSlug(companyName);
    const password = generatePassword();
    const uniqueLenderId = "LND-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    const fields = {
      Lender_ID: uniqueLenderId,
      Company_Name: companyName,
      Contact_Name: contactName || "",
      Email: email || "",
      Phone: phone || "",
      Portal_Slug: slug,
      Portal_Password: password,
      Status: status || "Active",
      Created_At: new Date().toISOString()
    };

    const record = await airtableCreate(TABLES.LENDERS, fields);
    
    return res.status(200).json({
      id: record.id,
      ...record.fields
    });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}
