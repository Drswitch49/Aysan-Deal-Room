import { next } from "@vercel/edge";
import { jwtVerify } from "jose";
import { validateEnv } from "./api/_utils/bootstrap.js";

// Validate environment variables at boot time
validateEnv();

const JWT_SECRET = process.env.JWT_SECRET!;
const secretKey = new TextEncoder().encode(JWT_SECRET);

export async function middleware(request: Request) {
  const url = new URL(request.url);
  const { pathname } = url;

  // Protect API routes
  if (pathname.startsWith("/api/")) {
    // Exclude public API routes (login, logout, session check, health, inngest, and initial slug authentication handlers)
    if (
      pathname.startsWith("/api/auth/login") ||
      pathname.startsWith("/api/auth/logout") ||
      pathname.startsWith("/api/auth/session") ||
      pathname.startsWith("/api/lender/auth") ||
      pathname.startsWith("/api/health") ||
      pathname.startsWith("/api/inngest") ||
      pathname === "/api/auth"
    ) {
      return next();
    }

    const cookiesHeader = request.headers.get("cookie") || "";
    const cookies = Object.fromEntries(
      cookiesHeader.split(";").map((c) => {
        const parts = c.trim().split("=");
        return [parts[0], parts.slice(1).join("=")];
      })
    );
    const sessionCookie = cookies["acp_session"];

    if (!sessionCookie) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Missing session token" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      const { payload } = await jwtVerify(sessionCookie, secretKey);
      const role = (payload.role as string || "").toLowerCase();

      // 0. HR / Stakeholder registry management endpoints
      if (
        pathname.startsWith("/api/team-members-crud") ||
        pathname.startsWith("/api/stakeholders-crud") ||
        pathname.startsWith("/api/admin/hr")
      ) {
        const hrRoles = ["admin", "managing partner", "partner", "hr", "super admin", "owner"];
        if (!hrRoles.includes(role)) {
          return new Response(
            JSON.stringify({ error: "Forbidden: Access restricted to HR and administrative staff" }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      // 1. Deals & Documents endpoints (Stakeholders can read, HR cannot access at all)
      else if (
        pathname.startsWith("/api/deals") ||
        pathname.startsWith("/api/documents/")
      ) {
        const dealRoles = ["admin", "analyst", "managing partner", "partner", "stakeholder", "read only", "super admin", "owner"];
        if (!dealRoles.includes(role)) {
          return new Response(
            JSON.stringify({ error: "Forbidden: Access restricted to active deals" }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      // 2. Lenders & Admin endpoints (excluding HR-specific paths)
      else if (
        pathname.startsWith("/api/lenders") ||
        pathname.startsWith("/api/admin/")
      ) {
        const adminRoles = ["admin", "analyst", "managing partner", "partner", "super admin", "owner"];
        if (!adminRoles.includes(role)) {
          return new Response(
            JSON.stringify({ error: "Forbidden: Access restricted to administrative staff" }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      // 3. Lender-specific sandbox endpoints
      else if (pathname.startsWith("/api/lender/")) {
        const lenderRoles = ["admin", "analyst", "managing partner", "partner", "lender", "super admin", "owner"];
        if (!lenderRoles.includes(role)) {
          return new Response(
            JSON.stringify({ error: "Forbidden: Access restricted to lender sandbox" }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      // Pass user payload in custom headers to downstream handlers
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-user-email", String(payload.email || ""));
      requestHeaders.set("x-user-role", String(payload.role || ""));
      requestHeaders.set("x-user-id", String(payload.id || ""));

      return next({
        request: {
          headers: requestHeaders,
        },
      });

    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid or expired session token" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return next();
}

export const config = {
  matcher: ["/api/:path*"],
};

export default middleware;
