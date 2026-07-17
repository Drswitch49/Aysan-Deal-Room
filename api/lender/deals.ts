/**
 * GET /api/lender/deals — deals assigned to the signed-in lender (Phase 6,
 * Supabase-backed). Returns ONLY lender-safe fields; company identity is
 * masked client-side per portal policy.
 */
import { createHandler } from "../_lib/handler.js";
import { resolveLenderScope } from "../_lib/lender-context.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { InternalError } from "../../lib/core/errors.js";

const LENDER_SAFE_COLUMNS = [
  "id", "acp_ref_no", "ref_no", "deal_name", "pipeline_stage", "stage",
  "location", "sector", "industry", "enterprise_value", "asking_price_gbp",
  "turnover", "ebitda_gbp", "dscr_proxy", "dscr_score", "deal_type",
  "lender_executive_summary", "business_description", "investment_highlights",
  "acquisition_rationale", "deal_files_secure_url",
].join(", ");

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ query, user }) => {
    const scope = await resolveLenderScope(user, (query as any)?.lender_id);
    if (scope.dealIds.length === 0) return { rows: [] };

    const { data, error } = await adminClient()
      .from("deals")
      .select(LENDER_SAFE_COLUMNS)
      .in("id", scope.dealIds)
      .is("deleted_at", null);
    if (error) throw new InternalError(`lender deals: ${error.message}`);
    return { rows: data ?? [] };
  },
});
