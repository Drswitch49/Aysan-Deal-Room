/**
 * Account provisioning — turns a registry row (acp_team / shareholders) into a
 * Supabase Auth account that can actually sign in.
 *
 * Phase 4 moved auth to Supabase but left no in-app way to create accounts, so
 * the HR page could only tell people to "ask an owner". This service closes
 * that gap: anyone in PEOPLE_MANAGERS can create the auth user, sync its role
 * claim, issue a one-time login link, rotate a temporary password, and
 * ban/unban on deactivate — all with the service-role key, server-side only.
 *
 * Privilege escalation is bounded by `assertCanGrant`: you can never provision
 * an account whose role outranks your own.
 */
import type { User } from "@supabase/supabase-js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { ALL_ADMINS } from "./authz.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { generatePassword } from "../../lib/core/secure-random.js";
import { BadRequestError, ForbiddenError, InternalError, NotFoundError } from "../../lib/core/errors.js";

/** Registry types that have a portal to sign in to. */
export type RegistryType = "team" | "shareholder";

/** Supabase's default email-OTP lifetime; surfaced so the UI can say so. */
export const LINK_TTL_MINUTES = 60;

// Higher rank = more authority. Portal audiences sit below every staff role.
const ROLE_RANK: Record<string, number> = {
  owner: 70,
  managing_partner: 60,
  partner: 50,
  admin: 40,
  hr: 30,
  analyst: 20,
  read_only: 10,
  shareholder: 5,
  lender: 5,
  stakeholder: 5,
};

const canon = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/**
 * Map a free-text registry role ("Managing Partner", "Analyst") onto the
 * user_role enum stored in app_metadata. Falls back to the access-level column,
 * then to read_only — never guesses upward.
 */
export function staffRoleFor(role: unknown, accessLevel: unknown): string {
  const r = canon(role);
  if (r === "super_admin" || r === "founder" || r === "ceo") return "owner";
  if (ROLE_RANK[r] !== undefined && r !== "shareholder" && r !== "lender" && r !== "stakeholder") return r;
  if (r.includes("managing_partner")) return "managing_partner";
  if (r.includes("partner")) return "partner";
  if (r.includes("analyst") || r.includes("associate")) return "analyst";
  if (r.includes("hr") || r.includes("people")) return "hr";
  if (r.includes("admin") || r.includes("operations")) return "admin";

  const access = canon(accessLevel);
  if (access.includes("full")) return "admin";
  if (access.includes("write")) return "analyst";
  return "read_only";
}

/**
 * Throw unless `actorRole` may hand out `targetRole`.
 *
 * Full-access staff (ALL_ADMINS) can provision any role — that is what "full
 * access" means here, and requiring a still-more-senior approver is the exact
 * dead end this feature exists to remove. HR sits in PEOPLE_MANAGERS for roster
 * upkeep but is not full-access, so it cannot mint an account above its own
 * rank (no self-escalation by editing a roster row and provisioning it).
 */
export function assertCanGrant(actorRole: string, targetRole: string): void {
  if (ALL_ADMINS.includes(canon(actorRole))) return;
  const actor = ROLE_RANK[canon(actorRole)] ?? 0;
  const target = ROLE_RANK[canon(targetRole)] ?? 0;
  if (target > actor) {
    throw new ForbiddenError(
      `Your role (${actorRole}) can't grant ${targetRole} access — ask a partner, admin or owner.`,
    );
  }
}

/**
 * Look up an auth user by email. GoTrue's admin API has no email filter, so we
 * page through — fine at this tenant's scale (a few hundred accounts).
 */
async function findAuthUserByEmail(email: string): Promise<User | null> {
  const target = email.trim().toLowerCase();
  const admin = adminClient().auth.admin;
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.listUsers({ page, perPage });
    if (error) throw new InternalError(`Auth directory lookup failed: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < perPage) return null;
  }
  return null;
}

async function loadRegistryRow(type: RegistryType, id: string): Promise<Record<string, any>> {
  const repo = type === "team" ? repositories.acpTeam : repositories.shareholders;
  const row = await repo.findById(id);
  if (!row) throw new NotFoundError(type === "team" ? "Team member not found" : "Shareholder not found");
  return row as Record<string, any>;
}

export interface ProvisionResult {
  authUserId: string;
  email: string;
  name: string;
  /** The user_role / portal_role written to app_metadata. */
  role: string;
  /** True when this call created the auth account (vs. re-syncing an existing one). */
  created: boolean;
}

/**
 * Create (or re-sync) the Supabase Auth account behind a registry row and
 * return its identity. Idempotent: safe to call repeatedly.
 */
export async function provisionAccount(
  type: RegistryType,
  id: string,
  actorRole: string,
): Promise<ProvisionResult> {
  const row = await loadRegistryRow(type, id);

  const email = String(row.email ?? "").trim();
  if (!email) {
    throw new BadRequestError("This profile has no email address — add one before issuing access.");
  }
  if (String(row.status ?? "active").toLowerCase() !== "active") {
    throw new BadRequestError("This profile is inactive. Reactivate it before issuing access.");
  }

  const role = type === "team" ? staffRoleFor(row.role, row.access_level) : "shareholder";
  assertCanGrant(actorRole, role);

  const name = String(row.name ?? "").trim();
  const appMetadata: Record<string, unknown> = { role };
  if (type === "shareholder") appMetadata.shareholder_id = row.id;
  const userMetadata: Record<string, unknown> = name ? { full_name: name } : {};

  const admin = adminClient().auth.admin;
  const existing = await findAuthUserByEmail(email);

  let authUser: User;
  let created = false;
  if (!existing) {
    // A random password is set so the account is never left credential-less;
    // the caller hands over a login link or an explicit temporary password.
    // email_confirm skips the confirmation round-trip (no SMTP configured).
    const { data, error } = await admin.createUser({
      email,
      password: generatePassword(24),
      email_confirm: true,
      app_metadata: appMetadata,
      user_metadata: userMetadata,
    });
    if (error || !data.user) throw new InternalError(`Could not create the account: ${error?.message ?? "unknown error"}`);
    authUser = data.user;
    created = true;
  } else {
    const { data, error } = await admin.updateUserById(existing.id, {
      app_metadata: { ...(existing.app_metadata ?? {}), ...appMetadata },
      user_metadata: { ...(existing.user_metadata ?? {}), ...userMetadata },
      ban_duration: "none", // re-issuing access also lifts a previous deactivation
    });
    if (error || !data.user) throw new InternalError(`Could not update the account: ${error?.message ?? "unknown error"}`);
    authUser = data.user;
  }

  // Shareholders carry the auth link on their row (the portal scopes off it).
  if (type === "shareholder" && row.auth_user_id !== authUser.id) {
    await repositories.shareholders.update(row.id, { auth_user_id: authUser.id });
  }

  return { authUserId: authUser.id, email, name, role, created };
}

/**
 * Issue a single-use login link that runs through our own callback, so the
 * session lands in httpOnly cookies instead of a URL fragment the browser
 * would leak into history.
 */
export async function issueLoginLink(email: string, origin: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new InternalError(`Could not generate a login link: ${error.message}`);
  const token = data.properties?.hashed_token;
  if (!token) throw new InternalError("Supabase returned no login token.");
  return `${origin}/api/auth/callback?token=${encodeURIComponent(token)}&type=magiclink`;
}

/** Rotate the account's password to a fresh one, returned for one-time display. */
export async function issueTemporaryPassword(authUserId: string): Promise<string> {
  const password = generatePassword(16);
  const { error } = await adminClient().auth.admin.updateUserById(authUserId, { password });
  if (error) throw new InternalError(`Could not reset the password: ${error.message}`);
  return password;
}

/**
 * Push a registry row's current name and role onto an existing auth account,
 * so renaming someone on the HR page also fixes the name their sidebar shows.
 * Never creates an account — editing a profile must not silently grant access.
 */
export async function syncAccountDetails(
  type: RegistryType,
  id: string,
  actorRole: string,
): Promise<{ changed: boolean; name?: string; role?: string }> {
  const row = await loadRegistryRow(type, id);
  const email = String(row.email ?? "").trim();
  if (!email) return { changed: false };

  const existing = await findAuthUserByEmail(email);
  if (!existing) return { changed: false };

  const role = type === "team" ? staffRoleFor(row.role, row.access_level) : "shareholder";
  assertCanGrant(actorRole, role);
  const name = String(row.name ?? "").trim();

  const { error } = await adminClient().auth.admin.updateUserById(existing.id, {
    app_metadata: { ...(existing.app_metadata ?? {}), role },
    ...(name ? { user_metadata: { ...(existing.user_metadata ?? {}), full_name: name } } : {}),
  });
  if (error) throw new InternalError(`Could not sync the account: ${error.message}`);
  return { changed: true, name, role };
}

/**
 * Ban/unban the auth account behind a registry row so a deactivated profile
 * actually loses its session. Never creates an account — if none exists there
 * is nothing to revoke, and `changed: false` says so.
 */
export async function setAccountEnabled(
  type: RegistryType,
  id: string,
  enabled: boolean,
  actorRole: string,
): Promise<{ changed: boolean; email: string | null }> {
  const row = await loadRegistryRow(type, id);
  const email = String(row.email ?? "").trim();
  if (!email) return { changed: false, email: null };

  const existing = await findAuthUserByEmail(email);
  if (!existing) return { changed: false, email };

  assertCanGrant(actorRole, type === "team" ? staffRoleFor(row.role, row.access_level) : "shareholder");

  const { error } = await adminClient().auth.admin.updateUserById(existing.id, {
    ban_duration: enabled ? "none" : "876000h", // ~100 years = indefinite
  });
  if (error) throw new InternalError(`Could not update account access: ${error.message}`);
  return { changed: true, email };
}

/** Absolute origin of the incoming request (proxy-aware), for building links. */
export function originFrom(req: any): string {
  const headers = req.headers ?? {};
  const pick = (v: unknown) => (Array.isArray(v) ? v[0] : typeof v === "string" ? v : undefined);
  const proto = pick(headers["x-forwarded-proto"]) ?? "https";
  const host = pick(headers["x-forwarded-host"]) ?? pick(headers.host);
  if (!host) throw new InternalError("Could not determine the site URL for the login link.");
  return `${proto}://${host}`;
}
