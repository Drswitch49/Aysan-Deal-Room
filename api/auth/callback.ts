/**
 * GET /api/auth/callback?token=…&type=magiclink — redeem a provisioned login link.
 *
 * The link handed out by /api/auth/provision points here rather than at
 * Supabase's own verify endpoint: exchanging the token server-side means the
 * session lands in httpOnly cookies (same as password login) instead of a URL
 * fragment the browser keeps in history. Tokens are single-use and expire.
 *
 * Public by design — the person redeeming it has no session yet.
 */
import { userClient } from "../../lib/data/supabase/client.js";
import { setSessionCookies } from "../_lib/session.js";
import { logger } from "../../lib/core/logger.js";

const LANDING_BY_ROLE: Record<string, string> = {
  shareholder: "/shareholders/portal",
};

function redirect(res: any, location: string): void {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const pick = (v: unknown) => (Array.isArray(v) ? v[0] : typeof v === "string" ? v : "");
  const token = pick(req.query?.token);
  const type = pick(req.query?.type) || "magiclink";
  if (!token) return redirect(res, "/?auth_error=missing_token");

  try {
    const { data, error } = await userClient("").auth.verifyOtp({
      token_hash: token,
      type: type === "recovery" ? "recovery" : "magiclink",
    });
    if (error || !data.session || !data.user) {
      // Expired, already used, or tampered with — send them to the sign-in screen.
      return redirect(res, "/?auth_error=link_expired");
    }

    setSessionCookies(res, {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
    });

    const role = typeof data.user.app_metadata?.role === "string" ? data.user.app_metadata.role : "";
    return redirect(res, LANDING_BY_ROLE[role] ?? "/");
  } catch (err) {
    logger.error({ err }, "login link redemption failed");
    return redirect(res, "/?auth_error=link_failed");
  }
}
