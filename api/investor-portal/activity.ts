/**
 * GET /api/investor-portal/activity — the partner's full activity history.
 *
 * Read only and paginated at twenty five. Every line is written by the server
 * when the thing itself happened, so the feed is a record rather than a
 * narration: if it says a capital call settled on 12 Aug, a settled transaction
 * row exists with that date and an evidence link behind it.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { InternalError } from "../../lib/core/errors.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { resolveInvestorScope } from "../_lib/investor-context.js";

const PAGE_SIZE = 25;

const querySchema = z.object({
  investor_id: z.string().uuid().optional(),
  deal_key: z.string().uuid().optional(),
  event_type: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ query, user }) => {
    const filters = querySchema.parse(query ?? {});
    const scope = await resolveInvestorScope(user, filters.investor_id);

    const from = (filters.page - 1) * PAGE_SIZE;
    let q = adminClient()
      .from("activity_log")
      .select("id, event_type, payload, created_at, deal_id", { count: "exact" })
      .eq("investor_id", scope.investorId)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (filters.deal_key) q = q.eq("deal_id", filters.deal_key);
    if (filters.event_type) q = q.eq("event_type", filters.event_type);

    const { data, error, count } = await q;
    if (error) throw new InternalError(`activity_log: ${error.message}`);

    return {
      rows: data ?? [],
      total: count ?? 0,
      page: filters.page,
      page_size: PAGE_SIZE,
    };
  },
});
