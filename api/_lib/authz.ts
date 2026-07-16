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
    lenderId: user.lenderId,
    shareholderId: user.shareholderId,
  };
}

// Role groupings for route authorization (normalized enum from Phase 1 schema).
export const ALL_STAFF = ["owner", "managing_partner", "partner", "analyst", "hr", "admin", "read_only"];
export const ALL_ADMINS = ["owner", "managing_partner", "partner", "admin"];
export const WRITERS = ["owner", "managing_partner", "partner", "analyst", "admin"];
export const PORTAL_ROLES = ["lender", "shareholder", "stakeholder"];
