/**
 * PATCH /api/commitments/:id — move a commitment through its lifecycle.
 *
 *   pending → completed (ownership set, then locked)
 *   completed → converted   (holdco shareholding issued, SPV history retained)
 *   completed → bought_back (CFO sanction reference required)
 *
 * Nothing is ever deleted. A conversion keeps the SPV history visible read only,
 * and a buyback leaves the partner read only for ninety days rather than
 * cutting them off from their own record the moment the money moves.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { PARTNER_MANAGERS } from "../_lib/authz.js";
import { BadRequestError, InternalError, NotFoundError } from "../../lib/core/errors.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { queueEmail } from "../../lib/email/send.js";
import { logActivity, recordAudit, translateGateError } from "../_lib/investor-access.js";

const idSchema = z.object({ id: z.string().uuid("A commitment id (uuid) is required") });

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("complete"),
    /** Basis points, set at completion and never computed client side. */
    ownership_bp: z.number().int().min(0).max(10000),
    completed_at: z.string().optional(),
  }),
  z.object({
    action: z.literal("convert"),
    shares: z.number().positive(),
    issued_at: z.string(),
  }),
  z.object({
    action: z.literal("buyback"),
    cfo_sanction_ref: z.string().trim().min(1, "A CFO sanction reference is required"),
    amount_pence: z.number().int().positive(),
    txn_date: z.string(),
    evidence_link: z.string().trim().min(1),
  }),
]);

/** Read-only window after a buyback, per the Build Pack. */
const READ_ONLY_DAYS = 90;

export default createHandler({
  methods: ["PATCH"],
  requireAuth: true,
  roles: PARTNER_MANAGERS,
  bodySchema,
  handle: async ({ body, query, user }) => {
    const { id } = idSchema.parse(query);
    const db = adminClient();

    const { data: commitment, error: readErr } = await db
      .from("commitments")
      .select("*, deals(id, partner_display_name), investors(id, name, email)")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw new InternalError(`commitments: ${readErr.message}`);
    if (!commitment) throw new NotFoundError("Commitment not found");

    const dealName = (commitment as any).deals?.partner_display_name ?? "your acquisition";
    const investor = (commitment as any).investors;

    if (body.action === "complete") {
      if (commitment.status !== "pending") throw new BadRequestError("Only a pending commitment can be completed.");
      const updated = await patch(id, {
        status: "completed",
        ownership_bp: body.ownership_bp,
        completed_at: body.completed_at ?? new Date().toISOString(),
      });
      await logActivity(commitment.investor_id, commitment.deal_id, "completed", { deal: dealName });
      await recordAudit({
        action: "COMPLETE_COMMITMENT",
        entityId: id,
        entityType: "commitments",
        actor: user!,
        details: `Commitment completed for ${investor?.name ?? "partner"}`,
        oldValue: commitment,
        newValue: updated,
      });
      return updated;
    }

    if (body.action === "convert") {
      if (commitment.status !== "completed") {
        throw new BadRequestError("Only a completed commitment can be converted.");
      }
      const updated = await patch(id, { status: "converted", converted_at: new Date().toISOString() });

      const { error } = await db.from("holdco_shareholdings").insert({
        investor_id: commitment.investor_id,
        from_commitment_id: id,
        shares: body.shares,
        issued_at: body.issued_at,
      });
      if (error) throw new InternalError(`holdco_shareholdings: ${error.message}`);

      await logActivity(commitment.investor_id, commitment.deal_id, "converted", { deal: dealName });
      await recordAudit({
        action: "CONVERT_COMMITMENT",
        entityId: id,
        entityType: "commitments",
        actor: user!,
        details: `Converted to holdco shares for ${investor?.name ?? "partner"}`,
        oldValue: commitment,
        newValue: updated,
      });
      return updated;
    }

    // buyback
    if (commitment.status !== "completed") {
      throw new BadRequestError("Only a completed commitment can be bought back.");
    }

    // The transaction goes first: its CHECK constraint is what actually refuses
    // a buyback without a sanction reference (rule R5).
    const { error: txnErr } = await db.from("capital_transactions").insert({
      commitment_id: id,
      type: "buyback",
      amount_pence: body.amount_pence,
      txn_date: body.txn_date,
      settled: true,
      settled_at: new Date().toISOString(),
      evidence_link: body.evidence_link,
      cfo_sanction_ref: body.cfo_sanction_ref,
    });
    if (txnErr) throw translateGateError(txnErr.message);

    const updated = await patch(id, { status: "bought_back", bought_back_at: new Date().toISOString() });

    const until = new Date();
    until.setDate(until.getDate() + READ_ONLY_DAYS);
    await db
      .from("investor_auth_map")
      .update({ login_mode: "read_only", read_only_until: until.toISOString().slice(0, 10) })
      .eq("investor_id", commitment.investor_id);

    await logActivity(commitment.investor_id, commitment.deal_id, "bought_back", {
      deal: dealName,
      read_only_until: until.toISOString().slice(0, 10),
    });
    if (investor?.email) {
      await queueEmail({
        investorId: commitment.investor_id,
        template: "access_changed",
        to: investor.email,
        payload: {
          name: investor.name,
          message:
            "Your holding has been bought back. You keep read-only access to your record for ninety days; the details are in the portal.",
        },
      });
    }
    await recordAudit({
      action: "BUYBACK_COMMITMENT",
      entityId: id,
      entityType: "commitments",
      actor: user!,
      details: `Holding bought back for ${investor?.name ?? "partner"} (sanction ${body.cfo_sanction_ref})`,
      oldValue: commitment,
      newValue: updated,
    });
    return updated;
  },
});

async function patch(id: string, values: Record<string, unknown>) {
  const { data, error } = await adminClient()
    .from("commitments")
    .update(values)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw translateGateError(error.message);
  return data;
}
