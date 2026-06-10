import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = process.env.JWT_SECRET || "acp-deal-os-jwt-secret-key-2026-super-secure-hash";
const secretKey = new TextEncoder().encode(JWT_SECRET);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect API routes
  if (pathname.startsWith("/api/")) {
    // Exclude public API routes (login, logout, session check, health, and initial slug authentication handlers)
    if (
      pathname.startsWith("/api/auth/login") ||
      pathname.startsWith("/api/auth/logout") ||
      pathname.startsWith("/api/auth/session") ||
      pathname.startsWith("/api/lender/auth") ||
      pathname.startsWith("/api/health") ||
      pathname === "/api/auth"
    ) {
      return NextResponse.next();
    }

    const sessionCookie = request.cookies.get("acp_session");
    if (!sessionCookie) {
      return new NextResponse(
        JSON.stringify({ error: "Unauthorized: Missing session token" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      const { payload } = await jwtVerify(sessionCookie.value, secretKey);
      const role = payload.role;

      // 1. Admin/Analyst-only endpoints
      if (
        pathname.startsWith("/api/admin/") ||
        pathname.startsWith("/api/deals") ||
        pathname.startsWith("/api/lenders")
      ) {
        if (role !== "admin" && role !== "analyst") {
          return new NextResponse(
            JSON.stringify({ error: "Forbidden: Access restricted to admins and analysts" }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      // 2. Lender-accessible endpoints
      if (pathname.startsWith("/api/lender/")) {
        if (role !== "admin" && role !== "analyst" && role !== "lender") {
          return new NextResponse(
            JSON.stringify({ error: "Forbidden: Access restricted" }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      // 3. Document operations
      if (pathname.startsWith("/api/documents/")) {
        if (role !== "admin" && role !== "analyst" && role !== "lender") {
          return new NextResponse(
            JSON.stringify({ error: "Forbidden: Access restricted" }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      // Pass user payload in custom headers to downstream handlers
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-user-email", String(payload.email || ""));
      requestHeaders.set("x-user-role", String(payload.role || ""));
      requestHeaders.set("x-user-id", String(payload.id || ""));

      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });

    } catch (err) {
      return new NextResponse(
        JSON.stringify({ error: "Unauthorized: Invalid or expired session token" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
