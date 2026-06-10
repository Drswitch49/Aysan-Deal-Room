import { airtableCreate, escapeFormulaString, airtableFetch, TABLES, normalizeLenderFields } from "../_utils/airtable.js";
import { authenticateAdmin } from "../admin/lenders_auth_helper.js";
import bcrypt from "bcryptjs";

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
  
  try {
    const existing = await airtableFetch(TABLES.LENDERS, {
      filterByFormula: `{Portal_Slug} = '${escapeFormulaString(slug)}'`,
      maxRecords: 1
    });
    if (existing.records && existing.records.length > 0) {
      return generateUniqueSlug(companyName);
    }
  } catch (err: any) {
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

  try {
    // 1. Authenticate Admin via secure JWT cookies
    await authenticateAdmin(req);

    const { companyName, contactName, email, phone, status } = req.body || {};
    if (!companyName) {
      return res.status(400).json({ error: "Company name is required" });
    }

    const slug = await generateUniqueSlug(companyName);
    const password = generatePassword();
    const uniqueLenderId = "LND-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    // 2. Hash password for the Users table
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);

    const emailValue = email ? email.trim() : `${slug}@lender-portal.com`;

    // 3. Create the record in Lenders table
    const fields = {
      Name: companyName,
      Lender_ID: uniqueLenderId,
      Company_Name: companyName,
      Contact_Name: contactName || "",
      Email: emailValue,
      Phone: phone || "",
      Portal_Slug: slug,
      Portal_Password: password,
      Status: status || "Active",
      Created_At: new Date().toISOString()
    };

    const record = await airtableCreate(TABLES.LENDERS, fields);

    // 4. Create the corresponding record in Users table
    await airtableCreate("Users", {
      Email: emailValue,
      PasswordHash: hash,
      Role: "lender",
      Status: status || "Active",
      Permissions: "read",
      CreatedAt: new Date().toISOString()
    }).catch(err => console.warn("Failed to create user record for new lender:", err));
    
    return res.status(200).json({
      id: record.id,
      ...normalizeLenderFields(record.fields)
    });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message || "Failed to create lender", type: err.type });
  }
}
