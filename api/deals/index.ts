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
  /** Case-insensitive search over company/deal name, ref and sector. */
  q: z.string().optional(),
  /** Comma-separated uuids — used by the inbox watchlist, whose membership is client-side. */
  ids: z.string().optional(),
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
      // Search / watchlist take the dedicated path; plain filtered lists keep
      // using the generic repository list.
      if (q.q || q.ids !== undefined) {
        const ids = q.ids === undefined
          ? undefined
          : q.ids.split(",").map((s) => s.trim()).filter(Boolean);
        return repositories.deals.search({
          stage: q.stage,
          search: q.q,
          ids,
          limit: q.limit,
          offset: q.offset,
          orderBy: q.orderBy,
          ascending: q.ascending,
        });
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
