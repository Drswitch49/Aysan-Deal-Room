import { getSessionToken, verifyJWT } from "../_utils/jwt.js";
import { logAuditTrail } from "../_utils/audit.js";

// Role hierarchy/definition
export const ROLES = {
  SUPER_ADMIN: "super admin",
  ADMIN: "admin",
  ANALYST: "analyst",
  MANAGING_PARTNER: "managing partner",
  PARTNER: "partner",
  HR: "hr",
  STAKEHOLDER: "stakeholder",
  LENDER: "lender"
};

// Groups
export const ALL_ADMINS = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGING_PARTNER, ROLES.PARTNER];
export const ANALYSTS = [...ALL_ADMINS, ROLES.ANALYST];
export const HR_GROUP = [...ALL_ADMINS, ROLES.HR];
export const ANY_INTERNAL = [...ANALYSTS, ROLES.HR, ROLES.STAKEHOLDER];

export async function requireRole(req: any, res: any, allowedRoles: string[]) {
  const token = getSessionToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized: No session token provided" });
    return null;
  }

  const decoded = await verifyJWT(token);
  if (!decoded || !decoded.email || !decoded.role) {
    res.status(401).json({ error: "Unauthorized: Invalid or expired session" });
    return null;
  }

  const userRole = (decoded.role as string).toLowerCase();

  // Super admin bypasses all role checks
  if (userRole === ROLES.SUPER_ADMIN) {
    req.user = decoded;
    return decoded;
  }

  if (!allowedRoles.includes(userRole)) {
    await logAuditTrail(
      "RBAC_VIOLATION",
      decoded.email as string,
      userRole,
      (decoded.id as string) || "unknown",
      `User attempted to access restricted endpoint: ${req.url}`
    );
    res.status(403).json({ error: `Forbidden: Access restricted. Role '${userRole}' is not authorized.` });
    return null;
  }

  req.user = decoded;
  return decoded;
}
