/**
 * /api/deals — list deals (filter by stage/sector/owner/analyst) and create a deal.
 * Replaces part of the overloaded legacy api/deals.ts.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { WRITERS } from "../_lib/authz.js";
import { ForbiddenError } from "../../lib/core/errors.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { listQuerySchema } from "../../lib/core/schemas/common.js";
import { createDealSchema } from "../../lib/core/schemas/deal.js";

const listSchema = listQuerySchema.extend({
  stage: z.enum(["inbox", "review", "active", "archived"]).optional(),
  sector: z.string().optional(),
  owner: z.string().optional(),
  analyst: z.string().optional(),
  /** Lookup by human ref (ACP ref / listing ref / name) or uuid. */
  ref: z.string().optional(),
});

export default createHandler({
  methods: ["GET", "POST"],
  requireAuth: true,
  handle: async ({ req, body, query, user }) => {
    if (req.method === "GET") {
      const q = listSchema.parse(query);
      if (q.ref) {
        const deal = await repositories.deals.findByRef(q.ref);
        return { rows: deal ? [deal] : [], total: deal ? 1 : 0, limit: 1, offset: 0 };
      }
      return repositories.deals.list(q);
    }
    // POST — create (writers only)
    if (!user || !WRITERS.includes(user.role)) {
      throw new ForbiddenError("Creating deals requires an analyst/partner/admin role");
    }
    return repositories.deals.create(createDealSchema.parse(body));
  },
});
