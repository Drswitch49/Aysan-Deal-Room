/**
 * Deal lifecycle service (Supabase-native).
 *
 * Replaces the legacy promote-deal / remove-deal / update-inbox-status action
 * cases: in the consolidated model a "promotion" is a stage transition on the
 * SAME deal row (inbox → review → active → archived), not a copy between tables.
 * Every transition writes deal_stage_history and audit_logs.
 */
import { z } from "zod";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { dealStageSchema, type Deal, type DealStage } from "../../lib/core/schemas/deal.js";
import { BadRequestError, NotFoundError } from "../../lib/core/errors.js";

export const transitionInputSchema = z.object({
  deal_id: z.string().uuid(),
  to_stage: dealStageSchema,
  notes: z.string().optional(),
  kill_reason: z.string().optional(),
});
export type TransitionInput = z.infer<typeof transitionInputSchema>;

/** Allowed lifecycle moves. Any stage may move to archived (kill). */
const ALLOWED: Record<DealStage, DealStage[]> = {
  inbox: ["review", "active", "archived"],
  review: ["active", "archived", "inbox"],
  active: ["archived", "review"],
  archived: ["inbox", "review", "active"], // revive
};

/** Next ACP-CFS-NNN reference (max existing + 1). */
async function nextAcpRef(): Promise<string> {
  const db = adminClient();
  const { data, error } = await db
    .from("deals")
    .select("acp_ref_no")
    .not("acp_ref_no", "is", null)
    .like("acp_ref_no", "ACP-CFS-%");
  if (error) throw new Error(`nextAcpRef: ${error.message}`);
  let max = 0;
  for (const r of data ?? []) {
    const m = String((r as { acp_ref_no: string }).acp_ref_no).match(/ACP-CFS-(\d+)/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `ACP-CFS-${String(max + 1).padStart(3, "0")}`;
}

export async function transitionDeal(
  input: TransitionInput,
  actor: { email: string | null; role: string },
): Promise<Deal> {
  const deal = await repositories.deals.findById(input.deal_id);
  if (!deal) throw new NotFoundError(`Deal ${input.deal_id} not found`);

  const from = deal.stage;
  if (from === input.to_stage) throw new BadRequestError(`Deal is already in stage "${from}"`);
  if (!ALLOWED[from].includes(input.to_stage)) {
    throw new BadRequestError(`Invalid transition ${from} → ${input.to_stage}`);
  }

  const patch: Record<string, unknown> = { stage: input.to_stage };
  // Entering the active pipeline: assign an ACP ref once.
  if (input.to_stage === "active" && !deal.acp_ref_no) {
    patch.acp_ref_no = await nextAcpRef();
  }
  // Killing a deal: record kill metadata.
  if (input.to_stage === "archived") {
    patch.killed_by = actor.email ?? actor.role;
    patch.kill_date = new Date().toISOString();
    if (input.kill_reason) patch.kill_reason_text = input.kill_reason;
  }

  const updated = await repositories.deals.update(input.deal_id, patch as never);

  await repositories.dealStageHistory.create({
    deal_id: deal.id,
    company_name: deal.company_name ?? deal.deal_name,
    from_stage: from,
    to_stage: input.to_stage,
    changed_by: actor.email,
    changed_by_role: actor.role,
    changed_at: new Date().toISOString(),
    notes: input.notes ?? null,
    transition_valid: true,
  });

  await repositories.auditLogs.create({
    action: "DEAL_STAGE_TRANSITION",
    event_type: "deal.transition",
    entity_type: "deal",
    entity_id: deal.id,
    operator: actor.email,
    operator_role: actor.role,
    details: `Stage ${from} → ${input.to_stage}${input.notes ? ` — ${input.notes}` : ""}`,
    occurred_at: new Date().toISOString(),
  });

  return updated;
}
