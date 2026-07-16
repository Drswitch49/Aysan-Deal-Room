/**
 * /api/deals/:id — fetch, update, or soft-delete a single deal.
 * Replaces the ref/id-dispatch branches of the legacy api/deals.ts.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { WRITERS, ALL_ADMINS } from "../_lib/authz.js";
import { ForbiddenError, NotFoundError, BadRequestError } from "../../lib/core/errors.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { updateDealSchema } from "../../lib/core/schemas/deal.js";

const idSchema = z.object({ id: z.string().uuid("A deal id (uuid) is required") });

export default createHandler({
  methods: ["GET", "PATCH", "DELETE"],
  requireAuth: true,
  handle: async ({ req, body, query, user }) => {
    const { id } = idSchema.parse(query);

    if (req.method === "GET") {
      const deal = await repositories.deals.findById(id);
      if (!deal) throw new NotFoundError(`Deal ${id} not found`);
      return deal;
    }

    if (req.method === "PATCH") {
      if (!user || !WRITERS.includes(user.role)) throw new ForbiddenError("Editing deals requires a writer role");
      const patch = updateDealSchema.parse(body ?? {});
      if (Object.keys(patch).length === 0) throw new BadRequestError("Empty update");
      return repositories.deals.update(id, patch);
    }

    // DELETE (soft) — admins only
    if (!user || !ALL_ADMINS.includes(user.role)) throw new ForbiddenError("Deleting deals requires an admin role");
    await repositories.deals.remove(id);
    return { id, deleted: true };
  },
});
