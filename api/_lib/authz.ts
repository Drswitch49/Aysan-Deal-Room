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
  /** Set for capital partner portal accounts (app_metadata.investor_id). */
  investorId?: string | null;
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
    investorId: user.investorId,
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
export const ALL_STAFF = ["owner", "managing_partner", "partner", "analyst", "hr", "admin", "cfo", "read_only"];
export const ALL_ADMINS = ["owner", "managing_partner", "partner", "admin", "cfo"];
export const WRITERS = ["owner", "managing_partner", "partner", "analyst", "admin", "cfo"];
// People/registry management (HR & Stakeholders page): full-access staff + HR,
// whose whole remit is the team roster and stakeholder/shareholder registry.
export const PEOPLE_MANAGERS = ["owner", "managing_partner", "partner", "admin", "cfo", "hr"];
export const PORTAL_ROLES = ["lender", "shareholder", "stakeholder", "investor"];

/**
 * Capital partner portal management (Build Pack Section 5). Creating investors,
 * recording certification, issuing invites, recording commitments and capital
 * transactions are admin/cfo only — HR and analysts are deliberately excluded
 * because these rows carry a regulated relationship, not roster housekeeping.
 */
export const PARTNER_MANAGERS = ["owner", "managing_partner", "partner", "admin", "cfo"];

/**
 * The Investors area — capital partners, external stakeholders, shareholders,
 * commitments, capital transactions and each deal's partner-facing settings —
 * is read AND written by these roles only (user's decision, 2026-09-24).
 * HR, analysts and read-only staff see none of it.
 */
export const INVESTOR_ROLES = PARTNER_MANAGERS;

/**
 * Permanently erasing a capital partner — record, money trail and audit
 * history — is narrower still. Postgres enforces the same list in
 * erase_investor(), so this check is for a readable refusal, not the gate.
 */
export const PARTNER_ERASERS = ["owner", "managing_partner", "admin"];

/**
 * Coverage status has one author (rule R4). This list is advisory only — the
 * refusal that matters is the `dscr_status_cfo_only` gate in Postgres, which
 * fires even if a route forgets to check. Ayo's admin login fails here by
 * design; that is acceptance Test 4.
 */
export const COVERAGE_AUTHORS = ["cfo"];
