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
});

export default createHandler({
  methods: ["GET", "POST"],
  requireAuth: true,
  handle: async ({ req, body, query, user }) => {
    if (req.method === "GET") {
      return repositories.deals.list(listSchema.parse(query));
    }
    // POST — create (writers only)
    if (!user || !WRITERS.includes(user.role)) {
      throw new ForbiddenError("Creating deals requires an analyst/partner/admin role");
    }
    return repositories.deals.create(createDealSchema.parse(body));
  },
});
