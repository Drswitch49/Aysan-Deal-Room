/**
 * POST /api/ai/ask — synchronous pre-call brief Q&A (short answers; no job
 * round-trip needed). Replaces the legacy precall-brief "ask-question" action.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { BadRequestError, NotFoundError } from "../../lib/core/errors.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { aiAvailable } from "../../lib/ai/client.js";
import { answerPrecallQuestion } from "../../lib/ai/tasks.js";

const bodySchema = z.object({
  deal_id: z.string().uuid(),
  question: z.string().min(1),
  brief: z.record(z.string(), z.unknown()).optional(),
  history: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
});

export default createHandler<z.infer<typeof bodySchema>>({
  methods: ["POST"],
  requireAuth: true,
  bodySchema,
  handle: async ({ body }) => {
    if (!aiAvailable()) throw new BadRequestError("AI is not configured.");
    const deal = await repositories.deals.findById(body.deal_id);
    if (!deal) throw new NotFoundError("Deal not found");

    const answer = await answerPrecallQuestion(
      {
        companyName: deal.company_name,
        dealRef: deal.acp_ref_no ?? deal.ref_no,
        sector: deal.sector ?? deal.industry,
        location: deal.location,
        multiplier: deal.enterprise_value && deal.ebitda_gbp ? (Number(deal.enterprise_value) / Number(deal.ebitda_gbp)).toFixed(2) : "",
        revenue: deal.turnover,
        ebitda: deal.ebitda_gbp,
      },
      {
        companySnapshot: (body.brief as any)?.executiveDealSnapshot ?? "",
        investmentThesis: (body.brief as any)?.callStrategy ?? "",
        keyRisks: (body.brief as any)?.dealKillers ?? [],
        priorityQuestions: (body.brief as any)?.criticalUnknowns ?? [],
      },
      body.question,
      body.history,
    );
    return { answer };
  },
});
