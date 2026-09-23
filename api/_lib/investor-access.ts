/**
 * Capital partner records and portal access.
 *
 * The CRM's front door for a capital partner is the External Stakeholders
 * registry: an admin adds a stakeholder and picks type "Investor". That row
 * stays the thing the team edits; this module keeps a matching `investors` row
 * in step behind it, because the portal's commitments, capital transactions and
 * documents all hang off a stable investor id and must not move when somebody
 * renames a stakeholder card.
 *
 * Access follows the same shape as lender and shareholder provisioning
 * (api/_lib/account-provisioning.ts): a real Supabase Auth account, a
 * one-time temporary password, and a sign-in link. What is different, and what
 * the Build Pack insists on, is that issuing access is gated in Postgres on
 * live certification (rule R6) — `issue_portal_invite` refuses before any auth
 * account is touched, so an uncertified partner can never be sent a link even
 * if a UI check is missed or bypassed.
 */
import type { User } from "@supabase/supabase-js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { generatePassword } from "../../lib/core/secure-random.js";
import { queueEmail } from "../../lib/email/send.js";
import { getServerEnv } from "../../lib/core/env.js";
import { logger } from "../../lib/core/logger.js";
import { BadRequestError, ConflictError, InternalError, NotFoundError } from "../../lib/core/errors.js";
import { findAuthUserByEmail, originFrom } from "./account-provisioning.js";
import type { UserContext } from "./authz.js";

/** The stakeholder type that means "this person is a capital partner". */
export const INVESTOR_STAKEHOLDER_TYPE = "investor";

export const isInvestorType = (type: unknown): boolean =>
  String(type ?? "").trim().toLowerCase() === INVESTOR_STAKEHOLDER_TYPE;

/** Where a partner signs in. Configured absolutely, else derived per request. */
export function portalUrl(req?: any): string {
  const configured = getServerEnv().PORTAL_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return `${originFrom(req)}/investors/portal`;
}

// ─── Registry sync ─────────────────────────────────────────────────────────

interface StakeholderRow {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  type?: string | null;
  organization?: string | null;
  company?: string | null;
  notes?: string | null;
  status?: string | null;
}

/**
 * Create or update the investor record behind a stakeholder row.
 *
 * Returns null when the stakeholder is not an investor — including when its
 * type was changed away from Investor, in which case an existing investor row
 * is left exactly where it is. Deleting it would orphan commitments and
 * capital transactions that are a record of fact, so the row stays and the
 * admin ends the relationship explicitly.
 */
export async function syncInvestorFromStakeholder(
  row: StakeholderRow,
): Promise<{ id: string; created: boolean } | null> {
  if (!isInvestorType(row.type)) return null;

  const email = String(row.email ?? "").trim();
  if (!email) {
    // Not fatal: an investor can be recorded before their email is known, they
    // just cannot be issued access until it is.
    logger.warn({ stakeholderId: row.id }, "investor stakeholder has no email; investor record deferred");
    return null;
  }

  const db = adminClient();
  const { data: existing } = await db
    .from("investors")
    .select("id")
    .eq("stakeholder_id", row.id)
    .is("deleted_at", null)
    .maybeSingle();

  const patch = {
    stakeholder_id: row.id,
    name: String(row.name ?? "").trim() || email,
    email,
    phone: row.phone ?? null,
    entity: row.organization ?? row.company ?? null,
    notes: row.notes ?? null,
  };

  if (existing) {
    const { error } = await db.from("investors").update(patch).eq("id", existing.id);
    if (error) throw new InternalError(`Could not update the capital partner record: ${error.message}`);
    return { id: existing.id, created: false };
  }

  // An investor may already exist for this email from an earlier import; adopt
  // it rather than tripping the unique index with a duplicate.
  const { data: byEmail } = await db
    .from("investors")
    .select("id")
    .ilike("email", email)
    .is("deleted_at", null)
    .maybeSingle();
  if (byEmail) {
    const { error } = await db.from("investors").update(patch).eq("id", byEmail.id);
    if (error) throw new InternalError(`Could not link the capital partner record: ${error.message}`);
    return { id: byEmail.id, created: false };
  }

  const { data: created, error } = await db
    .from("investors")
    .insert({ ...patch, type: "prospective", status: "prospective" })
    .select("id")
    .single();
  if (error) throw new InternalError(`Could not create the capital partner record: ${error.message}`);

  const { error: mapErr } = await db
    .from("investor_auth_map")
    .insert({ investor_id: created.id, login_mode: "none" });
  if (mapErr) logger.error({ err: mapErr, investorId: created.id }, "investor_auth_map insert failed");

  return { id: created.id, created: true };
}

// ─── Portal access ─────────────────────────────────────────────────────────

export interface AccessGrant {
  investorId: string;
  email: string;
  name: string;
  /** Returned once, for the admin to see. Also emailed to the partner. */
  password: string;
  /** One-time sign-in link, valid for the invite's lifetime. */
  link: string;
  portalUrl: string;
  expiresAt: string;
  /** True when this call created the auth account rather than re-issuing. */
  created: boolean;
  /**
   * True while portal_settings.notify_only holds: the credentials email is
   * queued to the admin address, not to the partner, so the admin still has to
   * hand the details over. The UI must say so rather than implying it sent.
   */
  notifyOnly: boolean;
}

/**
 * Issue (or re-issue) portal access to a capital partner.
 *
 * Order matters. The invite row goes in FIRST so the Postgres gate decides:
 * uncertified, certification over twelve months old, or a caller who is not
 * admin/cfo all raise before an auth account exists. Only then is the account
 * created and the credentials sent.
 */
export async function issuePortalAccess(
  investorId: string,
  actor: UserContext,
  req: any,
): Promise<AccessGrant> {
  const db = adminClient();

  const { data: investor, error: readErr } = await db
    .from("investors")
    .select("id, name, email, status, certification_status, certification_date")
    .eq("id", investorId)
    .is("deleted_at", null)
    .maybeSingle();
  if (readErr) throw new InternalError(`Capital partner lookup failed: ${readErr.message}`);
  if (!investor) throw new NotFoundError("Capital partner not found");

  const email = String(investor.email ?? "").trim();
  if (!email) throw new BadRequestError("This partner has no email address — add one before issuing access.");

  // The gate. Raises certification_invalid / not_authorised from Postgres.
  const { data: invite, error: gateErr } = await db.rpc("issue_portal_invite", {
    p_investor: investorId,
    p_actor_role: actor.role,
    p_actor_email: actor.email ?? "",
    p_ttl_hours: 24,
  });
  if (gateErr) throw translateGateError(gateErr.message);

  const inviteRow = Array.isArray(invite) ? invite[0] : invite;
  const expiresAt = inviteRow?.expires_at ?? new Date(Date.now() + 864e5).toISOString();

  const name = String(investor.name ?? "").trim();
  const password = generatePassword(16);
  const appMetadata = { role: "investor", investor_id: investorId, must_change_password: true };
  const admin = db.auth.admin;

  const existing = await findAuthUserByEmail(email);
  let authUser: User;
  let created = false;

  if (!existing) {
    const { data, error } = await admin.createUser({
      email,
      password,
      email_confirm: true, // no SMTP on the auth project; we send our own mail
      app_metadata: appMetadata,
      user_metadata: name ? { full_name: name } : {},
    });
    if (error || !data.user) {
      if (error && /already/i.test(error.message)) throw new ConflictError(`An account already exists for ${email}`);
      throw new InternalError(`Could not create the portal account: ${error?.message ?? "unknown error"}`);
    }
    authUser = data.user;
    created = true;
  } else {
    // Re-issuing rotates the password and lifts any previous revocation.
    const { data, error } = await admin.updateUserById(existing.id, {
      password,
      app_metadata: { ...(existing.app_metadata ?? {}), ...appMetadata },
      user_metadata: { ...(existing.user_metadata ?? {}), ...(name ? { full_name: name } : {}) },
      ban_duration: "none",
    });
    if (error || !data.user) throw new InternalError(`Could not update the portal account: ${error?.message ?? "unknown error"}`);
    authUser = data.user;
  }

  // Bind the auth user once. The gate trigger makes it immutable afterwards, so
  // a second issue to the same partner can never re-point their holdings.
  const { data: map } = await db
    .from("investor_auth_map")
    .select("investor_id, auth_uid")
    .eq("investor_id", investorId)
    .maybeSingle();
  if (!map) {
    await db.from("investor_auth_map").insert({
      investor_id: investorId,
      auth_uid: authUser.id,
      login_mode: "pending",
    });
  } else if (!map.auth_uid) {
    await db
      .from("investor_auth_map")
      .update({ auth_uid: authUser.id, login_mode: "pending" })
      .eq("investor_id", investorId);
  } else if (map.auth_uid !== authUser.id) {
    throw new ConflictError(
      "This partner is already bound to a different login. Revoke that account before issuing a new one.",
    );
  } else {
    await db.from("investor_auth_map").update({ login_mode: "pending" }).eq("investor_id", investorId);
  }

  if (investor.status === "prospective" || investor.status === "certified") {
    await db.from("investors").update({ status: "invited" }).eq("id", investorId);
  }

  const base = portalUrl(req);
  const link = await magicLink(email, base).catch((err) => {
    // A link is a convenience; the emailed password is the guaranteed path.
    logger.warn({ err, investorId }, "portal magic link generation failed");
    return base;
  });

  const { data: settings } = await db.from("portal_settings").select("notify_only").eq("id", true).maybeSingle();
  await queueEmail({
    investorId,
    template: "credentials",
    to: email,
    payload: { name, password, portalUrl: base, link },
  });

  await logActivity(investorId, null, "access_issued", { by: actor.email ?? null });

  return {
    investorId,
    email,
    name,
    password,
    link,
    portalUrl: base,
    expiresAt,
    created,
    notifyOnly: settings?.notify_only !== false,
  };
}

/** One-time sign-in link that lands the session in httpOnly cookies. */
async function magicLink(email: string, base: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new InternalError(`Could not generate a sign-in link: ${error.message}`);
  const token = data.properties?.hashed_token;
  if (!token) throw new InternalError("Supabase returned no sign-in token.");
  const origin = new URL(base).origin;
  return `${origin}/api/auth/callback?token=${encodeURIComponent(token)}&type=magiclink`;
}

/**
 * Revoke portal access the same day, as the Build Pack requires.
 *
 * Both halves matter: banning the auth user stops a refresh, and flipping
 * login_mode stops the *current* access token, because resolveInvestorScope
 * re-reads it on every request. Without the second, a revoked partner would
 * keep reading for up to an hour.
 */
export async function setPortalAccess(
  investorId: string,
  enabled: boolean,
  actor: UserContext,
  reason?: string,
): Promise<{ changed: boolean }> {
  const db = adminClient();
  const { data: map } = await db
    .from("investor_auth_map")
    .select("auth_uid, login_mode")
    .eq("investor_id", investorId)
    .maybeSingle();

  await db
    .from("investor_auth_map")
    .update({ login_mode: enabled ? "full" : "revoked" })
    .eq("investor_id", investorId);

  if (map?.auth_uid) {
    const { error } = await db.auth.admin.updateUserById(map.auth_uid, {
      ban_duration: enabled ? "none" : "876000h", // ~100 years = indefinite
    });
    if (error) throw new InternalError(`Could not update portal access: ${error.message}`);
  }

  await recordAudit({
    action: enabled ? "RESTORE_PARTNER_ACCESS" : "REVOKE_PARTNER_ACCESS",
    entityId: investorId,
    actor,
    reason,
    details: enabled ? "Portal access restored" : "Portal access revoked",
  });

  await logActivity(investorId, null, enabled ? "access_restored" : "access_revoked", {
    by: actor.email ?? null,
  });

  const { data: investor } = await db.from("investors").select("email, name").eq("id", investorId).maybeSingle();
  if (investor?.email) {
    await queueEmail({
      investorId,
      template: "access_changed",
      to: investor.email,
      payload: {
        name: investor.name,
        message: enabled
          ? "Your access to the Aysan Capital Partners portal has been restored."
          : "Your access to the Aysan Capital Partners portal has been withdrawn.",
      },
    });
  }

  return { changed: Boolean(map?.auth_uid) };
}

// ─── Shared helpers ────────────────────────────────────────────────────────

/** Append a partner-visible activity line. Best effort; never blocks a write. */
export async function logActivity(
  investorId: string,
  dealId: string | null,
  eventType: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await adminClient()
    .from("activity_log")
    .insert({ investor_id: investorId, deal_id: dealId, event_type: eventType, payload });
  if (error) logger.error({ err: error, investorId, eventType }, "activity_log insert failed");
}

/** Write an audit row for an admin action, in the CRM's existing shape. */
export async function recordAudit(opts: {
  action: string;
  entityId: string;
  actor: UserContext;
  details: string;
  reason?: string;
  entityType?: string;
  oldValue?: unknown;
  newValue?: unknown;
}): Promise<void> {
  const { error } = await adminClient().from("audit_logs").insert({
    action: opts.action,
    event_type: `partner.${opts.action.toLowerCase()}`,
    entity_type: opts.entityType ?? "investor",
    entity_id: opts.entityId,
    operator: opts.actor.email,
    operator_role: opts.actor.role,
    details: opts.details,
    reason: opts.reason ?? null,
    old_value: opts.oldValue ?? null,
    new_value: opts.newValue ?? null,
    occurred_at: new Date().toISOString(),
  });
  if (error) logger.error({ err: error, action: opts.action }, "audit_logs insert failed");
}

/**
 * Turn a Postgres gate exception into something an admin can act on.
 *
 * The messages are deliberately specific. "Certification not valid" tells the
 * admin exactly which box to tick; a generic "operation failed" sends them to
 * the developer instead.
 */
export function translateGateError(message: string): Error {
  const m = String(message);
  if (m.includes("certification_invalid")) {
    return new BadRequestError(
      "Certification is not valid, or was signed more than twelve months ago. Record a current certification before issuing access.",
    );
  }
  if (m.includes("not_authorised")) {
    return new BadRequestError("Your role cannot issue portal access to a capital partner.");
  }
  if (m.includes("invite_requires_gate")) {
    return new InternalError("Portal invites must be issued through issue_portal_invite().");
  }
  if (m.includes("dscr_status_cfo_only")) {
    return new BadRequestError("Coverage status has one author: the CFO. Your role cannot change it.");
  }
  if (m.includes("sanction_required")) {
    return new BadRequestError("A CFO sanction reference is required for a distribution or a buyback.");
  }
  if (m.includes("settled_needs_evidence")) {
    return new BadRequestError("A settled transaction needs an evidence link (the bank confirmation in its home).");
  }
  if (m.includes("commitment_locked")) {
    return new BadRequestError("This commitment is completed and locked. Amount, ownership and deal cannot change.");
  }
  if (m.includes("illegal_transition")) {
    return new BadRequestError("That commitment status change is not allowed.");
  }
  if (m.includes("auth_map_immutable")) {
    return new BadRequestError("This partner's login is already bound and cannot be re-pointed.");
  }
  if (m.includes("pass_needs_reason")) {
    return new BadRequestError("Passing a partner needs both a reason and a category.");
  }
  if (m.includes("valid_cert_complete")) {
    return new BadRequestError("A valid certification needs a kind, a date signed and an evidence link.");
  }
  if (m.includes("append_only_table")) {
    return new BadRequestError("That record is append only and cannot be edited or deleted.");
  }
  return new InternalError(m);
}
