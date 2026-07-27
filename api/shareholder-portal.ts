/**
 * GET /api/shareholder-portal — deals assigned to the signed-in shareholder
 * (Phase 6, Supabase-backed; session cookies, no bearer tokens in localStorage).
 * Staff may inspect a specific shareholder via ?shareholder_id=….
 */
import { createHandler } from "./_lib/handler.js";
import { ALL_STAFF } from "./_lib/authz.js";
import { ForbiddenError, InternalError } from "../lib/core/errors.js";
import { repositories } from "../lib/data/supabase/repositories.js";
import { adminClient } from "../lib/data/supabase/client.js";

const SHAREHOLDER_SAFE_COLUMNS = [
  "id", "acp_ref_no", "ref_no", "deal_name", "company_name", "pipeline_stage", "stage",
  "location", "sector", "industry", "enterprise_value", "asking_price_gbp",
  "turnover", "ebitda_gbp", "deal_type", "executive_summary", "business_description",
  "investment_highlights", "acquisition_rationale",
].join(", ");

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ query, user }) => {
    let shareholderId: string | null = null;
    if (user?.role === "shareholder") {
      shareholderId = user.shareholderId ?? null;
    } else if (user && ALL_STAFF.includes(user.role)) {
      shareholderId = ((query as any)?.shareholder_id as string) ?? null;
    }
    if (!shareholderId) throw new ForbiddenError("No shareholder scope available for this session");

    const assignments = await repositories.shareholderDealAssignments.list({ shareholder_id: shareholderId, limit: 200 });
    const dealIds = assignments.rows.map((a: any) => a.deal_id).filter(Boolean);
    if (dealIds.length === 0) return { deals: [] };

    const { data, error } = await adminClient()
      .from("deals")
      .select(SHAREHOLDER_SAFE_COLUMNS)
      .in("id", dealIds)
      .is("deleted_at", null);
    if (error) throw new InternalError(`shareholder portal: ${error.message}`);
    return { deals: data ?? [] };
  },
});
