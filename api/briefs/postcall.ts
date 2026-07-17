/** GET /api/briefs/postcall?deal_id=… — post-call briefs for a deal. */
import { createHandler } from "../_lib/handler.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ query }) =>
    repositories.postcallBriefs.list({ ...(query as Record<string, unknown>), orderBy: "created_at" }),
});
