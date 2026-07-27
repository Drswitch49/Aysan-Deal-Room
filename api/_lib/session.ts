/**
 * Supabase session management via httpOnly cookies (Phase 4).
 *
 * The browser never sees tokens (XSS-safe): login sets httpOnly cookies, every
 * API call verifies the access token server-side, and /api/auth/session
 * transparently refreshes an expired access token using the refresh cookie.
 * Replaces the legacy custom-JWT `acp_session` cookie.
 */
import { serialize, parse } from "cookie";
import { userClient, adminClient } from "../../lib/data/supabase/client.js";
import { getServerEnv } from "../../lib/core/env.js";

export const ACCESS_COOKIE = "sb_access";
export const REFRESH_COOKIE = "sb_refresh";

const isProd = () => getServerEnv().NODE_ENV === "production";

function cookie(name: string, value: string, maxAge: number): string {
  return serialize(name, value, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export function setSessionCookies(res: any, tokens: SessionTokens): void {
  res.setHeader("Set-Cookie", [
    cookie(ACCESS_COOKIE, tokens.access_token, tokens.expires_in ?? 3600),
    cookie(REFRESH_COOKIE, tokens.refresh_token, 60 * 60 * 24 * 30), // 30 days
  ]);
}

export function clearSessionCookies(res: any): void {
  res.setHeader("Set-Cookie", [cookie(ACCESS_COOKIE, "", -1), cookie(REFRESH_COOKIE, "", -1)]);
}

export function getTokens(req: any): { access: string | null; refresh: string | null } {
  // Prefer Authorization: Bearer (API clients), else cookies (browser).
  const auth = req.headers?.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return { access: auth.slice(7), refresh: null };
  }
  const cookies = parse(req.headers?.cookie || "");
  return { access: cookies[ACCESS_COOKIE] ?? null, refresh: cookies[REFRESH_COOKIE] ?? null };
}

export interface SessionUser {
  id: string;
  email: string | null;
  role: string;
  lenderId: string | null;
  shareholderId: string | null;
  fullName: string | null;
}

function toSessionUser(u: {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}): SessionUser {
  const app = u.app_metadata ?? {};
  const meta = u.user_metadata ?? {};
  return {
    id: u.id,
    email: u.email ?? null,
    role: typeof app.role === "string" ? app.role : "read_only",
    lenderId: typeof app.lender_id === "string" ? app.lender_id : null,
    shareholderId: typeof app.shareholder_id === "string" ? app.shareholder_id : null,
    fullName:
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.contact_name === "string" && meta.contact_name) ||
      null,
  };
}

// Tiny TTL cache so hot request bursts don't re-verify the same token.
const cache = new Map<string, { user: SessionUser; until: number }>();
const CACHE_TTL_MS = 30_000;

/** Verify an access token with Supabase and return the session user, or null. */
export async function verifyAccessToken(access: string): Promise<SessionUser | null> {
  const hit = cache.get(access);
  if (hit && hit.until > Date.now()) return hit.user;

  const { data, error } = await adminClient().auth.getUser(access);
  if (error || !data.user) return null;
  const user = toSessionUser(data.user);
  cache.set(access, { user, until: Date.now() + CACHE_TTL_MS });
  if (cache.size > 500) cache.clear(); // crude bound
  return user;
}

/** Exchange a refresh token for a fresh session (used by /api/auth/session). */
export async function refreshSession(refresh: string): Promise<{ user: SessionUser; tokens: SessionTokens } | null> {
  const env = getServerEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const client = userClient(""); // anon client; refresh doesn't need an access token
  const { data, error } = await client.auth.refreshSession({ refresh_token: refresh });
  if (error || !data.session || !data.user) return null;
  return {
    user: toSessionUser(data.user),
    tokens: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
    },
  };
}
