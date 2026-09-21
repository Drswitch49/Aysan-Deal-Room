/**
 * GET /api/postcall-briefs/:id — one post-call run.
 *
 * Read-only: runs are never overwritten (spec rule "Re-run"). A new transcript
 * or note creates a new run via the postcall-brief job.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { NotFoundError } from "../../lib/core/errors.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

const idSchema = z.object({ id: z.string().uuid("A resource id (uuid) is required") });

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ query }) => {
    const row = await repositories.postcallBriefs.findById(idSchema.parse(query).id);
    if (!row) throw new NotFoundError("Not found");
    return row;
  },
});
