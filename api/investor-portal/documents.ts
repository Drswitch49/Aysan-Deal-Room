/**
 * GET /api/investor-portal/documents — every document across the partner's
 * holdings, newest first, optionally filtered to one acquisition.
 *
 * The view carries no storage_path and no file_link, so this response cannot
 * leak a shareable URL even by accident. A document that has not published yet
 * comes back with available: false and its publishes_on date, so the screen can
 * say when it arrives instead of showing a blank row.
 */
import { createHandler } from "../_lib/handler.js";
import { InternalError } from "../../lib/core/errors.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { resolveInvestorScope } from "../_lib/investor-context.js";

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ query, user }) => {
    const scope = await resolveInvestorScope(user, (query as any)?.investor_id);
    const dealKey = (query as any)?.deal_key as string | undefined;

    let q = adminClient()
      .from("partner_documents")
      .select("*")
      .eq("investor_id", scope.investorId)
      .order("published_at", { ascending: false, nullsFirst: false });
    if (dealKey) q = q.eq("deal_key", dealKey);

    const { data, error } = await q;
    if (error) throw new InternalError(`partner_documents: ${error.message}`);
    return { rows: data ?? [], total: data?.length ?? 0 };
  },
});
