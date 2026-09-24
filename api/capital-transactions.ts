/**
 * /api/capital-transactions — capital calls, distributions and buybacks.
 *
 * Rule R5 lives in a CHECK constraint, not here: a distribution or a buyback
 * without a CFO sanction reference is refused by Postgres even if this route is
 * bypassed. What this route adds is the consequence of settling — only a
 * settled row counts towards Drawn and Distributed on a partner's dashboard,
 * and only a settled row writes an activity line and an email.
 */
import { z } from "zod";
import { createHandler } from "./_lib/handler.js";
import { INVESTOR_ROLES, PARTNER_MANAGERS } from "./_lib/authz.js";
import { ForbiddenError, InternalError, NotFoundError } from "../lib/core/errors.js";
import { adminClient } from "../lib/data/supabase/client.js";
import { queueEmail } from "../lib/email/send.js";
import { logActivity, recordAudit, translateGateError } from "./_lib/investor-access.js";

const createSchema = z.object({
  commitment_id: z.string().uuid(),
  type: z.enum(["call", "distribution", "buyback"]),
  amount_pence: z.number().int().positive("An amount is required"),
  txn_date: z.string(),
  due_date: z.string().nullable().optional(),
  settled: z.boolean().optional(),
  evidence_link: z.string().nullable().optional(),
  cfo_sanction_ref: z.string().nullable().optional(),
});

const settleSchema = z.object({
  id: z.string().uuid(),
  settled: z.literal(true),
  evidence_link: z.string().trim().min(1, "An evidence link is required to settle"),
});

export default createHandler({
  methods: ["GET", "POST", "PATCH"],
  requireAuth: true,
  roles: INVESTOR_ROLES,
  handle: async ({ req, body, query, user }) => {
    const db = adminClient();

    if (req.method === "GET") {
      const commitmentId = (query as any)?.commitment_id as string | undefined;
      let q = db
        .from("capital_transactions")
        .select("*, commitments(id, investor_id, deal_id)")
        .order("txn_date", { ascending: false });
      if (commitmentId) q = q.eq("commitment_id", commitmentId);
      const { data, error } = await q;
      if (error) throw new InternalError(`capital_transactions: ${error.message}`);
      return { rows: data ?? [], total: data?.length ?? 0 };
    }

    if (!user || !PARTNER_MANAGERS.includes(user.role)) {
      throw new ForbiddenError("Recording a capital transaction requires an admin or CFO role");
    }

    if (req.method === "PATCH") {
      const input = settleSchema.parse(body ?? {});
      const { data: before } = await db
        .from("capital_transactions")
        .select("*")
        .eq("id", input.id)
        .maybeSingle();
      if (!before) throw new NotFoundError("Transaction not found");
      if (before.settled) return before;

      const { data: updated, error } = await db
        .from("capital_transactions")
        .update({ settled: true, settled_at: new Date().toISOString(), evidence_link: input.evidence_link })
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw translateGateError(error.message);

      await announceSettlement(updated);
      await recordAudit({
        action: "SETTLE_CAPITAL_TRANSACTION",
        entityId: updated.id,
        entityType: "capital_transactions",
        actor: user,
        details: `Settled ${updated.type}`,
        oldValue: before,
        newValue: updated,
      });
      return updated;
    }

    // POST
    const input = createSchema.parse(body ?? {});
    const { data: created, error } = await db
      .from("capital_transactions")
      .insert({
        ...input,
        created_by: user.id,
        settled_at: input.settled ? new Date().toISOString() : null,
      })
      .select("*")
      .single();
    if (error) throw translateGateError(error.message);

    if (created.settled) await announceSettlement(created);
    await recordAudit({
      action: "CREATE_CAPITAL_TRANSACTION",
      entityId: created.id,
      entityType: "capital_transactions",
      actor: user,
      details: `Recorded ${created.type} of ${created.amount_pence} pence`,
      newValue: created,
    });
    return created;
  },
});

/**
 * Write the partner's activity line and queue their email for a settled row.
 *
 * The feed carries the figure; the email carries it only for a call or a
 * distribution, which is the one place the spec permits an amount to leave the
 * portal (rule R8).
 */
async function announceSettlement(txn: any): Promise<void> {
  if (!["call", "distribution"].includes(txn.type)) return;
  const db = adminClient();

  const { data: commitment } = await db
    .from("commitments")
    .select("investor_id, deal_id, investors(name, email), deals(partner_display_name)")
    .eq("id", txn.commitment_id)
    .maybeSingle();
  if (!commitment) return;

  const investor = (commitment as any).investors;
  const dealName = (commitment as any).deals?.partner_display_name ?? null;
  const eventType = txn.type === "call" ? "call_settled" : "distribution";

  await logActivity(commitment.investor_id, commitment.deal_id, eventType, {
    amount_pence: txn.amount_pence,
    date: txn.txn_date,
    deal: dealName,
  });

  if (investor?.email) {
    await queueEmail({
      investorId: commitment.investor_id,
      template: txn.type === "call" ? "call_settled" : "distribution",
      to: investor.email,
      payload: { name: investor.name, amount_pence: txn.amount_pence, date: txn.txn_date },
    });
  }
}
