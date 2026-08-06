/**
 * POST /api/auth/provision — issue or revoke portal access for a registry row.
 *
 * This is what the HR & Stakeholders admin panel calls when an owner/admin
 * clicks "Generate Link", "Reset Password" or toggles a profile's status. Any
 * PEOPLE_MANAGERS role can call it; `provisionAccount` additionally refuses to
 * mint an account that outranks the caller.
 *
 * Modes:
 *   link        — create/sync the account and return a single-use login link
 *   password    — create/sync the account and return a fresh temporary password
 *   credentials — both of the above in one call (used when adding a person)
 *   sync        — push the row's current name/role onto an existing account
 *   enable      — lift a previous deactivation (no-op when no account exists)
 *   disable     — ban the account so a deactivated profile can no longer sign in
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { PEOPLE_MANAGERS } from "../_lib/authz.js";
import {
  provisionAccount,
  issueLoginLink,
  issueTemporaryPassword,
  setAccountEnabled,
  syncAccountDetails,
  originFrom,
  LINK_TTL_MINUTES,
} from "../_lib/account-provisioning.js";

const bodySchema = z.object({
  type: z.enum(["team", "shareholder"]),
  id: z.string().uuid("A registry row id (uuid) is required"),
  mode: z.enum(["link", "password", "credentials", "sync", "enable", "disable"]).default("link"),
});

export default createHandler({
  methods: ["POST"],
  requireAuth: true,
  roles: PEOPLE_MANAGERS,
  bodySchema,
  handle: async ({ req, body, user }) => {
    const actorRole = user?.role ?? "read_only";
    const { type, id, mode } = body;

    if (mode === "enable" || mode === "disable") {
      const result = await setAccountEnabled(type, id, mode === "enable", actorRole);
      return { mode, ...result };
    }

    if (mode === "sync") {
      return { mode, ...(await syncAccountDetails(type, id, actorRole)) };
    }

    const account = await provisionAccount(type, id, actorRole);

    // The password is minted before the link so a link failure can never cost
    // the caller the credential they were handed — it is shown exactly once.
    const tempPassword =
      mode === "password" || mode === "credentials" ? await issueTemporaryPassword(account.authUserId) : undefined;
    let loginLink: string | undefined;
    if (mode === "link") {
      loginLink = await issueLoginLink(account.email, originFrom(req));
    } else if (mode === "credentials") {
      // Password already issued — degrade to "no link" rather than 500-ing and
      // leaving the caller with a rotated password they never saw.
      try {
        loginLink = await issueLoginLink(account.email, originFrom(req));
      } catch {
        loginLink = undefined;
      }
    }

    return {
      mode,
      ...account,
      ...(tempPassword ? { tempPassword } : {}),
      ...(loginLink ? { loginLink, expiresInMinutes: LINK_TTL_MINUTES } : {}),
    };
  },
});
