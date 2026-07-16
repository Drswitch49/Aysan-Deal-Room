/**
 * GET /api/jobs/status?id=… — job status for frontend polling (Phase 5).
 * Replaces the legacy Airtable Processing_Status poller; jobs now live in the
 * Supabase `jobs` table and are executed by /api/jobs/worker.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { getJob } from "../../lib/jobs/queue.js";
import { NotFoundError } from "../../lib/core/errors.js";

const querySchema = z.object({ id: z.string().uuid() });

export default createHandler<unknown, z.infer<typeof querySchema>>({
  methods: ["GET"],
  requireAuth: true,
  querySchema,
  handle: async ({ query }) => {
    const job = await getJob(query.id);
    if (!job) throw new NotFoundError(`Job ${query.id} not found`);
    // Don't leak internals beyond what the UI needs.
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      result: job.result ?? null,
      error: job.error ?? null,
      created_at: job.created_at,
      finished_at: job.finished_at ?? null,
    };
  },
});
