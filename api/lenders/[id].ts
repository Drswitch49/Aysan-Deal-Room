/** /api/lenders/:id — fetch / update / permanently delete a lender. */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { ALL_ADMINS } from "../_lib/authz.js";
import { findAuthUserByEmail } from "../_lib/account-provisioning.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import {
  BadRequestError, ForbiddenError, InternalError, NotFoundError,
} from "../../lib/core/errors.js";

const idSchema = z.object({ id: z.string().uuid("A lender id (uuid) is required") });

/** The columns a delete needs: who to name in the audit trail, what to revoke. */
interface LenderRow {
  id: string;
  name: string | null;
  company_name: string | null;
  email: string | null;
  auth_user_id: string | null;
}

/**
 * The lender row as stored, including one already soft-deleted.
 *
 * The repository hides `deleted_at is not null` rows, but a delete has to be
 * able to finish off a profile an earlier soft-delete left half-gone —
 * otherwise those rows are unreachable and their auth account lives forever.
 */
async function loadLenderRow(id: string): Promise<LenderRow> {
  const { data, error } = await adminClient().from("lenders").select("*").eq("id", id).maybeSingle();
  if (error) throw new InternalError(`lenders.load: ${error.message}`);
  if (!data) throw new NotFoundError("Lender not found");
  return data as LenderRow;
}

/**
 * Revoke the lender's sign-in for good by deleting the Supabase Auth account
 * behind the profile.
 *
 * Deleting rather than banning is what "permanently delete" asks for: the
 * account carries the `lender_id` claim that every portal request and RLS
 * policy scopes off, so it must not outlive the profile it points at. It also
 * frees the email address, so the same firm can be re-provisioned later.
 *
 * `auth_user_id` is only set for lenders provisioned in-app; anything imported
 * before that has an account findable by email alone. A lender that never had
 * one is not an error — there is simply nothing to revoke.
 */
async function revokePortalAccess(lender: LenderRow): Promise<boolean> {
  const admin = adminClient().auth.admin;

  let authUserId: string | null = lender.auth_user_id ?? null;
  if (!authUserId) {
    const email = String(lender.email ?? "").trim();
    if (!email) return false;
    authUserId = (await findAuthUserByEmail(email))?.id ?? null;
  }
  if (!authUserId) return false;

  const { error } = await admin.deleteUser(authUserId);
  // Already gone (a retried delete, or removed in the Supabase dashboard) is
  // the outcome we wanted, not a failure.
  if (error && !/not found/i.test(error.message)) {
    throw new InternalError(`Could not revoke portal access: ${error.message}`);
  }
  return true;
}

export default createHandler({
  methods: ["GET", "PATCH", "DELETE"],
  requireAuth: true,
  handle: async ({ req, body, query, user }) => {
    const { id } = idSchema.parse(query);

    if (req.method === "GET") {
      const row = await repositories.lenders.findById(id);
      if (!row) throw new NotFoundError("Lender not found");
      return row;
    }

    if (!user || !ALL_ADMINS.includes(user.role)) {
      throw new ForbiddenError(`Insufficient role to ${req.method === "PATCH" ? "edit" : "delete"} a lender`);
    }

    if (req.method === "PATCH") {
      const patch = (body ?? {}) as Record<string, unknown>;
      if (Object.keys(patch).length === 0) throw new BadRequestError("Empty update");
      const updated = await repositories.lenders.update(id, patch);

      // The portal drawer presents NDA compliance as one switch per lender, so
      // it has to be authoritative: mirror it onto every assignment, otherwise
      // a deal assigned while the NDA was approved would stay unlocked after
      // it is revoked.
      if ("nda_approved" in patch) {
        const { error } = await adminClient()
          .from("lender_deal_assignments")
          .update({ nda_approved: Boolean(patch.nda_approved) })
          .eq("lender_id", id)
          .is("deleted_at", null);
        if (error) throw new InternalError(`lender nda cascade: ${error.message}`);
      }
      return updated;
    }

    // ── DELETE — erase the profile and revoke the account ──────────────────
    //
    // "Permanently Delete Profile" used to be a soft delete: the row kept its
    // data behind a deleted_at, and the auth account was left untouched, so a
    // deleted lender could still sign in and — via assignments the hidden row
    // no longer gated — still reach deal material. Access is therefore revoked
    // FIRST and the profile only erased once that succeeded; a failure here
    // aborts with the profile intact rather than leaving a live account with
    // nothing left to administer it from.
    const lender = await loadLenderRow(id);
    const hadAccount = await revokePortalAccess(lender);

    // The audit entry is the only trace that survives, so write it before the
    // row it describes is gone.
    await repositories.auditLogs.create({
      action: "DELETE_LENDER",
      event_type: "lender.delete",
      entity_type: "lender",
      entity_id: id,
      operator: user.email,
      operator_role: user.role,
      details:
        `Permanently deleted lender ${lender.company_name ?? lender.name ?? id}` +
        `${lender.email ? ` (${lender.email})` : ""}; ` +
        `${hadAccount ? "portal account deleted" : "no portal account to revoke"}`,
      occurred_at: new Date().toISOString(),
    });

    // chat_messages.lender_id is ON DELETE SET NULL, which would strand this
    // lender's messages in no thread at all — rows nobody can read but that
    // still sit in the table. The conversation is part of the profile being
    // erased, so it goes with it, before the row that would orphan it.
    // (lender_deal_assignments is ON DELETE CASCADE and needs no help.)
    const db = adminClient();
    const { error: chatError } = await db.from("chat_messages").delete().eq("lender_id", id);
    if (chatError) throw new InternalError(`lender chat purge: ${chatError.message}`);

    const { error: rowError } = await db.from("lenders").delete().eq("id", id);
    if (rowError) throw new InternalError(`lenders.delete: ${rowError.message}`);

    return { id, deleted: true, accessRevoked: hadAccount };
  },
});
