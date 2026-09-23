/**
 * /api/investors — the Capital Partners registry behind the Stakeholders page.
 *
 * GET returns the list the admin tab renders: who they are, what they have
 * committed, their perimeter flag, certification state and portal status. The
 * committed total is summed here rather than stored, so it can never drift from
 * the commitments that are the record of fact.
 *
 * POST creates a partner directly. The usual route in is adding a stakeholder
 * of type "Investor", which syncs a record through investor-access.ts; this
 * exists for the "+ Add partner" button on the Capital Partners tab itself.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { ALL_STAFF, PARTNER_MANAGERS } from "../_lib/authz.js";
import { ForbiddenError, ConflictError, InternalError } from "../../lib/core/errors.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { isCertifiedNow } from "../_lib/investor-context.js";
import { recordAudit, translateGateError } from "../_lib/investor-access.js";

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("A valid email address is required"),
  type: z.enum(["holdco_equity", "deal_equity", "prospective"]).default("prospective"),
  entity: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  warmth: z.number().int().min(0).max(3).optional(),
  source: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  perimeter_flag: z.boolean().optional(),
  stakeholder_id: z.string().uuid().optional().nullable(),
});

export default createHandler({
  methods: ["GET", "POST"],
  requireAuth: true,
  roles: ALL_STAFF,
  handle: async ({ req, body, user }) => {
    const db = adminClient();

    if (req.method === "GET") {
      const { data, error } = await db
        .from("investors")
        .select(
          "id, stakeholder_id, name, entity, type, email, phone, status, warmth, perimeter_flag, " +
            "certification_status, certification_kind, certification_date, last_touch, staleness_flag, " +
            "pass_reason, pass_category, created_at, " +
            "investor_auth_map(login_mode, last_login_at, terms_accepted_at)",
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw new InternalError(`investors: ${error.message}`);

      const rows = data ?? [];
      const committed = await committedByInvestor(rows.map((r: any) => r.id));

      return {
        rows: rows.map((row: any) => {
          const { investor_auth_map, ...rest } = row;
          // The embedded row comes back as an object or a one-element array
          // depending on how Supabase infers the relationship; flatten both.
          const map = Array.isArray(investor_auth_map) ? investor_auth_map[0] : investor_auth_map;
          return {
            ...rest,
            committed_pence: committed.get(row.id) ?? 0,
            certified_now: isCertifiedNow(row.certification_status, row.certification_date),
            login_mode: map?.login_mode ?? "none",
            last_login_at: map?.last_login_at ?? null,
            terms_accepted_at: map?.terms_accepted_at ?? null,
          };
        }),
        total: rows.length,
      };
    }

    // POST
    if (!user || !PARTNER_MANAGERS.includes(user.role)) {
      throw new ForbiddenError("Creating a capital partner requires an admin or CFO role");
    }
    const input = createSchema.parse(body ?? {});

    const { data: clash } = await db
      .from("investors")
      .select("id")
      .ilike("email", input.email.trim())
      .is("deleted_at", null)
      .maybeSingle();
    if (clash) throw new ConflictError(`A capital partner already exists for ${input.email}`);

    const { data: created, error } = await db
      .from("investors")
      .insert({ ...input, email: input.email.trim(), status: "prospective" })
      .select("*")
      .single();
    if (error) throw translateGateError(error.message);

    const { error: mapErr } = await db
      .from("investor_auth_map")
      .insert({ investor_id: created.id, login_mode: "none" });
    if (mapErr) throw new InternalError(`investor_auth_map: ${mapErr.message}`);

    await recordAudit({
      action: "CREATE_PARTNER",
      entityId: created.id,
      actor: user,
      details: `Created capital partner ${created.name} (${created.email})`,
      newValue: created,
    });

    return created;
  },
});

/** Sum committed pence per investor, excluding bought-back holdings. */
async function committedByInvestor(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const { data, error } = await adminClient()
    .from("commitments")
    .select("investor_id, committed_pence, status")
    .in("investor_id", ids)
    .neq("status", "bought_back");
  if (error) throw new InternalError(`commitments: ${error.message}`);
  for (const row of data ?? []) {
    out.set(row.investor_id, (out.get(row.investor_id) ?? 0) + Number(row.committed_pence ?? 0));
  }
  return out;
}
