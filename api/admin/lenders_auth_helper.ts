import { getSessionToken, verifyJWT } from "../_utils/jwt.js";
import { airtableFetch, escapeFormulaString } from "../_utils/airtable.js";

export async function authenticateAdmin(req: any) {
  const token = getSessionToken(req);
  if (!token) {
    throw new Error("Unauthorized: No session token found");
  }

  const decoded = await verifyJWT(token);
  if (!decoded || !decoded.email) {
    throw new Error("Unauthorized: Invalid session token");
  }

  // Query database to validate role and status in real-time
  const usersRes = await airtableFetch("Users", {
    filterByFormula: `{Email} = '${escapeFormulaString(decoded.email)}'`,
    maxRecords: 1
  });

  if (!usersRes.records || usersRes.records.length === 0) {
    throw new Error("Unauthorized: User account not found in database");
  }

  const userRecord = usersRes.records[0];
  const userFields = userRecord.fields;

  if (userFields.Status !== "Active") {
    throw new Error("Unauthorized: User account is deactivated");
  }

  const role = userFields.Role;
  const roleLower = (role || "").toLowerCase();
  const allowedRoles = [
    "admin", "analyst", "associate", "managing partner", "partner", "hr", "read only", "super admin", "owner",
    "stakeholder", "advisor", "lawyer", "broker", "consultant", "investor", "portfolio contact"
  ];
  if (!allowedRoles.includes(roleLower)) {
    // If it's the super admin email, bypass this check, otherwise throw
    if ((userFields.Email || "").trim().toLowerCase() !== "admin@aysancapital.com") {
      throw new Error("Unauthorized: Invalid role permissions");
    }
  }

  // Super Admin Override
  const userEmail = (userFields.Email || "").trim().toLowerCase();
  if (userEmail === "admin@aysancapital.com") {
    req.user = {
      id: userRecord.id,
      email: userFields.Email,
      role: "super admin",
      permissions: "admin"
    };
    return;
  }

  // Attach live database permissions & identity to request (normalized to lowercase)
  req.user = {
    id: userRecord.id,
    email: userFields.Email,
    role: roleLower,
    permissions: userFields.Permissions || ""
  };
}
