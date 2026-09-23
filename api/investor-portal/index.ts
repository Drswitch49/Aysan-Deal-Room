/**
 * GET /api/investor-portal — everything the capital partner dashboard shows.
 *
 * One read: who they are, the four stat cards, their held acquisitions and the
 * five most recent activity lines. Staff may inspect a partner with
 * ?investor_id=…, which resolveInvestorScope permits and a partner cannot.
 *
 * Every figure here is an actual. Committed counts pending and completed
 * commitments; Drawn and Distributed count settled transactions only, because
 * an unsettled call is a request, not money that has moved. There is no IRR,
 * multiple, yield, hold period or projection of any kind, and no column exists
 * to put one in.
 */
import { createHandler } from "../_lib/handler.js";
import { InternalError } from "../../lib/core/errors.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { resolveInvestorScope } from "../_lib/investor-context.js";

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ query, user }) => {
    const scope = await resolveInvestorScope(user, (query as any)?.investor_id);
    const db = adminClient();

    const [commitments, transactions, acquisitions, activity, settings] = await Promise.all([
      db.from("commitments").select("id, deal_id, committed_pence, status").eq("investor_id", scope.investorId),
      db
        .from("partner_capital_transactions")
        .select("type, amount_pence, settled, txn_date, due_date, deal_key")
        .eq("investor_id", scope.investorId),
      db
        .from("partner_deal_view")
        .select("*")
        .eq("investor_id", scope.investorId)
        .order("completed_at", { ascending: false }),
      db
        .from("activity_log")
        .select("id, event_type, payload, created_at, deal_id")
        .eq("investor_id", scope.investorId)
        .order("created_at", { ascending: false })
        .limit(5),
      db.from("portal_settings").select("terms_version").eq("id", true).maybeSingle(),
    ]);

    if (commitments.error) throw new InternalError(`commitments: ${commitments.error.message}`);
    if (acquisitions.error) throw new InternalError(`acquisitions: ${acquisitions.error.message}`);

    const committedPence = (commitments.data ?? [])
      .filter((c: any) => c.status !== "bought_back")
      .reduce((sum: number, c: any) => sum + Number(c.committed_pence ?? 0), 0);

    const settled = (transactions.data ?? []).filter((t: any) => t.settled);
    const drawnPence = sumOf(settled, "call");
    const distributedPence = sumOf(settled, "distribution");

    const heldDealIds = new Set(
      (commitments.data ?? [])
        .filter((c: any) => c.status === "completed" || c.status === "converted")
        .map((c: any) => c.deal_id),
    );

    return {
      partner: {
        name: scope.name,
        email: scope.email,
        status: scope.status,
        certification_status: scope.certificationStatus,
        certification_date: scope.certificationDate,
        certified_now: scope.certifiedNow,
        read_only: scope.readOnly,
        read_only_until: scope.readOnlyUntil,
        terms_version: scope.termsVersion,
        terms_accepted_at: scope.termsAcceptedAt,
        current_terms_version: settings.data?.terms_version ?? 1,
        viewed_by_staff: scope.viewedByStaff,
      },
      summary: {
        committed_pence: committedPence,
        drawn_pence: drawnPence,
        distributed_pence: distributedPence,
        acquisitions: heldDealIds.size,
      },
      acquisitions: acquisitions.data ?? [],
      capital_activity: transactions.data ?? [],
      activity: activity.data ?? [],
    };
  },
});

const sumOf = (rows: any[], type: string): number =>
  rows.filter((t) => t.type === type).reduce((sum, t) => sum + Number(t.amount_pence ?? 0), 0);
