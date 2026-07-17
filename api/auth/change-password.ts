/**
 * POST /api/auth/change-password — signed-in user changes their own password
 * (verifies the current password first). Replaces the legacy
 * change-admin-password action case.
 */
import { getTokens, verifyAccessToken } from "../_lib/session.js";
import { userClient, adminClient } from "../../lib/data/supabase/client.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof newPassword !== "string" || newPassword.length < 10) {
    return res.status(400).json({ error: "New password must be at least 10 characters" });
  }

  const { access } = getTokens(req);
  const user = access ? await verifyAccessToken(access) : null;
  if (!user?.email) return res.status(401).json({ error: "Authentication required" });

  // Verify the current password by attempting a sign-in.
  const probe = await userClient("").auth.signInWithPassword({ email: user.email, password: String(currentPassword ?? "") });
  if (probe.error) return res.status(401).json({ error: "Current password is incorrect" });

  const { error } = await adminClient().auth.admin.updateUserById(user.id, { password: newPassword });
  if (error) return res.status(500).json({ error: `Password change failed: ${error.message}` });
  return res.status(200).json({ success: true });
}
