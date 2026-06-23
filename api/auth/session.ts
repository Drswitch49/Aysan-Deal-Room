import { getSessionToken, verifyJWT, clearSessionCookie } from "../_utils/jwt.js";
import { airtableFetchRecord, TABLES, normalizeLenderFields, airtableFetch, escapeFormulaString } from "../_utils/airtable.js";
import { logAuditTrail } from "../_utils/audit.js";

interface CachedUser {
  name: string;
  status: string;
  role: string;
  permissions: string;
  timestamp: number;
}

const userSessionCache = new Map<string, CachedUser>();

export default async function handler(req: any, res: any) {
  try {
    const token = getSessionToken(req);
    if (!token) {
      return res.status(200).json({ authenticated: false });
    }

    const decoded = await verifyJWT(token);
    if (!decoded || !decoded.email) {
      return res.status(200).json({ authenticated: false });
    }

    const email = decoded.email as string;
    const role = decoded.role as string;
    const id = (decoded.id as string) || "";
    const permissions = decoded.permissions as string;

    // 1. Live Validation for Admin / Analyst (via Users table)
    const roleLower = (role || "").toLowerCase();
    const systemRoles = ["admin", "analyst", "managing partner", "partner", "hr", "stakeholder", "read only", "super admin", "owner"];
    if (systemRoles.includes(roleLower)) {
      let userName = "";
      let userStatus = "";
      let userRole = "";
      let userPermissions = "";

      const cached = userSessionCache.get(email);
      if (cached && Date.now() - cached.timestamp < 5000) {
        userName = cached.name;
        userStatus = cached.status;
        userRole = cached.role;
        userPermissions = cached.permissions;
      } else {
        const usersRes = await airtableFetch("Users", {
          filterByFormula: `{Email} = '${escapeFormulaString(email)}'`,
          maxRecords: 1
        });

        if (!usersRes.records || usersRes.records.length === 0) {
          clearSessionCookie(res);
          await logAuditTrail(
            "SESSION_REVOKED_DB_MISSING",
            email,
            role,
            id || "unknown",
            "Session revoked: user account not found in database."
          );
          return res.status(200).json({ authenticated: false });
        }

        const userRec = usersRes.records[0];
        userName = userRec.fields.Name || userRec.fields["Full Name"] || userRec.fields["First Name"] || "User";
        userStatus = userRec.fields.Status || "";
        userRole = userRec.fields.Role || "";
        userPermissions = userRec.fields.Permissions || "";

        userSessionCache.set(email, {
          name: userName,
          status: userStatus,
          role: userRole,
          permissions: userPermissions,
          timestamp: Date.now()
        });
      }

      if (userStatus !== "Active") {
        clearSessionCookie(res);
        await logAuditTrail(
          "SESSION_REVOKED_DEACTIVATED",
          email,
          userRole,
          id || "unknown",
          `Access attempted by deactivated user [${email}]. Session forced logged out.`
        );
        return res.status(200).json({ authenticated: false });
      }

      if (userRole.toLowerCase() !== role.toLowerCase()) {
        clearSessionCookie(res);
        await logAuditTrail(
          "SESSION_REVOKED_ROLE_MISMATCH",
          email,
          userRole,
          id || "unknown",
          `Session role changed (JWT: ${role}, DB: ${userRole}). Session forced logged out.`
        );
        return res.status(200).json({ authenticated: false });
      }
    }

    // 2. Live Validation for Lenders (via Lenders table)
    let lenderFields: any = null;
    if (role === "lender" && id) {
      try {
        const lenderRecord = await airtableFetchRecord(TABLES.LENDERS, id);
        if (!lenderRecord || !lenderRecord.fields) {
          clearSessionCookie(res);
          await logAuditTrail(
            "SESSION_REVOKED_LENDER_MISSING",
            email,
            "lender",
            id,
            "Lender portal session revoked: lender record deleted."
          );
          return res.status(200).json({ authenticated: false });
        }

        lenderFields = normalizeLenderFields(lenderRecord.fields);
        delete lenderFields.Portal_Password;

        if (lenderFields.Status !== "Active") {
          clearSessionCookie(res);
          await logAuditTrail(
            "SESSION_REVOKED_LENDER_INACTIVE",
            email,
            "lender",
            id,
            `Access attempted by deactivated lender portal [${lenderFields.Company_Name || id}]. Session revoked.`
          );
          return res.status(200).json({ authenticated: false });
        }
      } catch (err: any) {
        console.warn("Failed to fetch lender profile in session check:", err);
        // If the table is offline or failed, we fall back safely, but if the record explicitly fails to find, we protect the entry
        if (err.status === 404) {
          clearSessionCookie(res);
          return res.status(200).json({ authenticated: false });
        }
      }
    }

    return res.status(200).json({
      authenticated: true,
      user: {
        name: systemRoles.includes(roleLower) ? userSessionCache.get(email)?.name : lenderFields?.Contact_Name || lenderFields?.Company_Name || email,
        email,
        role,
        permissions,
        ...(lenderFields || {})
      }
    });
  } catch (err) {
    return res.status(200).json({ authenticated: false });
  }
}
