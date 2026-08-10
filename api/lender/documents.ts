/**
 * GET /api/lender/documents — documents shared with the signed-in lender
 * (status "Sent to Lender" on their NDA-approved deals). Internal notes and
 * lender-target fields are never selected.
 */
import { createHandler } from "../_lib/handler.js";
import { resolveLenderScope } from "../_lib/lender-context.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { InternalError } from "../../lib/core/errors.js";

const LENDER_SAFE_DOC_COLUMNS = [
  "id", "deal_id", "document_name", "category", "abl_critical", "status",
  "source", "date_received", "expected_date", "date_sent_to_lender", "file_url",
].join(", ");

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ query, user }) => {
    const scope = await resolveLenderScope(user, (query as any)?.lender_id);
    // No NDA, no documents — enforced here, not just hidden in the portal UI.
    if (scope.approvedDealIds.length === 0) return { rows: [] };

    const { data, error } = await adminClient()
      .from("documents")
      .select(LENDER_SAFE_DOC_COLUMNS)
      .in("deal_id", scope.approvedDealIds)
      .ilike("status", "sent to lender")
      .is("deleted_at", null);
    if (error) throw new InternalError(`lender documents: ${error.message}`);
    return { rows: data ?? [] };
  },
});
