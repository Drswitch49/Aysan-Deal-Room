/**
 * POST /api/auth/login — Supabase Auth sign-in (Phase 4).
 *
 * Verifies credentials against Supabase Auth (legacy bcrypt hashes were imported,
 * so existing passwords keep working) and sets httpOnly session cookies.
 * Replaces the legacy Airtable-Users + custom-JWT login; rate limiting is
 * enforced by Supabase Auth (the old in-memory Map was ineffective on serverless).
 *
 * NOTE: returns the legacy FLAT response shape ({ success, user }) the frontend
 * expects — auth endpoints are intentionally not wrapped by createHandler.
 */
import { userClient } from "../../lib/data/supabase/client.js";
import { setSessionCookies } from "../_lib/session.js";
import { resolveDisplayName } from "../_lib/display-name.js";
import { logger } from "../../lib/core/logger.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const client = userClient(""); // anon client
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    setSessionCookies(res, {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
    });

    const app = data.user.app_metadata ?? {};
    const meta = data.user.user_metadata ?? {};
    const role = typeof app.role === "string" ? app.role : "read_only";
    return res.status(200).json({
      success: true,
      authenticated: true,
      user: {
        id: data.user.id,
        email: data.user.email,
        role,
        // Same resolution as /api/auth/session, so the name shown right after
        // sign-in matches the one shown on every later page load.
        name: await resolveDisplayName({
          id: data.user.id,
          email: data.user.email ?? null,
          role,
          lenderId: null,
          shareholderId: null,
          fullName:
            (typeof meta.full_name === "string" && meta.full_name) ||
            (typeof meta.contact_name === "string" && meta.contact_name) ||
            null,
        }),
      },
    });
  } catch (err) {
    logger.error({ err }, "login failed");
    return res.status(500).json({ error: "Authentication service is temporarily unavailable." });
  }
}
