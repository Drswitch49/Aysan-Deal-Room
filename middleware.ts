/**
 * Edge middleware (Phase 4 — thin gate).
 *
 * Authorization no longer lives here. The legacy version encoded RBAC as
 * pathname-prefix string matching — any route not matching a listed prefix got
 * NO role check. Now every handler verifies the Supabase session itself via
 * api/_lib/authz (default-deny), and this middleware is only defense-in-depth:
 * it rejects API requests that carry no session material at all (saves a
 * function invocation) and lets public auth/health routes through.
 */
import { next } from "@vercel/edge";

const PUBLIC_PREFIXES = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/session",
  "/api/lender/auth", // legacy lender slug login (removed in Phase 6)
  "/api/health",
  "/api/inngest", // legacy job system (removed in Phase 5)
];

export async function middleware(request: Request) {
  const { pathname } = new URL(request.url);

  if (!pathname.startsWith("/api/")) return next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) || pathname === "/api/auth") {
    return next();
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const hasSessionCookie = cookieHeader.includes("sb_access=") || cookieHeader.includes("sb_refresh=");
  const hasBearer = (request.headers.get("authorization") ?? "").startsWith("Bearer ");

  if (!hasSessionCookie && !hasBearer) {
    return new Response(
      JSON.stringify({ error: { code: "unauthorized", message: "Authentication required" } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  // Token verification + role checks happen in the handler layer (api/_lib).
  return next();
}

export const config = {
  matcher: ["/api/:path*"],
};

export default middleware;
