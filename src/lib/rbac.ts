import type { UserRole } from "../types/entities.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: "Active" | "Inactive";
}

/**
 * Define permissions for each role
 */
const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  "Managing Partner": [
    "view_deals",
    "create_deal",
    "edit_deal",
    "delete_deal",
    "manage_stages",
    "upload_documents",
    "manage_portfolio",
    "manage_team",
    "manage_stakeholders",
    "view_audit_logs",
    "view_analytics"
  ],
  "Partner": [
    "view_deals",
    "create_deal",
    "edit_deal",
    "manage_stages",
    "upload_documents",
    "manage_portfolio",
    "manage_stakeholders",
    "view_audit_logs",
    "view_analytics"
  ],
  "Analyst": [
    "view_deals",
    "create_deal",
    "edit_deal",
    "manage_stages",
    "upload_documents",
    "view_audit_logs"
  ],
  "Admin": [
    "view_deals",
    "create_deal",
    "edit_deal",
    "delete_deal",
    "manage_stages",
    "upload_documents",
    "manage_portfolio",
    "manage_team",
    "manage_stakeholders",
    "view_audit_logs",
    "view_analytics"
  ],
  "Read Only": [
    "view_deals",
    "view_audit_logs"
  ]
};

/**
 * Check if a user has a specific permission
 */
export function hasPermission(
  user: AuthenticatedUser,
  permission: string
): boolean {
  if (user.status !== "Active") {
    return false;
  }

  const permissions = ROLE_PERMISSIONS[user.role];
  return permissions ? permissions.includes(permission) : false;
}

/**
 * Check if a user can perform an action
 */
export function canCreateDeal(user: AuthenticatedUser): boolean {
  return hasPermission(user, "create_deal");
}

export function canEditDeal(user: AuthenticatedUser): boolean {
  return hasPermission(user, "edit_deal");
}

export function canDeleteDeal(user: AuthenticatedUser): boolean {
  return hasPermission(user, "delete_deal");
}

export function canManageStages(user: AuthenticatedUser): boolean {
  return hasPermission(user, "manage_stages");
}

export function canUploadDocuments(user: AuthenticatedUser): boolean {
  return hasPermission(user, "upload_documents");
}

export function canManagePortfolio(user: AuthenticatedUser): boolean {
  return hasPermission(user, "manage_portfolio");
}

export function canManageTeam(user: AuthenticatedUser): boolean {
  return hasPermission(user, "manage_team");
}

export function canManageStakeholders(user: AuthenticatedUser): boolean {
  return hasPermission(user, "manage_stakeholders");
}

export function canViewAuditLogs(user: AuthenticatedUser): boolean {
  return hasPermission(user, "view_audit_logs");
}

export function canViewAnalytics(user: AuthenticatedUser): boolean {
  return hasPermission(user, "view_analytics");
}

/**
 * Require permission or throw error
 */
export function requirePermission(
  user: AuthenticatedUser | null,
  permission: string,
  message?: string
): void {
  if (!user) {
    throw new Error("Authentication required");
  }

  if (!hasPermission(user, permission)) {
    throw new Error(message || `Permission denied: ${permission}`);
  }
}

/**
 * Middleware to extract and validate user from request headers
 * Assumes JWT token in Authorization header
 */
export function extractUserFromHeaders(
  authHeader?: string
): AuthenticatedUser | null {
  if (!authHeader) {
    return null;
  }

  try {
    // For now, we assume a simple format. In production, verify JWT properly.
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return null;
    }

    const token = parts[1];
    
    // Decode JWT without verification (in production, verify the signature)
    const parts_jwt = token.split(".");
    if (parts_jwt.length !== 3) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(parts_jwt[1], "base64").toString("utf-8")
    );

    return {
      id: payload.sub || payload.id,
      email: payload.email,
      name: payload.name,
      role: payload.role || "Read Only",
      status: payload.status || "Active"
    };
  } catch (error) {
    return null;
  }
}

/**
 * Extract user from Vercel request object
 */
export function extractUserFromRequest(req: any): AuthenticatedUser | null {
  const authHeader = req.headers?.authorization;
  return extractUserFromHeaders(authHeader);
}
