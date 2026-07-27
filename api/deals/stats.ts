/**
 * /api/deals/stats — deal counts by lifecycle stage (dashboard).
 */
import { createHandler } from "../_lib/handler.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async () => {
    const byStage = await repositories.deals.stageCounts();
    const total = Object.values(byStage).reduce((a, b) => a + b, 0);
    return { total, byStage };
  },
});
