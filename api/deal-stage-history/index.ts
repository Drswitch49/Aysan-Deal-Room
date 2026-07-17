/** GET /api/deal-stage-history?deal_id=… — stage transition history. */
import { createHandler } from "../_lib/handler.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ query }) =>
    repositories.dealStageHistory.list({ ...(query as Record<string, unknown>), orderBy: "created_at" }),
});
