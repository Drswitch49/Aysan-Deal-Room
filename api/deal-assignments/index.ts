/**
 * /api/deal-assignments — lender↔deal assignments.
 * GET  ?deal_id=… | ?lender_id=…   list assignments
 * POST { deal_id, lender_id }      assign a lender to a deal
 * Replaces the legacy assign-deal action case.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { WRITERS } from "../_lib/authz.js";
import { ForbiddenError } from "../../lib/core/errors.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

const createSchema = z.object({
  deal_id: z.string().uuid(),
  lender_id: z.string().uuid(),
  nda_approved: z.boolean().optional(),
});

export default createHandler({
  methods: ["GET", "POST"],
  requireAuth: true,
  handle: async ({ req, body, query, user }) => {
    if (req.method === "GET") {
      return repositories.lenderDealAssignments.list(query as Record<string, unknown>);
    }
    if (!user || !WRITERS.includes(user.role)) throw new ForbiddenError("Assigning deals requires a writer role");
    const input = createSchema.parse(body);
    const created = await repositories.lenderDealAssignments.create({
      ...input,
      assigned_by: user.email,
      assigned_at: new Date().toISOString(),
    });
    await repositories.auditLogs.create({
      action: "ASSIGN_DEAL",
      event_type: "assignment.create",
      entity_type: "deal",
      entity_id: input.deal_id,
      operator: user.email,
      operator_role: user.role,
      details: `Assigned lender ${input.lender_id} to deal ${input.deal_id}`,
      occurred_at: new Date().toISOString(),
    });
    return created;
  },
});
