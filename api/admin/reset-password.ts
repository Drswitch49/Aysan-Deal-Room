import { airtableUpdate, TABLES } from "../_utils/airtable.js";
import { authenticateAdmin } from "./lenders.js";

function generatePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%&*";
  let pass = "";
  for (let i = 0; i < 8; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
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

    // 2. Generate new password
    const newPassword = generatePassword();

    // 3. Update in Airtable
    await airtableUpdate(TABLES.LENDERS, lenderRecordId, {
      Portal_Password: newPassword
    });

    return res.status(200).json({ success: true, password: newPassword });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}
