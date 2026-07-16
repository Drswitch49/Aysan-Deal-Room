import { airtableCreate, escapeFormulaString, airtableFetch, TABLES, normalizeLenderFields } from "../_utils/airtable.js";
import { authenticateAdmin } from "../admin/lenders_auth_helper.js";
import bcrypt from "bcryptjs";
import { generatePassword, generateSlugSuffix } from "../../lib/core/secure-random.js";

// Helper to generate a unique portal slug
async function generateUniqueSlug(companyName: string): Promise<string> {
  const normalized = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  
  const randomSuffix = generateSlugSuffix(6);
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
    const uniqueLenderId = "LND-" + generateSlugSuffix(6).toUpperCase();

    // 2. Hash password for the Users and Lenders tables
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);

    const emailValue = email ? email.trim() : `${slug}@lender-portal.com`;

    // 3. Create the record in Lenders table with hashed password
    const fields = {
      Name: companyName,
      Lender_ID: uniqueLenderId,
      Company_Name: companyName,
      Contact_Name: contactName || "",
      Email: emailValue,
      Phone: phone || "",
      Portal_Slug: slug,
      Portal_Password: hash,
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
    
    // Normalize and redact the hashed password, but send plaintext once in the creation response
    const normalized = normalizeLenderFields(record.fields);
    
    return res.status(200).json({
      id: record.id,
      ...normalized,
      Portal_Password: password // Return the generated plaintext password ONCE
    });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message || "Failed to create lender", type: err.type });
  }
}
