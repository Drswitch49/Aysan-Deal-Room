/**
 * POST /api/auth/logout — revoke the Supabase session and clear cookies (Phase 4).
 */
import { adminClient } from "../../lib/data/supabase/client.js";
import { getTokens, clearSessionCookies } from "../_lib/session.js";

export default async function handler(req: any, res: any) {
  const { access } = getTokens(req);
  if (access) {
    // Best-effort server-side revocation; cookies are cleared regardless.
    await adminClient().auth.admin.signOut(access).catch(() => undefined);
  }
  clearSessionCookies(res);
  return res.status(200).json({ success: true, message: "Logged out successfully" });
}
