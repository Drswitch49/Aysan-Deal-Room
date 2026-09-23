/**
 * /api/investor-portal/account — the partner's own account.
 *
 * GET returns their details (read only: changes go through partnerships@, which
 * keeps the AML record clean), their certification date and whether the portal
 * is still waiting on a password change or the terms.
 *
 * POST handles the two things a partner may do to their own account:
 *   set_password — replaces the temporary password issued with their invite,
 *                  clears the must-change flag and moves login_mode to full;
 *   accept_terms — records the terms version and when they accepted it.
 *
 * Both re-read the session rather than trusting anything in the body, and
 * set_password verifies the current password by signing in with it, so a
 * hijacked tab cannot change the password without knowing it.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { BadRequestError, InternalError, UnauthorizedError } from "../../lib/core/errors.js";
import { adminClient, userClient } from "../../lib/data/supabase/client.js";
import { isCertifiedNow, logAccess } from "../_lib/investor-context.js";
import { logActivity } from "../_lib/investor-access.js";
import { getTokens, invalidateAccessToken, setSessionCookies } from "../_lib/session.js";

/**
 * Re-establish the browser session after a password change.
 *
 * Changing a password through the admin API revokes the user's existing
 * sessions, so the cookies the browser is holding die the moment the change
 * lands. The portal keeps rendering because verifyAccessToken caches a verified
 * user for 30 seconds — then every read starts coming back "Authentication
 * required" on what still looks like a signed-in portal. Signing in again with
 * the new password and re-issuing the cookies closes that window; dropping the
 * old token from the cache stops it being served inside it.
 *
 * Best effort: a partner who has just set a password should not be told the
 * change failed because only the re-issue did. They land on the sign-in screen,
 * which their new password opens.
 */
async function reissueSession(req: any, res: any, email: string, password: string): Promise<void> {
  const { access } = getTokens(req);
  if (access) invalidateAccessToken(access);
  const { data, error } = await userClient("").auth.signInWithPassword({ email, password });
  if (error || !data.session) return;
  setSessionCookies(res, {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
  });
}

/** The Build Pack's floor for a partner password. */
const MIN_PASSWORD_LENGTH = 12;

/**
 * How long a redeemed recovery link stays good for one password change.
 * Short, because within this window the current password is not asked for.
 */
const RECOVERY_WINDOW_MS = 15 * 60 * 1000;

const newPassword = z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`);

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_password"),
    current_password: z.string().min(1, "Enter the password you signed in with"),
    new_password: newPassword,
  }),
  // No current password: the authority is the recovery stamp written by
  // /api/auth/callback when the emailed link was redeemed.
  z.object({ action: z.literal("reset_password"), new_password: newPassword }),
  z.object({ action: z.literal("accept_terms"), terms_version: z.number().int().positive() }),
]);

export default createHandler({
  methods: ["GET", "POST"],
  requireAuth: true,
  handle: async ({ req, res, body, user }) => {
    const db = adminClient();

    if (req.method === "GET") {
      if (!user?.id) throw new UnauthorizedError();

      // This one endpoint does NOT go through resolveInvestorScope. That gate
      // refuses a login_mode of `pending`, which is precisely the state a
      // partner is in when they first sign in with the password we emailed —
      // and this is the screen that tells them to change it. Going through the
      // gate here would lock every new partner out of their own onboarding.
      // Everything that returns holdings still goes through the gate.
      // `!inner` makes supabase-js give up on inferring the row shape, so it
      // is read through a narrow local type rather than fighting the generic.
      const { data: rowData, error } = await db
        .from("investors")
        .select(
          "id, name, email, status, certification_status, certification_date, " +
            "investor_auth_map!inner(login_mode, read_only_until, terms_version, terms_accepted_at, auth_uid)",
        )
        .eq("investor_auth_map.auth_uid", user.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new InternalError(`investors: ${error.message}`);
      if (!rowData) throw new UnauthorizedError();
      const row = rowData as unknown as {
        id: string;
        name: string;
        email: string;
        status: string;
        certification_status: string;
        certification_date: string | null;
        investor_auth_map: unknown;
      };

      const rawMap = row.investor_auth_map as any;
      const map = Array.isArray(rawMap) ? rawMap[0] : rawMap;
      const loginMode = String(map?.login_mode ?? "none");

      // A partner whose access has been withdrawn gets nothing here either.
      if (["revoked", "none"].includes(loginMode) || ["passed", "ended"].includes(String(row.status))) {
        throw new UnauthorizedError();
      }

      const authUser = await db.auth.admin.getUserById(user.id);
      const appMeta = authUser?.data?.user?.app_metadata ?? {};
      const recoveryPending = withinRecoveryWindow(appMeta.password_recovery_at);

      const { data: settings } = await db
        .from("portal_settings")
        .select("terms_version")
        .eq("id", true)
        .maybeSingle();

      return {
        name: row.name,
        email: row.email,
        certification_status: row.certification_status,
        certification_date: row.certification_date,
        certified_now: isCertifiedNow(row.certification_status, row.certification_date),
        read_only: loginMode === "read_only",
        read_only_until: map?.read_only_until ?? null,
        must_change_password: Boolean(appMeta.must_change_password) || recoveryPending,
        /** True while a redeemed reset link still allows a change with no current password. */
        recovery_pending: recoveryPending,
        terms_version: map?.terms_version ?? null,
        terms_accepted_at: map?.terms_accepted_at ?? null,
        current_terms_version: settings?.terms_version ?? 1,
      };
    }

    // ── POST ──
    if (!user?.id || !user.email) throw new UnauthorizedError();
    const input = bodySchema.parse(body ?? {});

    // Onboarding runs before login_mode reaches full, so these two actions
    // resolve the partner from the auth mapping directly rather than through
    // resolveInvestorScope, which would refuse a pending login.
    const { data: map } = await db
      .from("investor_auth_map")
      .select("investor_id, login_mode")
      .eq("auth_uid", user.id)
      .maybeSingle();
    if (!map) throw new UnauthorizedError();

    if (input.action === "set_password") {
      if (input.new_password === input.current_password) {
        throw new BadRequestError("Choose a password different from the one we sent you.");
      }

      const probe = await userClient("").auth.signInWithPassword({
        email: user.email,
        password: input.current_password,
      });
      if (probe.error) throw new BadRequestError("That current password is not right.");

      const { error } = await db.auth.admin.updateUserById(user.id, {
        password: input.new_password,
        app_metadata: { role: "investor", investor_id: map.investor_id, must_change_password: false },
      });
      if (error) throw new InternalError(`Password change failed: ${error.message}`);
      await reissueSession(req, res, user.email, input.new_password);

      const patch: Record<string, unknown> = { last_login_at: new Date().toISOString() };
      if (map.login_mode === "pending") {
        patch.login_mode = "full";
        patch.first_login_at = new Date().toISOString();
      }
      await db.from("investor_auth_map").update(patch).eq("investor_id", map.investor_id);

      if (map.login_mode === "pending") {
        await db.from("investors").update({ status: "active" }).eq("id", map.investor_id);
        await db
          .from("portal_invites")
          .update({ status: "accepted", accepted_at: new Date().toISOString() })
          .eq("investor_id", map.investor_id)
          .eq("status", "active");
        await logActivity(map.investor_id, null, "access_activated", {});
      }
      await logAccess("login", { investorId: map.investor_id, authUid: user.id, req });

      return { ok: true, login_mode: patch.login_mode ?? map.login_mode };
    }

    if (input.action === "reset_password") {
      // The authority is the stamp, not the request. Re-read it from the auth
      // user every time and clear it on use, so one redeemed link buys exactly
      // one password change inside one short window.
      const authUser = await db.auth.admin.getUserById(user.id);
      const appMeta = authUser?.data?.user?.app_metadata ?? {};
      if (!withinRecoveryWindow(appMeta.password_recovery_at)) {
        throw new BadRequestError("That reset link has expired. Request a new one.");
      }

      const { error } = await db.auth.admin.updateUserById(user.id, {
        password: input.new_password,
        app_metadata: {
          ...appMeta,
          must_change_password: false,
          password_recovery_at: null,
        },
      });
      if (error) throw new InternalError(`Password reset failed: ${error.message}`);
      await reissueSession(req, res, user.email, input.new_password);

      const patch: Record<string, unknown> = { last_login_at: new Date().toISOString() };
      if (map.login_mode === "pending") {
        patch.login_mode = "full";
        patch.first_login_at = new Date().toISOString();
      }
      await db.from("investor_auth_map").update(patch).eq("investor_id", map.investor_id);
      await logAccess("login", { investorId: map.investor_id, authUid: user.id, req });

      return { ok: true, login_mode: patch.login_mode ?? map.login_mode };
    }

    // accept_terms
    const { error } = await db
      .from("investor_auth_map")
      .update({ terms_version: input.terms_version, terms_accepted_at: new Date().toISOString() })
      .eq("investor_id", map.investor_id);
    if (error) throw new InternalError(`Could not record the terms: ${error.message}`);

    return { ok: true, terms_version: input.terms_version };
  },
});

/** Was a recovery link redeemed recently enough to skip the current password? */
function withinRecoveryWindow(stamp: unknown): boolean {
  if (typeof stamp !== "string" || !stamp) return false;
  const at = new Date(stamp).getTime();
  if (Number.isNaN(at)) return false;
  return Date.now() - at < RECOVERY_WINDOW_MS;
}
