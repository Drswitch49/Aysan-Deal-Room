/** /api/lenders/:id — fetch / update / soft-delete a lender. */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { InternalError } from "../../lib/core/errors.js";
import { ALL_ADMINS } from "../_lib/authz.js";

export default itemHandler(repositories.lenders, {
  writeRoles: ALL_ADMINS,
  // The portal drawer presents NDA compliance as one switch per lender, so it
  // has to be authoritative: mirror it onto every assignment, otherwise a deal
  // assigned while the NDA was approved would stay unlocked after it is revoked.
  onUpdated: async (lender, patch) => {
    if (!("nda_approved" in patch)) return;
    const { error } = await adminClient()
      .from("lender_deal_assignments")
      .update({ nda_approved: Boolean(patch.nda_approved) })
      .eq("lender_id", lender.id)
      .is("deleted_at", null);
    if (error) throw new InternalError(`lender nda cascade: ${error.message}`);
  },
});
