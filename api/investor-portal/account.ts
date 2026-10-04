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
 *   accept_terms — records the terms version and when they accepted it;
 *   sign_agreement — signs the Investors Agreement (lib/core/investor-
 *                  agreement.ts). Refused until the partner has chosen their
 *                  own password, so the signature comes from a credential only
 *                  they know, never the one we emailed. Signing also accepts
 *                  the portal terms.
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
import { requestOrigin, sha256, signaturesFor } from "../_lib/agreements.js";
import {
  INVESTORS_AGREEMENT,
  agreementRequired,
  agreementText,
  cleanSignature,
  investorsAgreement,
} from "../../lib/core/investor-agreement.js";
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
  z.object({
    action: z.literal("sign_agreement"),
    version: z.number().int().positive(),
    /** The day the agreement is dated, as the partner's screen showed it. */
    agreement_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    entity: z.string().trim().max(200).nullable(),
    address: z.string().trim().min(5, "Enter your address").max(500),
    pledge_pence: z.number().int().positive("Enter your pledge amount").max(10_000_000_000),
    signed_name: z.string().trim().min(2, "Type your full name to sign").max(200),
    /** SHA-256 of the text the partner was shown. */
    text_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    accept_risk: z.literal(true),
  }),
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
          "id, name, email, entity, address, pledge_pence, is_test, status, certification_status, certification_date, " +
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
        entity: string | null;
        address: string | null;
        pledge_pence: number | null;
        is_test: boolean;
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

      const [{ data: settings }, signatures] = await Promise.all([
        db.from("portal_settings").select("terms_version").eq("id", true).maybeSingle(),
        signaturesFor(row.id),
      ]);
      const signedCurrent = signatures.find((s) => s.version === INVESTORS_AGREEMENT.version);

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
        agreement: {
          title: INVESTORS_AGREEMENT.title,
          version: INVESTORS_AGREEMENT.version,
          draft: INVESTORS_AGREEMENT.status === "draft",
          // A bought-back partner keeps read-only access without re-signing.
          required: agreementRequired(Boolean(row.is_test)) && loginMode !== "read_only",
          signed_at: signedCurrent?.signed_at ?? null,
          countersigned_at: signedCurrent?.countersigned_at ?? null,
          /** Every version they have signed, for the signed copies on the Account page. */
          signed_versions: signatures.map((s) => ({ version: s.version, signed_at: s.signed_at, draft: s.draft })),
          // What the agreement is made out to; the partner confirms these.
          details: {
            name: row.name,
            entity: row.entity ?? null,
            address: row.address ?? null,
            pledge_pence: row.pledge_pence !== null && row.pledge_pence !== undefined ? Number(row.pledge_pence) : null,
          },
        },
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

    if (input.action === "sign_agreement") {
      return signAgreement(req, user.id, map.investor_id, input);
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

type SignInput = Extract<z.infer<typeof bodySchema>, { action: "sign_agreement" }>;

/**
 * Record a signature of the Investors Agreement in force.
 *
 * The text is rebuilt here from the submitted details and must hash to what the
 * partner's screen showed. A mismatch means the agreement or the details moved
 * under them, and they are asked to reload rather than sign something else.
 */
async function signAgreement(req: any, authUid: string, investorId: string, input: SignInput) {
  const db = adminClient();
  if (input.version !== INVESTORS_AGREEMENT.version) {
    throw new BadRequestError("The agreement has been updated since this page loaded. Reload to read the current version.");
  }

  // A signature must come from a password only the partner knows.
  const authUser = await db.auth.admin.getUserById(authUid);
  const appMeta = authUser?.data?.user?.app_metadata ?? {};
  if (appMeta.must_change_password || withinRecoveryWindow(appMeta.password_recovery_at)) {
    throw new BadRequestError("Choose your own password before signing.");
  }

  // The agreement is dated the day it is signed. Allow for a partner signing
  // around midnight in another time zone.
  const day = new Date(`${input.agreement_date}T12:00:00Z`).getTime();
  if (Number.isNaN(day) || Math.abs(day - Date.now()) > 36 * 3600 * 1000) {
    throw new BadRequestError("The agreement date is out of date. Reload the page and sign again.");
  }

  const { data: inv, error: invErr } = await db
    .from("investors")
    .select("id, name")
    .eq("id", investorId)
    .is("deleted_at", null)
    .maybeSingle();
  if (invErr) throw new InternalError(`investors: ${invErr.message}`);
  if (!inv) throw new UnauthorizedError();

  const entity = input.entity && input.entity.trim() ? input.entity.trim() : null;
  const address = input.address.trim();
  const body = agreementText(
    investorsAgreement({ name: inv.name, entity, address, pledgePence: input.pledge_pence, date: input.agreement_date }),
  );
  const hash = sha256(body);
  if (hash !== input.text_sha256) {
    throw new BadRequestError("The agreement text changed while you were reading it. Reload the page and sign again.");
  }

  const { ip, userAgent } = requestOrigin(req);
  const { error } = await db.from("investor_agreement_signatures").insert({
    investor_id: investorId,
    agreement_key: INVESTORS_AGREEMENT.key,
    version: INVESTORS_AGREEMENT.version,
    draft: INVESTORS_AGREEMENT.status === "draft",
    agreement_date: input.agreement_date,
    body,
    text_sha256: hash,
    signed_name: cleanSignature(input.signed_name),
    signer_entity: entity,
    signer_address: address,
    pledge_pence: input.pledge_pence,
    ip,
    user_agent: userAgent,
  });
  // Signed already (a double click, or a second tab): that is success.
  if (error && !/duplicate key/i.test(error.message)) {
    throw new InternalError(`Could not record the signature: ${error.message}`);
  }

  // The record follows what the partner confirmed, so the next version is
  // made out correctly without asking staff.
  await db.from("investors").update({ entity, address, pledge_pence: input.pledge_pence }).eq("id", investorId);

  // Signing carries the risk statement the separate terms step used to.
  const { data: settings } = await db.from("portal_settings").select("terms_version").eq("id", true).maybeSingle();
  await db
    .from("investor_auth_map")
    .update({ terms_version: settings?.terms_version ?? 1, terms_accepted_at: new Date().toISOString() })
    .eq("investor_id", investorId);

  if (!error) await logActivity(investorId, null, "agreement_signed", { version: INVESTORS_AGREEMENT.version });
  return { ok: true, version: INVESTORS_AGREEMENT.version };
}
