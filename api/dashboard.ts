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

/**
 * Readable actor name for an audit/history `changed_by`, which stores an email.
 *
 * Prefers the registered team member's name, then a profile's full name, and
 * only falls back to prettifying the address' local part ("admin@yofy.org" →
 * "Admin") — several historic operators have no matching team record at all.
 */
function makeNameResolver(pairs: Array<{ email?: string | null; name?: string | null }>) {
  const byEmail = new Map<string, string>();
  for (const p of pairs) {
    const email = (p.email ?? "").trim().toLowerCase();
    const name = (p.name ?? "").trim();
    if (email && name && !byEmail.has(email)) byEmail.set(email, name);
  }

  return (operator: string | null | undefined): string => {
    const raw = (operator ?? "").trim();
    if (!raw) return "Unknown";
    if (raw === "System") return "System";

    const hit = byEmail.get(raw.toLowerCase());
    if (hit) return hit;

    const local = raw.includes("@") ? raw.split("@")[0] : raw;
    return local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ") || raw;
  };
}

/** A stage-history row links to the deal by uuid, or by a plain legacy ref. */
function movementLink(deal_id: string | null, legacyRef: string | null): string {
  if (deal_id) return `/deals/${deal_id}`;
  // Legacy refs are sometimes a whole descriptive title ("ACP-CFS-005 | Xoli…"),
  // which resolves to nothing — only link when it looks like an actual ref.
  if (legacyRef && /^[A-Za-z0-9-]+$/.test(legacyRef.trim())) return `/deals/${legacyRef.trim()}`;
  return "";
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
    const allDealsCountQ = async () => {
      const { count, error } = await db.from("deals").select("*", { count: "exact", head: true }).is("deleted_at", null);
      if (error) throw new InternalError(`dashboard count(all): ${error.message}`);
      return count ?? 0;
    };

    const [allDealsCount, inboxDealsCount, reviewDealsCount, activePipelineCount] = await Promise.all([
      allDealsCountQ(),
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

    // Actions due in a window around today — 7 days either side.
    // Previously this took anything on/before today, so items weeks overdue
    // crowded out what actually needs attention now; a week either way keeps
    // the list to the current working horizon without hiding the near future.
    const ACTION_WINDOW_DAYS = 7;
    const today = new Date().toISOString().slice(0, 10);
    const dayOffset = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const windowStart = dayOffset(-ACTION_WINDOW_DAYS);
    const windowEnd = dayOffset(ACTION_WINDOW_DAYS);

    const actionsDueToday = activeDeals
      .filter((d) => {
        if (!d.next_action || !d.next_action_date) return false;
        const date = String(d.next_action_date).slice(0, 10);
        return date >= windowStart && date <= windowEnd;
      })
      .sort((a, b) => String(a.next_action_date).localeCompare(String(b.next_action_date)))
      .slice(0, 8)
      .map((d) => {
        // The window spans a fortnight now, so "DUE TODAY" can no longer stand
        // in for everything that isn't overdue — label the three cases apart.
        const date = String(d.next_action_date).slice(0, 10);
        const statusText = date < today ? "OVERDUE" : date === today ? "DUE TODAY" : "UPCOMING";
        return {
          id: d.id,
          link: `/deals/${d.acp_ref_no || d.ref_no || d.id}`,
          title: d.next_action || "Follow up",
          dealRef: d.acp_ref_no || d.ref_no || "",
          assignee: d.owner || d.analyst || d.assigned_to || "Unassigned",
          statusText,
          color: statusText === "OVERDUE" ? "red" : "amber",
          dateStr: date,
        };
      });

    /**
     * Recent movements from deal_stage_history.
     *
     * Not audit_logs: only 3 of ~305 audit rows carry a resolvable entity_id —
     * the rest are Airtable-era records whose `target` holds a rec… id, and the
     * deals table has no airtable_id column to join back on. So every one of
     * those rendered with a blank company and a link to nowhere. Stage history
     * stores deal_id AND company_name, and a transition writes to both tables,
     * so nothing is lost by reading the richer one.
     */
    const RECENT_MOVEMENT_LIMIT = 5;
    const [{ data: history }, { data: team }, { data: profiles }] = await Promise.all([
      db
        .from("deal_stage_history")
        .select("id, deal_id, legacy_deal_ref, company_name, from_stage, to_stage, from_stage_label, to_stage_label, changed_by, changed_at, notes")
        .order("changed_at", { ascending: false })
        .limit(RECENT_MOVEMENT_LIMIT),
      db.from("acp_team").select("name, email"),
      db.from("profiles").select("email, full_name"),
    ]);

    const resolveName = makeNameResolver([
      ...((team ?? []) as Row[]).map((t) => ({ email: t.email, name: t.name })),
      ...((profiles ?? []) as Row[]).map((p) => ({ email: p.email, name: p.full_name })),
    ]);

    // Prefer the deal's current company name over the label frozen into history.
    const historyRows = (history ?? []) as Row[];
    const historyDealIds = historyRows.map((h) => h.deal_id).filter(Boolean) as string[];
    const namesById = new Map<string, string>();
    if (historyDealIds.length) {
      const { data: named } = await db.from("deals").select("id, company_name, deal_name").in("id", historyDealIds);
      for (const d of (named ?? []) as Row[]) namesById.set(d.id, d.company_name || d.deal_name || "");
    }

    const recentMovements = historyRows.map((h) => {
      const to = String(h.to_stage_label || h.to_stage || "").toLowerCase();
      let type = "update";
      if (/(kill|archiv|dead)/.test(to)) type = "deal_archived";
      else if (/(diligence|dd)/.test(to)) type = "dd_started";
      else if (/(loi|offer)/.test(to)) type = "loi_sent";
      else if (/(active|closing)/.test(to)) type = "lender_engaged";
      else if (/(review|im)/.test(to)) type = "im_received";

      const from = h.from_stage_label || h.from_stage || "—";
      const toLabel = h.to_stage_label || h.to_stage || "—";

      return {
        id: h.id,
        type,
        title: `Stage ${from} → ${toLabel}`,
        detail: resolveName(h.changed_by),
        companyName: (h.deal_id ? namesById.get(h.deal_id) : "") || h.company_name || "",
        timestamp: h.changed_at || "",
        link: movementLink(h.deal_id ?? null, h.legacy_deal_ref ?? null),
      };
    });

    // Owner filter options.
    const uniqueOwners = Array.from(
      new Set(activeDeals.map((d) => d.owner || d.analyst || d.assigned_to).filter(Boolean)),
    ) as string[];

    return {
      allDealsCount,
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
