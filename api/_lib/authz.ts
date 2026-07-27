/**
 * Authorization context (Phase 4 — Supabase-backed, default-deny).
 *
 * Verifies the Supabase access token (httpOnly cookie or Authorization: Bearer)
 * directly in the handler layer — no reliance on edge-middleware headers, so an
 * unlisted route can never slip through unguarded. Role comes from the auth
 * user's server-controlled app_metadata (set at import/invite time).
 */
import { getTokens, verifyAccessToken } from "./session.js";

export interface UserContext {
  id: string | null;
  email: string | null;
  role: string;
  /** Display name (from the auth user's full_name), when available. */
  name?: string | null;
  /** Set for lender portal accounts (app_metadata.lender_id). */
  lenderId?: string | null;
  /** Set for shareholder portal accounts (app_metadata.shareholder_id). */
  shareholderId?: string | null;
}

/** Returns the authenticated user context, or null if unauthenticated. */
export async function getUserContext(req: any): Promise<UserContext | null> {
  const { access } = getTokens(req);
  if (!access) return null;
  const user = await verifyAccessToken(access);
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.fullName,
    lenderId: user.lenderId,
    shareholderId: user.shareholderId,
  };
}

/** Best-effort display name for stamping authorship: full name → email local-part. */
export function displayName(user: UserContext | null): string {
  if (!user) return "Team";
  if (user.name && user.name.trim()) return user.name.trim();
  if (user.email) return user.email.split("@")[0];
  return "Team";
}

// Role groupings for route authorization (normalized enum from Phase 1 schema).
export const ALL_STAFF = ["owner", "managing_partner", "partner", "analyst", "hr", "admin", "read_only"];
export const ALL_ADMINS = ["owner", "managing_partner", "partner", "admin"];
export const WRITERS = ["owner", "managing_partner", "partner", "analyst", "admin"];
// People/registry management (HR & Stakeholders page): full-access staff + HR,
// whose whole remit is the team roster and stakeholder/shareholder registry.
export const PEOPLE_MANAGERS = ["owner", "managing_partner", "partner", "admin", "hr"];
export const PORTAL_ROLES = ["lender", "shareholder", "stakeholder"];
