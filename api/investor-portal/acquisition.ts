/**
 * GET /api/investor-portal/acquisition?deal_key=… — one held acquisition, with
 * everything its five tabs need.
 *
 * deal_key is the deal's uuid and never a CFS code. If the partner does not
 * hold this deal the whitelist view returns nothing and this 404s, which is the
 * same answer they would get for a deal that does not exist — no probing.
 *
 * Coverage is returned as a status word and its history. The ratio itself stays
 * in the covenant certificate, which is the only place it is certified.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { InternalError, NotFoundError } from "../../lib/core/errors.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { resolveInvestorScope } from "../_lib/investor-context.js";

const querySchema = z.object({
  deal_key: z.string().uuid("An acquisition id is required"),
  investor_id: z.string().uuid().optional(),
});

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ query, user }) => {
    const { deal_key, investor_id } = querySchema.parse(query ?? {});
    const scope = await resolveInvestorScope(user, investor_id);
    const db = adminClient();

    const { data: acquisition, error } = await db
      .from("partner_deal_view")
      .select("*")
      .eq("investor_id", scope.investorId)
      .eq("deal_key", deal_key)
      .maybeSingle();
    if (error) throw new InternalError(`partner_deal_view: ${error.message}`);
    if (!acquisition) throw new NotFoundError("Acquisition not found");

    const [documents, reports, transactions, coverage] = await Promise.all([
      db
        .from("partner_documents")
        .select("*")
        .eq("investor_id", scope.investorId)
        .eq("deal_key", deal_key)
        .order("published_at", { ascending: false, nullsFirst: false }),
      db
        .from("partner_reports")
        .select("*")
        .eq("investor_id", scope.investorId)
        .eq("deal_key", deal_key)
        .order("publishes_on", { ascending: false }),
      db
        .from("partner_capital_transactions")
        .select("*")
        .eq("investor_id", scope.investorId)
        .eq("deal_key", deal_key)
        .order("txn_date", { ascending: false }),
      // Status words and when they changed. The internal basis note is not
      // selected — it is an admin's working, not a partner's record.
      db
        .from("dscr_status_history")
        .select("status, set_at")
        .eq("deal_id", deal_key)
        .order("set_at", { ascending: false })
        .limit(12),
    ]);

    return {
      acquisition,
      documents: documents.data ?? [],
      reports: reports.data ?? [],
      transactions: transactions.data ?? [],
      coverage_history: coverage.data ?? [],
    };
  },
});
