import bcrypt from "bcryptjs";
import { airtableFetch, airtableUpdate, escapeFormulaString } from "../_utils/airtable.js";
import { signJWT, setSessionCookie } from "../_utils/jwt.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    // 1. Fetch user by email from Users table
    const usersData = await airtableFetch("Users", {
      filterByFormula: `{Email} = '${escapeFormulaString(email)}'`,
      maxRecords: 1
    });

    if (!usersData.records || usersData.records.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const userRecord = usersData.records[0];
    const userFields = userRecord.fields;

    // 2. Check user status
    if (userFields.Status !== "Active") {
      return res.status(403).json({ error: "User account is inactive" });
    }

    // 3. Verify password hash
    const isMatch = bcrypt.compareSync(password, userFields.PasswordHash || "");
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // 4. Generate JWT
    const payload = {
      id: userRecord.id,
      email: userFields.Email,
      role: userFields.Role || "analyst",
      permissions: userFields.Permissions || ""
    };
    const token = await signJWT(payload);

    // 5. Set session cookie
    setSessionCookie(res, token);

    // 6. Update LastLogin timestamp
    await airtableUpdate("Users", userRecord.id, {
      LastLogin: new Date().toISOString()
    }).catch(err => console.warn("Failed to update LastLogin in Airtable:", err));

    return res.status(200).json({
      success: true,
      user: {
        email: userFields.Email,
        role: userFields.Role,
        permissions: userFields.Permissions
      }
    });
  } catch (err: any) {
    console.error("[Login API Error]:", err);
    return res.status(500).json({ error: err.message || "Failed to process login" });
  }
}
