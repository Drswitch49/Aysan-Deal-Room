/**
 * POST /api/lender/auth — lender portal login (Phase 6, Supabase-backed).
 *
 * Keeps the portal's slug+password contract: the slug (from the portal URL)
 * resolves the lender's email, and the password is their real Supabase Auth
 * password (issued at provisioning / reset). Sets the same httpOnly session
 * cookies as staff login; role comes from app_metadata (role: "lender").
 */
import { repositories } from "../../lib/data/supabase/repositories.js";
import { userClient } from "../../lib/data/supabase/client.js";
import { setSessionCookies } from "../_lib/session.js";
import { logger } from "../../lib/core/logger.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { portalSlug, password, email } = req.body ?? {};
  if ((!portalSlug && !email) || typeof password !== "string" || !password) {
    return res.status(400).json({ error: "Portal reference and password are required" });
  }

  try {
    let loginEmail: string | null = typeof email === "string" && email ? email : null;
    let lender: any = null;

    if (portalSlug) {
      const page = await repositories.lenders.list({ portal_slug: portalSlug, limit: 1 });
      lender = page.rows[0] ?? null;
      if (!lender?.email) return res.status(401).json({ error: "Incorrect portal credentials" });
      loginEmail = lender.email;
    }

    const { data, error } = await userClient("").auth.signInWithPassword({
      email: loginEmail!,
      password,
    });
    if (error || !data.session || !data.user) {
      return res.status(401).json({ error: "Incorrect portal credentials" });
    }
    if ((data.user.app_metadata?.role ?? "") !== "lender") {
      return res.status(403).json({ error: "This login is for lender portal accounts" });
    }

    setSessionCookies(res, {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
    });

    if (!lender) {
      const lenderId = data.user.app_metadata?.lender_id;
      lender = lenderId ? await repositories.lenders.findById(lenderId) : null;
    }

    return res.status(200).json({
      success: true,
      authenticated: true,
      lender: lender
        ? {
            id: lender.id,
            Company_Name: lender.company_name,
            Contact_Name: lender.contact_name,
            Email: lender.email,
            Portal_Slug: lender.portal_slug,
            NDA_Approved: Boolean(lender.nda_approved),
          }
        : null,
    });
  } catch (err) {
    logger.error({ err }, "lender auth failed");
    return res.status(500).json({ error: "Login service temporarily unavailable" });
  }
}
