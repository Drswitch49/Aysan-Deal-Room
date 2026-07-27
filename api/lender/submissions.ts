/**
 * GET /api/lender/submissions — submission-log entries on the signed-in
 * lender's assigned deals.
 */
import { createHandler } from "../_lib/handler.js";
import { resolveLenderScope } from "../_lib/lender-context.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { InternalError } from "../../lib/core/errors.js";

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ query, user }) => {
    const scope = await resolveLenderScope(user, (query as any)?.lender_id);
    if (scope.dealIds.length === 0) return { rows: [] };

    const { data, error } = await adminClient()
      .from("submission_log")
      .select("id, deal_id, submitted_on, what_was_sent, sent_to, sent_via, response_received, flag")
      .in("deal_id", scope.dealIds)
      .is("deleted_at", null);
    if (error) throw new InternalError(`lender submissions: ${error.message}`);
    return { rows: data ?? [] };
  },
});
