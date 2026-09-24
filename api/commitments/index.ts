/**
 * /api/commitments — capital partner commitments against a deal.
 *
 * A commitment starts pending and is completed once, with the ownership in
 * basis points set at completion. From then on it is locked: the database
 * refuses any edit to the money, the ownership, the deal or the partner, and
 * allows only the lifecycle moves (converted, bought back). That lock is the
 * reason the portal can present these figures as actuals.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { INVESTOR_ROLES, PARTNER_MANAGERS } from "../_lib/authz.js";
import { ForbiddenError, InternalError, NotFoundError } from "../../lib/core/errors.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { recordAudit, translateGateError } from "../_lib/investor-access.js";

const createSchema = z.object({
  investor_id: z.string().uuid(),
  deal_id: z.string().uuid(),
  /** Pence. Integer by construction — no floats in the money path. */
  committed_pence: z.number().int().positive("A commitment must be more than zero"),
  instrument: z.string().optional(),
});

const querySchema = z.object({
  investor_id: z.string().uuid().optional(),
  deal_id: z.string().uuid().optional(),
});

export default createHandler({
  methods: ["GET", "POST"],
  requireAuth: true,
  roles: INVESTOR_ROLES,
  handle: async ({ req, body, query, user }) => {
    const db = adminClient();

    if (req.method === "GET") {
      const filters = querySchema.parse(query ?? {});
      let q = db
        .from("commitments")
        .select("*, investors(id, name, email), deals(id, partner_display_name, acp_ref_no, company_name), capital_transactions(*)")
        .order("created_at", { ascending: false });
      if (filters.investor_id) q = q.eq("investor_id", filters.investor_id);
      if (filters.deal_id) q = q.eq("deal_id", filters.deal_id);

      const { data, error } = await q;
      if (error) throw new InternalError(`commitments: ${error.message}`);
      return { rows: data ?? [], total: data?.length ?? 0 };
    }

    // POST
    if (!user || !PARTNER_MANAGERS.includes(user.role)) {
      throw new ForbiddenError("Recording a commitment requires an admin or CFO role");
    }
    const input = createSchema.parse(body ?? {});

    const { data: investor } = await db
      .from("investors")
      .select("id, name, status")
      .eq("id", input.investor_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!investor) throw new NotFoundError("Capital partner not found");

    const { data: created, error } = await db
      .from("commitments")
      .insert({ ...input, status: "pending" })
      .select("*")
      .single();
    if (error) throw translateGateError(error.message);

    await db.from("investors").update({ status: "committed" }).eq("id", input.investor_id);

    await recordAudit({
      action: "CREATE_COMMITMENT",
      entityId: created.id,
      entityType: "commitments",
      actor: user,
      details: `Commitment recorded for ${investor.name}`,
      newValue: created,
    });

    return created;
  },
});
