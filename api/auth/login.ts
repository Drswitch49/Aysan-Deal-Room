import bcrypt from "bcryptjs";
import { airtableFetch, airtableUpdate, escapeFormulaString } from "../_utils/airtable.js";
import { signJWT, setSessionCookie } from "../_utils/jwt.js";

// Global map to track failed administrative login attempts
const failedAdminLogins = new Map<string, { count: number; lockUntil: number }>();

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const rawIp = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "unknown-ip";
  const clientIp = Array.isArray(rawIp)
    ? rawIp[0]
    : typeof rawIp === "string"
    ? rawIp.split(",")[0].trim()
    : "unknown-ip";
  const rateLimitKey = `${clientIp}:${email.toLowerCase().trim()}`;

  // Check rate limit lock status
  const lockInfo = failedAdminLogins.get(rateLimitKey);
  if (lockInfo && lockInfo.lockUntil > Date.now()) {
    const minutesLeft = Math.ceil((lockInfo.lockUntil - Date.now()) / 60000);
    return res.status(429).json({ 
      error: `Too many failed attempts. Locked out. Please try again in ${minutesLeft} minute(s).` 
    });
  }

  try {
    // 1. Fetch user by email from Users table
    const usersData = await airtableFetch("Users", {
      filterByFormula: `{Email} = '${escapeFormulaString(email)}'`,
      maxRecords: 1
    });

    if (!usersData.records || usersData.records.length === 0) {
      handleLoginFailure(rateLimitKey);
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
      handleLoginFailure(rateLimitKey);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Clear failed attempts on successful login
    failedAdminLogins.delete(rateLimitKey);

    // 4. Generate JWT
    const payload = {
      id: userRecord.id,
      email: userFields.Email,
      role: (userFields.Role || "analyst").toLowerCase(),
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
    return res.status(500).json({ 
      error: "Authentication service is temporarily unavailable. Please try again later." 
    });
  }
}

function handleLoginFailure(rateLimitKey: string) {
  const currentFail = failedAdminLogins.get(rateLimitKey) || { count: 0, lockUntil: 0 };
  const newCount = currentFail.count + 1;
  
  if (newCount >= 5) {
    failedAdminLogins.set(rateLimitKey, {
      count: newCount,
      lockUntil: Date.now() + 15 * 60 * 1000 // lock for 15 minutes
    });
  } else {
    failedAdminLogins.set(rateLimitKey, {
      count: newCount,
      lockUntil: 0
    });
  }
}
