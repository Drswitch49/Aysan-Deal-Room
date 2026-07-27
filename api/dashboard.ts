/**
 * GET /api/dashboard?owner=… — the command-centre metrics DashboardPage renders.
 * Assembles counts, stage distribution, recent movements (audit log),
 * actions-due, and pipeline insights from Supabase in one call.
 */
import { createHandler } from "./_lib/handler.js";
import { adminClient } from "../lib/data/supabase/client.js";
import { InternalError } from "../lib/core/errors.js";

type Row = Record<string, any>;

/** Map a free-text pipeline_stage label to one of the funnel buckets. */
function bucketOf(stage: string | null | undefined): "inbound" | "sellerCall" | "imReview" | "dueDiligence" | "other" {
  const s = (stage ?? "").toLowerCase();
  if (/(intro|inbound|new|lead)/.test(s)) return "inbound";
  if (/(seller|discovery|call)/.test(s)) return "sellerCall";
  if (/(im|review|loi)/.test(s)) return "imReview";
  if (/(due|diligence|dd|closing)/.test(s)) return "dueDiligence";
  return "other";
}

function initialsOf(name: string): string {
  return (name || "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ query }) => {
    const db = adminClient();
    const owner = ((query as Row)?.owner ?? "").toString().trim();

    // Lifecycle counts (per-stage count queries — not row-capped).
    const stageCount = async (stage: string) => {
      const { count, error } = await db.from("deals").select("*", { count: "exact", head: true }).is("deleted_at", null).eq("stage", stage);
      if (error) throw new InternalError(`dashboard count(${stage}): ${error.message}`);
      return count ?? 0;
    };
    const [inboxDealsCount, reviewDealsCount, activePipelineCount] = await Promise.all([
      stageCount("inbox"),
      stageCount("review"),
      stageCount("active"),
    ]);

    // Active deals (bounded) for distribution + insights + actions.
    let activeQ = db
      .from("deals")
      .select("id, acp_ref_no, ref_no, company_name, deal_name, pipeline_stage, owner, analyst, assigned_to, enterprise_value, total_score, next_action, next_action_date")
      .is("deleted_at", null)
      .eq("stage", "active")
      .limit(500);
    if (owner && owner !== "All") activeQ = activeQ.or(`owner.eq.${owner},analyst.eq.${owner},assigned_to.eq.${owner}`);
    const { data: active, error: activeErr } = await activeQ;
    if (activeErr) throw new InternalError(`dashboard active: ${activeErr.message}`);
    const activeDeals = (active ?? []) as Row[];

    const stageDistribution = { inbound: 0, sellerCall: 0, imReview: 0, dueDiligence: 0 };
    let totalEV = 0;
    let scoreSum = 0, scoreN = 0;
    for (const d of activeDeals) {
      const b = bucketOf(d.pipeline_stage);
      if (b !== "other") stageDistribution[b]++;
      if (typeof d.enterprise_value === "number") totalEV += d.enterprise_value;
      if (typeof d.total_score === "number") { scoreSum += d.total_score; scoreN++; }
    }

    // Active chat conversations (distinct deals with messages).
    const { data: chatRows } = await db.from("chat_messages").select("deal_id").limit(1000);
    const activeConversations = new Set((chatRows ?? []).map((c: Row) => c.deal_id)).size;

    const pipelineInsights = {
      totalEV,
      avgDealScore: scoreN ? Math.round((scoreSum / scoreN) * 10) / 10 : 0,
      activeConversations,
      avgVelocityDays: 0, // requires stage-dwell history; surfaced as "—" until wired
    };

    // Actions due (deals with a next_action on/before today).
    const today = new Date().toISOString().slice(0, 10);
    const actionsDueToday = activeDeals
      .filter((d) => d.next_action_date && String(d.next_action_date).slice(0, 10) <= today && d.next_action)
      .slice(0, 12)
      .map((d) => {
        const overdue = String(d.next_action_date).slice(0, 10) < today;
        return {
          id: d.id,
          link: `/deals/${d.acp_ref_no || d.ref_no || d.id}`,
          title: d.next_action || "Follow up",
          dealRef: d.acp_ref_no || d.ref_no || "",
          assignee: d.owner || d.analyst || d.assigned_to || "Unassigned",
          statusText: overdue ? "OVERDUE" : "DUE TODAY",
          color: overdue ? "red" : "amber",
          dateStr: String(d.next_action_date).slice(0, 10),
        };
      });

    // Recent movements from the audit log.
    const { data: audit } = await db
      .from("audit_logs")
      .select("id, action, event_type, entity_id, details, occurred_at, operator")
      .order("occurred_at", { ascending: false })
      .limit(12);
    const recentMovements = (audit ?? []).map((a: Row) => {
      const action = String(a.action ?? a.event_type ?? "").toUpperCase();
      let type = "update";
      if (action.includes("LOI")) type = "loi_sent";
      else if (action.includes("DILIGENCE") || action.includes("DD")) type = "dd_started";
      else if (action.includes("ARCHIVE") || action.includes("KILL")) type = "deal_archived";
      else if (action.includes("LENDER") || action.includes("ASSIGN")) type = "lender_engaged";
      else if (action.includes("DOCUMENT") || action.includes("UPLOAD")) type = "im_received";
      return {
        id: a.id,
        type,
        title: a.details || action.toLowerCase() || "Activity",
        detail: a.operator || "",
        companyName: "",
        timestamp: a.occurred_at || "",
        link: a.entity_id ? `/deals/${a.entity_id}` : "",
      };
    });

    // Owner filter options.
    const uniqueOwners = Array.from(
      new Set(activeDeals.map((d) => d.owner || d.analyst || d.assigned_to).filter(Boolean)),
    ) as string[];

    return {
      inboxDealsCount,
      reviewDealsCount,
      activePipelineCount,
      pendingActionsCount: actionsDueToday.length,
      stageDistribution,
      pipelineInsights,
      actionsDueToday,
      recentMovements,
      uniqueOwners,
      _owner: owner,
      _initials: uniqueOwners.map(initialsOf),
    };
  },
});
