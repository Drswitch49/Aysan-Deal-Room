import { useState, useEffect, useMemo } from "react";
import { 
  Plus, AlertTriangle, CheckCircle2,
  Kanban, Building2, Clock, MessageSquare,
  FileText, Database, ArrowRight, LineChart
} from "lucide-react";
import { Link } from "react-router-dom";
import { fetchAdminLenders, createAdminDeal, fetchDashboardStats } from "../api/admin";
import { fetchRecentAdminChat } from "../api/chat";
import { usePipeline } from "../context/PipelineContext";
import { StatCard } from "../components/ui/StatCard";
import { Modal } from "../components/ui/Modal";
import { FormField, inputClass, selectClass, textareaClass } from "../components/ui/FormField";
import { LoadingState } from "../components/ui/LoadingState";
import { SectionHeader } from "../components/ui/SectionHeader";
import { cx } from "../utils/cx";

export function DashboardPage() {
  const { refresh: refreshPipeline } = usePipeline();
  
  const [stats, setStats] = useState<any>(null);
  const [lenders, setLenders] = useState<any[]>([]);
  const [chats, setChats] = useState<any[]>([]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedAssignee, setSelectedAssignee] = useState<string>("All");
  const [assignees, setAssignees] = useState<string[]>(["All", "Ayo", "Prince", "Dami", "Chante"]);

  // New deal modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newDealName, setNewDealName] = useState("");
  const [newDealRef, setNewDealRef] = useState("");
  const [newDealStage, setNewDealStage] = useState("Intro");
  const [newDealNextAction, setNewDealNextAction] = useState("");
  const [newDealNextActionDate, setNewDealNextActionDate] = useState("");
  const [isSubmittingDeal, setIsSubmittingDeal] = useState(false);
  const [dealSubmitError, setDealSubmitError] = useState("");

  // Initial Data Fetch
  useEffect(() => {
    setIsLoading(true);
    setError("");

    Promise.all([
      fetchDashboardStats(selectedAssignee),
      fetchAdminLenders().catch(() => []),
      fetchRecentAdminChat().catch(() => [])
    ])
      .then(([statsData, lendersData, chatsData]) => {
        setStats(statsData);
        setLenders(lendersData);
        setChats(chatsData);
        if (statsData.uniqueOwners) {
          setAssignees(statsData.uniqueOwners);
        }
      })
      .catch((err) => {
        console.error("Error loading dashboard stats:", err);
        setError("Failed to load Command Centre metrics.");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [selectedAssignee, refreshTrigger]);

  // Polling for status updates silently (no flashing loading spinner)
  useEffect(() => {
    let intervalId: any;
    
    const pollStats = () => {
      fetchDashboardStats(selectedAssignee)
        .then(statsData => {
          setStats(statsData);
          if (statsData.uniqueOwners) {
            setAssignees(statsData.uniqueOwners);
          }
        })
        .catch(err => {
          console.error("Silent dashboard poll stats failed:", err);
        });
    };

    intervalId = setInterval(pollStats, 12000);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [selectedAssignee]);

  // Client-side unread messages indicator based on local storage last reads
  const unreadMessagesCount = useMemo(() => {
    let unread = 0;
    lenders.forEach((l: any) => {
      const msgs = chats.filter((m) => m.lenderId === l.id && m.sender !== "Admin");
      if (msgs.length === 0) return;

      const msgsByDeal: Record<string, any[]> = {};
      msgs.forEach((m) => {
        if (!msgsByDeal[m.dealId]) msgsByDeal[m.dealId] = [];
        msgsByDeal[m.dealId].push(m);
      });

      const hasAnyUnreadDeal = Object.entries(msgsByDeal).some(([dealId, dealMsgs]) => {
        const lastReadTimeStr = localStorage.getItem(`admin_last_read_${l.id}_${dealId}`) || 
                               localStorage.getItem(`admin_last_read_${l.id}`);
        const lastReadTime = lastReadTimeStr ? new Date(lastReadTimeStr).getTime() : 0;
        return dealMsgs.some((m) => new Date(m.timestamp).getTime() > lastReadTime);
      });

      if (hasAnyUnreadDeal) unread++;
    });
    return unread;
  }, [lenders, chats]);

  // Current Date nicely formatted
  const currentDateString = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }, []);

  // Handle New Deal Submission
  const handleCreateDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    setDealSubmitError("");
    setIsSubmittingDeal(true);

    if (!newDealName.trim()) {
      setDealSubmitError("Deal Name is required.");
      setIsSubmittingDeal(false);
      return;
    }

    try {
      await createAdminDeal({
        dealName: newDealName.trim(),
        acpRefNo: newDealRef.trim() || undefined,
        stage: newDealStage,
        nextAction: newDealNextAction.trim() || undefined,
        nextActionDate: newDealNextActionDate || undefined
      });

      setNewDealName("");
      setNewDealRef("");
      setNewDealStage("Intro");
      setNewDealNextAction("");
      setNewDealNextActionDate("");
      setIsModalOpen(false);
      
      setRefreshTrigger(prev => prev + 1);
      refreshPipeline();
    } catch (err: any) {
      setDealSubmitError(err.message || "Failed to create deal.");
    } finally {
      setIsSubmittingDeal(false);
    }
  };



  return (
    <div className="space-y-8 animate-fade-in-up">
      {/* Top Header Block */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-6 border-b border-white/[0.02]">
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#C6A66B] select-none">
            ACP Deal Intelligence
          </p>
          <h1 className="font-heading text-2xl font-bold text-white uppercase tracking-tight leading-none select-none">
            Command Centre
          </h1>
          <div className="flex flex-wrap items-center gap-2.5 mt-2 select-none">
            <span className="text-[10px] font-semibold text-slate-500">{currentDateString}</span>
            <span className="text-slate-650">·</span>
            <span className="text-[10px] font-semibold text-slate-500">
              {stats?.pendingActionsCount ?? 0} actions pending
            </span>            <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/5 border border-blue-500/10 px-2.5 py-0.5 text-[9px] font-semibold text-blue-400">
              {stats?.activePipelineCount ?? 0} live
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Owner Filter */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 hidden sm:block select-none">Owner:</span>
            <select
              value={selectedAssignee}
              onChange={(e) => setSelectedAssignee(e.target.value)}
              className="h-8 rounded-xl border border-white/[0.02] bg-[#0B0B0C] px-3.5 text-xs font-semibold text-white outline-none focus:border-[#C6A66B] cursor-pointer shadow-inner hover:border-white/[0.12] transition"
            >
              {assignees.map(a => (
                <option key={a} value={a} className="bg-[#0B0B0C] text-white">{a}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[#C6A66B] hover:bg-[#b5904a] text-slate-950 px-3.5 text-[10px] font-bold uppercase tracking-wider transition cursor-pointer shadow-sm select-none"
          >
            <Plus className="h-3.5 w-3.5 text-slate-950" />
            <span>New Deal</span>
          </button>
        </div>
      </div>

      {isLoading && <LoadingState variant="cards" label="Hydrating Command Centre Telemetry" />}

      {error && (
        <div className="rounded-xl border border-rose-500/10 bg-rose-500/5 p-4 flex items-center gap-3 text-xs font-semibold text-rose-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!isLoading && !error && stats && (
        <div className="space-y-10">
          {unreadMessagesCount > 0 && (
            <div className="rounded-2xl border border-rose-500/10 bg-rose-500/5 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in-up shadow-glow-rose/5 select-none">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500/5 border border-rose-500/15 text-rose-400 shadow-sm animate-pulse">
                  <AlertTriangle className="h-4.5 w-4.5" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-white uppercase tracking-wider">Unread Lender Messages ({unreadMessagesCount})</p>
                  <p className="text-[10px] text-slate-400 mt-1">Lenders have sent new chat messages regarding active deals. Please review the threads in Lender Intel.</p>
                </div>
              </div>
              <Link 
                to="/admin/lenders"
                className="inline-flex h-8 items-center justify-center rounded-xl bg-rose-500 hover:bg-rose-600 px-4 text-[10px] font-bold uppercase tracking-wider text-white transition cursor-pointer self-start sm:self-auto"
              >
                Open Chat Portal
              </Link>
            </div>
          )}

          {/* Row 1 — Operational Telemetry (KPI Strip) */}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Active Pipeline"
              value={stats.activePipelineCount}
              subLabel={`Inbound: ${stats.stageDistribution.inbound} · DD: ${stats.stageDistribution.dueDiligence}`}
              tone="default"
              to="/deals"
            />
            <StatCard
              label="Pending Actions"
              value={stats.pendingActionsCount}
              subLabel="Milestones scheduled"
              tone="bronze"
              to="/deals"
            />
            <StatCard
              label="Deals in Due Diligence"
              value={stats.ddDealsCount}
              subLabel="Late-stage audit"
              tone="default"
              to="/deals"
            />
            <StatCard
              label="LOIs Awaiting Response"
              value={stats.loiTracker?.awaitingResponse ?? 0}
              subLabel="Sent to seller / broker"
              tone="default"
              to="/deals"
            />
          </div>

          {/* Asymmetric Command Grid */}
          <div className="grid gap-8 lg:grid-cols-[1.8fr_1.2fr]">
            {/* Left Column — Command Layer */}
            <div className="space-y-8">
              
              {/* Recent Deal Movements Feed */}
              <div className="rounded-2xl p-6 pe-card">
                <div className="flex items-center justify-between border-b border-white/[0.02] pb-4 mb-4 select-none">
                  <SectionHeader>Recent Deal Progress</SectionHeader>
                </div>

                <div className="divide-y divide-white/[0.02] font-sans">
                  {stats.recentMovements && stats.recentMovements.map((move: any) => {
                    // Muted color dots based on update type
                    let dotColor = "bg-slate-500";
                    if (move.type === "loi_sent") dotColor = "bg-[#C6A66B]";
                    else if (move.type === "dd_started" || move.type === "dd_completed") dotColor = "bg-emerald-500/80";
                    else if (move.type === "deal_archived") dotColor = "bg-rose-500/70";
                    else if (move.type === "lender_engaged") dotColor = "bg-amber-500/70";
                    else if (move.type === "im_received") dotColor = "bg-slate-400";

                    return (
                      <div key={move.id} className="py-3.5 flex items-center justify-between gap-4 first:pt-1 group/move block">
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Minimalist dot instead of icon boxes */}
                          <div className="h-6 w-6 flex items-center justify-center shrink-0">
                            <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                          </div>

                          {/* Status detail */}
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-white leading-normal truncate group-hover/move:text-[#C6A66B] transition-colors">
                              {move.title}
                            </p>
                            <p className="mt-1 text-[10px] text-slate-450 leading-relaxed truncate">
                              {move.detail}
                            </p>
                          </div>
                        </div>

                        {/* Context link */}
                        <div className="flex items-center gap-3 shrink-0 select-none">
                          <div className="text-right">
                            <p className="text-[10px] font-bold text-slate-400 leading-none">
                              {move.companyName}
                            </p>
                            {move.timestamp && (
                              <p className="text-[8px] text-slate-500 mt-1.5 font-medium">
                                {new Date(move.timestamp).toLocaleDateString("en-GB", {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit"
                                })}
                              </p>
                            )}
                          </div>
                          
                          <Link 
                            to={move.link}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.02] bg-white/[0.01] hover:bg-white/[0.03] text-slate-400 hover:text-white transition"
                            title="Open Deal"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </div>
                    );
                  })}

                  {(!stats.recentMovements || stats.recentMovements.length === 0) && (
                    <div className="flex flex-col items-center justify-center py-10 text-center space-y-2 select-none">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-700 animate-pulse" />
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">No recent movements</p>
                      <p className="text-[10px] text-slate-500 max-w-sm leading-relaxed">
                        Transaction flow updates and stage transitions will appear here.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Key Pipeline Insights */}
              <div className="rounded-2xl p-6 pe-card">
                <SectionHeader>Key Pipeline Insights</SectionHeader>
                <div className="mt-5 grid gap-4 grid-cols-2 sm:grid-cols-4 font-sans select-none">
                  <div className="p-4 rounded-xl bg-white/[0.01] border border-white/[0.02]">
                    <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-500">Pipeline Value</p>
                    <p className="text-lg font-semibold text-white mt-1.5">
                      {stats.pipelineInsights?.totalEV 
                        ? (stats.pipelineInsights.totalEV >= 1000000 
                          ? `£${(stats.pipelineInsights.totalEV / 1000000).toFixed(2)}M` 
                          : `£${(stats.pipelineInsights.totalEV / 1000).toFixed(0)}k`) 
                        : "—"}
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-white/[0.01] border border-white/[0.02]">
                    <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-500">Avg Deal Score</p>
                    <p className="text-lg font-semibold text-white mt-1.5">
                      {stats.pipelineInsights?.avgDealScore ? `${stats.pipelineInsights.avgDealScore} / 10` : "—"}
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-white/[0.01] border border-white/[0.02]">
                    <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-500">Seller Chats</p>
                    <p className="text-lg font-semibold text-white mt-1.5">
                      {stats.pipelineInsights?.activeConversations ?? 0} active
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-white/[0.01] border border-white/[0.02]">
                    <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-500">Avg Pipeline Age</p>
                    <p className="text-lg font-semibold text-white mt-1.5">
                      {stats.pipelineInsights?.avgVelocityDays ? `${stats.pipelineInsights.avgVelocityDays} days` : "—"}
                    </p>
                  </div>
                </div>
              </div>

            </div>

            {/* Right Column — Execution & Pipeline */}
            <div className="space-y-8">
              
              {/* Actions Due Today */}
              <div className="rounded-2xl p-6 pe-card">
                <SectionHeader>Actions Due Today</SectionHeader>
                
                <div className="mt-4 divide-y divide-white/[0.02] font-sans">
                  {stats.actionsDueToday && stats.actionsDueToday.map((act: any) => (
                    <Link 
                      key={act.id} 
                      to={act.link}
                      className="py-4 flex items-start gap-4 first:pt-1 group/act block"
                    >
                      {/* Quiet marker left-border or bullet */}
                      <div className={cx(
                        "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
                        act.color === "red" ? "bg-rose-500/70" : "bg-amber-500/70"
                      )} />

                      {/* Action Detail */}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-white leading-tight group-hover/act:text-[#C6A66B] transition-colors truncate">
                          {act.title}
                        </p>
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap select-none text-[9px] font-medium text-slate-500">
                          <span className="font-mono">{act.dealRef}</span>
                          <span className="text-slate-700">·</span>
                          <span>{act.assignee}</span>
                          <span className="text-slate-700">·</span>
                          <span className={cx(
                            "font-bold uppercase tracking-wider",
                            act.statusText === "OVERDUE" ? "text-rose-400" : "text-amber-450"
                          )}>
                            {act.statusText}
                          </span>
                        </div>
                      </div>

                      {/* Deadline label */}
                      <span className="shrink-0 text-[9px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap select-none group-hover/act:text-slate-400 transition-colors pt-0.5">
                        {act.dateStr}
                      </span>
                    </Link>
                  ))}

                  {(!stats.actionsDueToday || stats.actionsDueToday.length === 0) && (
                    <div className="flex flex-col items-center justify-center py-8 text-center space-y-2 select-none">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-750" />
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">No actions due today</p>
                      <p className="text-[10px] text-slate-600">
                        All scheduled milestones and tasks are up to date.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Pipeline Distribution (Stage Funnel) */}
              <div className="rounded-2xl p-6 pe-card">
                <SectionHeader>Pipeline Distribution</SectionHeader>
                
                <div className="mt-5 space-y-4 font-sans">
                  {[
                    { label: "Inbound", count: stats.stageDistribution.inbound, color: "bg-[#717680]/50" },
                    { label: "Seller Call", count: stats.stageDistribution.sellerCall, color: "bg-[#717680]/70" },
                    { label: "IM Review", count: stats.stageDistribution.imReview, color: "bg-[#C6A66B]/80" },
                    { label: "Due Diligence", count: stats.stageDistribution.dueDiligence, color: "bg-emerald-500/60" },
                  ].map(({ label, count, color }) => {
                    const pct = Math.round((count / Math.max(stats.activePipelineCount, 1)) * 100);
                    return (
                      <div key={label} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-slate-400">{label}</span>
                          <div className="flex items-center gap-2 select-none">
                            <span className="text-[10px] font-semibold text-slate-500">{pct}%</span>
                            <span className="text-xs font-bold text-white w-4 text-right">{count}</span>
                          </div>
                        </div>
                        <div className="h-1 w-full bg-white/[0.01] border border-white/[0.02] rounded-full overflow-hidden">
                          <div
                            className={`h-full ${color} rounded-full transition-all duration-700 ease-out`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}


      {/* New Deal Creation Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add New Deal to Pipeline"
      >
        <form onSubmit={handleCreateDeal} className="space-y-4 font-sans">
          {dealSubmitError && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs font-semibold text-rose-400 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {dealSubmitError}
            </div>
          )}

          <FormField label="Deal / Company Name" required id="new-deal-company">
            <input
              id="new-deal-company"
              type="text"
              required
              value={newDealName}
              onChange={(e) => setNewDealName(e.target.value)}
              placeholder="e.g. Acme Manufacturing Ltd"
              className={inputClass}
            />
          </FormField>

          <FormField label="ACP Reference No." id="new-deal-ref">
            <input
              id="new-deal-ref"
              type="text"
              value={newDealRef}
              onChange={(e) => setNewDealRef(e.target.value)}
              placeholder="e.g. ACP-CFS-008"
              className={inputClass}
            />
          </FormField>

          <FormField label="Pipeline Stage" id="new-deal-stage">
            <select
              id="new-deal-stage"
              value={newDealStage}
              onChange={(e) => setNewDealStage(e.target.value)}
              className={selectClass}
            >
              <option value="Intro">Intro</option>
              <option value="IM Review">IM Review</option>
              <option value="Information Requested">Information Requested</option>
              <option value="Offer Submitted">Offer Submitted</option>
              <option value="Seller Call">Seller Call</option>
            </select>
          </FormField>

          <FormField label="Next Action Details" id="new-deal-next-action">
            <textarea
              id="new-deal-next-action"
              value={newDealNextAction}
              onChange={(e) => setNewDealNextAction(e.target.value)}
              placeholder="Describe the immediate next action required..."
              rows={3}
              className={textareaClass}
            />
          </FormField>

          <FormField label="Next Action Target Date" id="new-deal-target-date">
            <input
              id="new-deal-target-date"
              type="date"
              value={newDealNextActionDate}
              onChange={(e) => setNewDealNextActionDate(e.target.value)}
              className={inputClass}
            />
          </FormField>

          <div className="flex justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="h-9 px-4 rounded-xl border border-white/[0.02] text-slate-400 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmittingDeal}
              className="h-9 px-4 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-white text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-bronze transition cursor-pointer"
            >
              {isSubmittingDeal ? "Adding..." : "Add Deal"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
