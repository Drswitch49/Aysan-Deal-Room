/**
 * Authorization context extraction (default-deny at the handler level).
 *
 * PHASE 3: reads the identity headers the edge middleware forwards
 * (x-user-email / x-user-role / x-user-id) after it verifies the legacy session.
 * PHASE 4: this module is rewritten to verify a Supabase session/JWT directly and
 * derive the role from the `profiles` table / JWT claim. The exported interface
 * (`getUserContext`, `UserContext`) stays stable so handlers don't change.
 */

export interface UserContext {
  id: string | null;
  email: string | null;
  role: string;
}

function headerValue(req: any, name: string): string | null {
  const v = req.headers?.[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === "string" ? v : null;
}

/** Returns the authenticated user context, or null if unauthenticated. */
export function getUserContext(req: any): UserContext | null {
  const email = headerValue(req, "x-user-email");
  const role = headerValue(req, "x-user-role");
  const id = headerValue(req, "x-user-id");
  if (!email && !id) return null;
  return { id, email, role: (role ?? "").toLowerCase() || "read_only" };
}

// Role groupings for route authorization.
export const ALL_STAFF = ["owner", "managing_partner", "partner", "analyst", "hr", "admin", "read_only"];
export const ALL_ADMINS = ["owner", "managing_partner", "partner", "admin"];
export const WRITERS = ["owner", "managing_partner", "partner", "analyst", "admin"];
