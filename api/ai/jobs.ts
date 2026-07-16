/**
 * POST /api/ai/jobs — enqueue an AI/background job (Phase 5).
 *
 * Body: { type, ...payload }. Returns { job_id } for polling via
 * GET /api/jobs/status?id=…  Replaces the legacy per-endpoint triggers
 * (api/admin/precall-brief etc.) and both queue systems.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { WRITERS } from "../_lib/authz.js";
import { ForbiddenError, BadRequestError } from "../../lib/core/errors.js";
import { enqueue } from "../../lib/jobs/queue.js";
import { aiAvailable } from "../../lib/ai/client.js";

const bodySchema = z.object({
  type: z.enum([
    "transcript-analysis",
    "investment-verdict",
    "precall-brief",
    "postcall-brief",
    "portfolio-briefing",
  ]),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export default createHandler<z.infer<typeof bodySchema>>({
  methods: ["POST"],
  requireAuth: true,
  bodySchema,
  handle: async ({ body, user }) => {
    if (!user || !WRITERS.includes(user.role)) {
      throw new ForbiddenError("Triggering AI jobs requires a writer role");
    }
    if (!aiAvailable()) {
      throw new BadRequestError("AI is not configured (ANTHROPIC_API_KEY missing).");
    }
    const jobId = await enqueue(body.type, body.payload, { createdBy: user.email ?? undefined });
    return { job_id: jobId, status: "queued" };
  },
});
