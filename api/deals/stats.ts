/**
 * /api/deals/stats — deal counts by lifecycle stage (dashboard + inbox pills).
 *
 * Optional params narrow the counts to what a screen is actually showing:
 *   ?q=      search term, so the inbox pills match the list beneath them
 *   ?stage=  scope the `unassigned` tally to the active filter
 *   ?ids=    scope it to an explicit set (the inbox watchlist)
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

const statsSchema = z.object({
  q: z.string().optional(),
  stage: z.enum(["inbox", "review", "active", "archived"]).optional(),
  ids: z.string().optional(),
});

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ query }) => {
    const { q, stage, ids } = statsSchema.parse(query ?? {});
    const search = q && q.trim() ? q : undefined;
    const idList = ids === undefined ? undefined : ids.split(",").map((s) => s.trim()).filter(Boolean);

    const [counts, unassigned] = await Promise.all([
      search
        ? repositories.deals.stageCountsMatching(search)
        : repositories.deals.stageCounts().then((byStage) => ({
            ...byStage,
            all: Object.values(byStage).reduce((a, b) => a + b, 0),
          })),
      repositories.deals.unassignedCount({ stage, search, ids: idList }),
    ]);

    const { all, ...byStage } = counts;
    return { total: all, byStage, unassigned };
  },
});
