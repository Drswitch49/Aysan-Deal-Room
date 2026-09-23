/**
 * /api/partner-deal-settings — the partner-facing half of a deal.
 *
 * Deliberately not part of /api/deals/:id, for the same reason the post-call
 * controls are not: these columns decide what a capital partner sees, and one
 * of them has a single author.
 *
 * Coverage status (deals.dscr_status) is written only through
 * `set_dscr_status`, which refuses any role but cfo — Ayo's admin login
 * included. A direct UPDATE refuses too, because the trigger sees no actor.
 * That is rule R4 and acceptance Test 4, and it is why the route has a separate
 * action rather than accepting dscr_status in the PATCH body.
 *
 * The deal's CFS code, name, seller, lender and price appear nowhere here and
 * nowhere in any partner view (rule R3).
 */
import { z } from "zod";
import { createHandler } from "./_lib/handler.js";
import { ALL_STAFF, PARTNER_MANAGERS } from "./_lib/authz.js";
import { ForbiddenError, InternalError, NotFoundError } from "../lib/core/errors.js";
import { adminClient } from "../lib/data/supabase/client.js";
import { recordAudit, translateGateError } from "./_lib/investor-access.js";

const querySchema = z.object({ deal_id: z.string().uuid("A deal id (uuid) is required") });

const patchSchema = z.object({
  deal_id: z.string().uuid(),
  partner_display_name: z.string().nullable().optional(),
  /** Verified contracted revenue share, in basis points. 6100 = 61%. */
  contracted_bp_verified: z.number().int().min(0).max(10000).nullable().optional(),
  amort_status: z.enum(["not_started", "on_schedule", "ahead", "behind"]).optional(),
  next_report_date: z.string().nullable().optional(),
  profile: z
    .object({
      sector: z.string().nullable().optional(),
      region: z.string().nullable().optional(),
      summary: z.string().nullable().optional(),
      customer_types: z.array(z.string()).nullable().optional(),
      headcount_band: z.string().nullable().optional(),
      founded_year: z.number().int().nullable().optional(),
      milestones: z.array(z.object({ date: z.string(), text: z.string() })).optional(),
      legal_review_ref: z.string().nullable().optional(),
    })
    .optional(),
});

const coverageSchema = z.object({
  deal_id: z.string().uuid(),
  action: z.literal("set_coverage"),
  dscr_status: z.enum(["not_yet_reported", "above_floor", "watch", "breach"]),
  basis_note: z.string().nullable().optional(),
});

export default createHandler({
  methods: ["GET", "PATCH", "POST"],
  requireAuth: true,
  roles: ALL_STAFF,
  handle: async ({ req, body, query, user }) => {
    const db = adminClient();

    if (req.method === "GET") {
      const { deal_id } = querySchema.parse(query ?? {});
      const [deal, profile, reports, history, commitments] = await Promise.all([
        db
          .from("deals")
          .select(
            "id, acp_ref_no, company_name, deal_name, partner_display_name, dscr_status, " +
              "contracted_bp_verified, amort_status, next_report_date",
          )
          .eq("id", deal_id)
          .is("deleted_at", null)
          .maybeSingle(),
        db.from("deal_partner_profiles").select("*").eq("deal_id", deal_id).maybeSingle(),
        db.from("deal_reports").select("*").eq("deal_id", deal_id).order("publishes_on", { ascending: false }),
        db
          .from("dscr_status_history")
          .select("*")
          .eq("deal_id", deal_id)
          .order("set_at", { ascending: false })
          .limit(20),
        db
          .from("commitments")
          .select("id, status, committed_pence, ownership_bp, investors(id, name)")
          .eq("deal_id", deal_id),
      ]);
      if (!deal.data) throw new NotFoundError("Deal not found");

      return {
        deal: deal.data,
        profile: profile.data ?? null,
        reports: reports.data ?? [],
        coverage_history: history.data ?? [],
        commitments: commitments.data ?? [],
        /** The UI disables the control rather than letting it fail at the gate. */
        can_set_coverage: user?.role === "cfo",
      };
    }

    if (!user || !PARTNER_MANAGERS.includes(user.role)) {
      throw new ForbiddenError("Partner-facing deal settings require an admin or CFO role");
    }

    if (req.method === "POST") {
      const input = coverageSchema.parse(body ?? {});
      const { error } = await db.rpc("set_dscr_status", {
        p_deal: input.deal_id,
        p_status: input.dscr_status,
        p_basis_note: input.basis_note ?? null,
        p_actor_role: user.role,
        p_actor_email: user.email ?? "",
      });
      if (error) throw translateGateError(error.message);

      await recordAudit({
        action: "SET_COVERAGE_STATUS",
        entityId: input.deal_id,
        entityType: "deals",
        actor: user,
        details: `Coverage status set to ${input.dscr_status}`,
        reason: input.basis_note ?? undefined,
        newValue: { dscr_status: input.dscr_status, basis_note: input.basis_note ?? null },
      });
      return { deal_id: input.deal_id, dscr_status: input.dscr_status };
    }

    // PATCH — display settings. Coverage is not accepted here by design.
    const input = patchSchema.parse(body ?? {});
    const { deal_id, profile, ...dealPatch } = input;

    if (Object.keys(dealPatch).length > 0) {
      const { error } = await db.from("deals").update(dealPatch).eq("id", deal_id);
      if (error) throw translateGateError(error.message);
    }

    if (profile) {
      const { error } = await db
        .from("deal_partner_profiles")
        .upsert({ deal_id, ...profile }, { onConflict: "deal_id" });
      if (error) throw new InternalError(`deal_partner_profiles: ${error.message}`);
    }

    await recordAudit({
      action: "UPDATE_PARTNER_DEAL_SETTINGS",
      entityId: deal_id,
      entityType: "deals",
      actor: user,
      details: "Updated partner-facing deal settings",
      newValue: input,
    });

    return { deal_id, updated: true };
  },
});
