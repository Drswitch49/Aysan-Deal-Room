import { useState, useMemo, useEffect } from "react";
import { BriefcaseBusiness, FolderOpen, FileWarning, Send, Database, Search, Users, Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useDealListRows } from "../hooks/useDealRoomData";
import { StatusBadge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";
import { cx } from "../utils/cx";
import { fetchAdminLenders } from "../api/admin";

const PIPELINE_STAGES = [
  "Intro",
  "IM Review",
  "Information Requested",
  "Offer Submitted",
  "Seller Call",
  "Killed"
];

export function DealListPage() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { data, error, isLoading } = useDealListRows(refreshTrigger);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [viewMode, setViewMode] = useState<"pipeline" | "registry">("pipeline");
  const [lendersCount, setLendersCount] = useState<number | null>(null);

  // Card folding state
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchAdminLenders()
      .then((lenders) => {
        setLendersCount(lenders.length);
      })
      .catch((err) => {
        console.error("Failed to fetch lenders count:", err);
      });
  }, []);


  const activeDealCount = data?.length ?? 0;
  const outstandingCount = data?.reduce((total, row) => total + row.outstandingDocumentCount, 0) ?? 0;

  const categories = useMemo(() => {
    if (!data) return [];
    const counts: Record<string, number> = {};
    data.forEach(({ deal }) => {
      const status = deal.status || "Unknown";
      counts[status] = (counts[status] || 0) + 1;
    });

    const uniqueStatuses = Object.keys(counts).sort();

    return [
      { name: "All", count: data.length },
      ...uniqueStatuses.map((status) => ({
        name: status,
        count: counts[status],
      })),
    ];
  }, [data]);

  const pipelineStages = useMemo(() => {
    const stagesSet = new Set(PIPELINE_STAGES.map(s => s.toLowerCase()));
    const finalStages = [...PIPELINE_STAGES];
    
    let hasUnknown = false;
    if (data) {
      data.forEach(({ deal }) => {
        const status = deal.status;
        if (status) {
          if (!stagesSet.has(status.toLowerCase())) {
            finalStages.push(status);
            stagesSet.add(status.toLowerCase());
          }
        } else {
          hasUnknown = true;
        }
      });
    }
    if (hasUnknown) {
      finalStages.push("Unknown");
    }
    return finalStages;
  }, [data]);

  const filteredData = useMemo(() => {
    if (!data) return [];

    let result = data;
    
    // In registry mode, we apply the category pill filter
    if (viewMode === "registry" && selectedCategory !== "All") {
      result = data.filter(({ deal }) => {
        const status = deal.status || "";
        return status.toLowerCase() === selectedCategory.toLowerCase();
      });
    }

    if (!searchQuery.trim()) return result;
    const query = searchQuery.toLowerCase().trim();
    return result.filter(({ deal }) => {
      const dealRef = String(deal.dealRef || "").toLowerCase();
      const companyName = String(deal.companyName || "").toLowerCase();
      const status = String(deal.status || "").toLowerCase();
      const sector = String(deal.sector || "").toLowerCase();
      const location = String(deal.location || "").toLowerCase();

      return dealRef.includes(query) ||
             companyName.includes(query) ||
             status.includes(query) ||
             sector.includes(query) ||
             location.includes(query);
    });
  }, [data, selectedCategory, searchQuery, viewMode]);

  const stageDeals = useMemo(() => {
    const map: Record<string, typeof filteredData> = {};
    pipelineStages.forEach(stage => {
      map[stage] = filteredData.filter(({ deal }) => 
        (deal.status || "Unknown").toLowerCase() === stage.toLowerCase()
      );
    });
    return map;
  }, [filteredData, pipelineStages]);

  const handleToggleViewMode = () => {
    const nextMode = viewMode === "pipeline" ? "registry" : "pipeline";
    setViewMode(nextMode);
    
    if (nextMode === "pipeline") {
      setSearchQuery("");
      setSelectedCategory("All");
    }
    
    setTimeout(() => {
      const element = document.getElementById("pipeline-registry");
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
  };

  return (
    <div className="space-y-8 animate-fade-in-up">
      <DealRoomHero viewMode={viewMode} onToggleViewMode={handleToggleViewMode} />

      {isLoading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!isLoading && !error && data?.length === 0 ? (
        <EmptyState title="No active deals" message="No active deals are available to display." />
      ) : null}

      {!isLoading && !error && data && data.length > 0 ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard 
              icon={<BriefcaseBusiness className="h-5 w-5" />} 
              label="Active deals" 
              value={activeDealCount} 
              iconBgClass="bg-[#C5A059]"
            />
            <MetricCard 
              icon={<Users className="h-5 w-5" />} 
              label="Registered Lenders" 
              value={lendersCount !== null ? lendersCount : "..."} 
              iconBgClass="bg-[#C5A059]"
            />
            <MetricCard 
              icon={<FolderOpen className="h-5 w-5" />} 
              label="Total indexed documents" 
              value={outstandingCount} 
              iconBgClass="bg-[#C5A059]"
            />
          </div>

          <div id="pipeline-registry" className="scroll-mt-6">
            <div className="mb-6 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-black uppercase tracking-wider text-white">Pipeline Registry</h2>
                  <span className="rounded-full bg-white/5 border border-white/10 px-2.5 py-0.5 text-[10px] font-bold text-slate-400">
                    {filteredData.length} {filteredData.length === 1 ? "Result" : "Results"}
                  </span>
                </div>
                
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">

                  {/* View Mode Segment Switch */}
                  <div className="inline-flex rounded-xl border border-white/5 bg-[#0D0D0E] p-1 shadow-inner self-start sm:self-auto">
                    <button
                      onClick={() => {
                        setViewMode("pipeline");
                        setSearchQuery("");
                      }}
                      className={cx(
                        "px-3.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all duration-300 cursor-pointer",
                        viewMode === "pipeline"
                          ? "bg-white/10 text-white shadow-sm"
                          : "text-slate-450 hover:text-white"
                      )}
                      type="button"
                    >
                      Pipeline
                    </button>
                    <button
                      onClick={() => setViewMode("registry")}
                      className={cx(
                        "px-3.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all duration-300 cursor-pointer",
                        viewMode === "registry"
                          ? "bg-white/10 text-white shadow-sm"
                          : "text-slate-450 hover:text-white"
                      )}
                      type="button"
                    >
                      Registry
                    </button>
                  </div>

                  <div className="relative w-full sm:max-w-xs">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search deals..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-9 w-full rounded-xl border border-white/10 bg-[#0d0c1d] pl-9 pr-4 text-xs text-white placeholder-slate-500 outline-none transition-all duration-300 focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze"
                    />
                  </div>
                </div>
              </div>

              {/* Dynamic Status Category Pills - Only show in Registry mode */}
              {viewMode === "registry" && (
                <div className="flex flex-wrap gap-2 py-1">
                  {categories.map((category) => {
                    const isActive = selectedCategory === category.name;
                    return (
                      <button
                        key={category.name}
                        onClick={() => setSelectedCategory(category.name)}
                        className={cx(
                          "inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all duration-200 border cursor-pointer",
                          isActive
                            ? "bg-gradient-to-r from-[#C5A059] to-[#C5A059] text-white border-transparent shadow-[0_4px_12px_rgba(197,160,89,0.15)] scale-[1.02]"
                            : "bg-[#0D0D0E] hover:bg-[#15132d] text-slate-400 hover:text-white border-white/[0.06] hover:border-white/12"
                        )}
                      >
                        <span>{category.name}</span>
                        <span
                          className={cx(
                            "inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-black",
                            isActive ? "bg-white/20 text-white" : "bg-white/5 text-slate-500"
                          )}
                        >
                          {category.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {viewMode === "pipeline" ? (
              /* Pipeline (Kanban) View */
              <div className="space-y-6">
                {pipelineStages.map((stage) => {
                  const dealsInStage = stageDeals[stage] || [];
                  const isExpanded = !!expandedStages[stage];
                  const visibleDeals = isExpanded ? dealsInStage : dealsInStage.slice(0, 2);
                  
                  let stageTheme = {
                    border: "border-l-blue-500",
                    bg: "bg-blue-500/10",
                    text: "text-blue-400"
                  };
                  if (stage.toLowerCase() === "im review") {
                    stageTheme = { border: "border-l-indigo-500", bg: "bg-indigo-500/10", text: "text-indigo-400" };
                  } else if (stage.toLowerCase() === "information requested") {
                    stageTheme = { border: "border-l-amber-500", bg: "bg-amber-500/10", text: "text-amber-400" };
                  } else if (stage.toLowerCase() === "offer submitted") {
                    stageTheme = { border: "border-l-emerald-500", bg: "bg-emerald-500/10", text: "text-emerald-400" };
                  } else if (stage.toLowerCase() === "seller call") {
                    stageTheme = { border: "border-l-pink-500", bg: "bg-pink-500/10", text: "text-pink-400" };
                  } else if (stage.toLowerCase() === "killed") {
                    stageTheme = { border: "border-l-rose-500", bg: "bg-rose-500/10", text: "text-rose-400" };
                  } else {
                    // Fallback for new stages/statuses added dynamically
                    stageTheme = { border: "border-l-acp-bronze", bg: "bg-acp-bronze/10", text: "text-acp-bronze" };
                  }

                  return (
                    <div
                      key={stage}
                      className={cx(
                        "rounded-2xl border border-white/[0.06] bg-[#0D0D0E]/65 backdrop-blur-md p-5 space-y-4 shadow-sm border-l-4",
                        stageTheme.border
                      )}
                    >
                      <div className="flex items-center justify-between pb-2 border-b border-white/[0.04]">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black uppercase tracking-wider text-white">
                            {stage}
                          </span>
                          <span className={cx("rounded-full px-2.5 py-0.5 text-[10px] font-bold", stageTheme.bg, stageTheme.text)}>
                            {dealsInStage.length} {dealsInStage.length === 1 ? "deal" : "deals"}
                          </span>
                        </div>
                      </div>

                      {dealsInStage.length === 0 ? (
                        <p className="text-xs text-slate-500 font-medium py-1">No deals in this stage</p>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex flex-wrap gap-4">
                            {visibleDeals.map(({ deal, outstandingDocumentCount, daysSinceLastLenderContact }) => {
                              const execName = deal.lenderAssigned || "Executive Manager";
                              const execInitials = execName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
                              
                              const brokerName = deal.broker || "Sponsor Broker";
                              const brokerInitials = brokerName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

                              return (
                                <Link
                                  key={deal.id}
                                  to={`/deals/${encodeURIComponent(deal.dealRef)}`}
                                  className="group block relative overflow-hidden rounded-xl border border-white/[0.04] bg-[#0c1122]/40 p-4 shadow-sm transition-all duration-300 hover:border-acp-bronze/30 hover:bg-[#0c1122]/80 hover:-translate-y-0.5 card-sheen flex-1 min-w-[280px]"
                                >
                                  <div className="min-w-0">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-acp-bronze">
                                      {deal.dealRef || "Missing Ref"}
                                    </span>
                                    <h4 className="mt-1 text-xs font-bold text-white tracking-wide truncate group-hover:text-acp-bronze transition-colors">
                                      {deal.companyName || "Not specified"}
                                    </h4>
                                    <p className="mt-1 text-[10px] text-slate-450 truncate">
                                      {deal.sector || "General"} • {deal.location || "UK"}
                                    </p>
                                  </div>

                                  <div className="mt-3.5 pt-2.5 border-t border-white/[0.04] flex items-center justify-between gap-2">
                                    <div className="flex gap-2.5 text-[9px] text-slate-400 font-semibold">
                                      <div>
                                        <span className="text-slate-500">Files:</span> <span className="text-white font-bold">{outstandingDocumentCount}</span>
                                      </div>
                                      <div className="border-l border-white/5 pl-2.5">
                                        <span className="text-slate-500">Contact:</span> <span className="text-white font-bold">{daysSinceLastLenderContact === null ? "None" : `${daysSinceLastLenderContact}d`}</span>
                                      </div>
                                    </div>

                                    {/* Overlapping avatars */}
                                    <div className="flex -space-x-1 overflow-hidden">
                                      <div 
                                        className="inline-flex h-5.5 w-5.5 items-center justify-center rounded-full bg-blue-500/10 border border-blue-500/20 text-[8px] font-bold text-blue-400 shadow-sm"
                                        title={`Assigned Executive: ${execName}`}
                                      >
                                        {execInitials}
                                      </div>
                                      <div 
                                        className="inline-flex h-5.5 w-5.5 items-center justify-center rounded-full bg-acp-bronze/10 border border-acp-bronze/20 text-[8px] font-bold text-acp-bronze shadow-sm"
                                        title={`Sponsoring Broker: ${brokerName}`}
                                      >
                                        {brokerInitials}
                                      </div>
                                    </div>
                                  </div>
                                </Link>
                              );
                            })}
                          </div>
                          {dealsInStage.length > 2 && (
                            <div className="flex justify-start">
                              <button
                                type="button"
                                onClick={() => setExpandedStages(prev => ({ ...prev, [stage]: !prev[stage] }))}
                                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl bg-white/5 border border-white/10 px-3 text-[10px] font-black uppercase tracking-wider text-slate-350 hover:bg-white/10 hover:text-white cursor-pointer transition-all duration-200"
                              >
                                {isExpanded ? "Show Less" : `View More (${dealsInStage.length - 2} more)`}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Registry (Grid) View */
              filteredData.length === 0 ? (
                <div className="rounded-2xl border border-white/[0.06] bg-[#0D0D0E] p-12 text-center shadow-premium-card card-sheen">
                  <Search className="mx-auto h-8 w-8 text-slate-500 mb-3" />
                  <p className="text-xs font-bold text-slate-350">No matching deals found</p>
                  <p className="text-[10px] text-slate-450 mt-1">Try resetting your search query.</p>
                </div>
              ) : (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredData.map(({ deal, outstandingDocumentCount, daysSinceLastLenderContact }) => {
                    const execName = deal.lenderAssigned || "Executive Manager";
                    const execInitials = execName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
                    
                    const brokerName = deal.broker || "Sponsor Broker";
                    const brokerInitials = brokerName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

                    return (
                      <Link
                        key={deal.id}
                        to={`/deals/${encodeURIComponent(deal.dealRef)}`}
                        className="group block relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0d0c1d] backdrop-blur-md p-6 shadow-premium-card transition-all duration-300 hover:border-acp-bronze/40 hover:bg-[#0D0D0E]/90 hover:shadow-[0_12px_30px_rgba(197,160,89,0.06)] hover:-translate-y-0.5 card-sheen"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-acp-bronze">
                              {deal.dealRef || "Missing Ref"}
                            </span>
                            <h3 className="mt-1 text-sm font-semibold text-white tracking-wide truncate group-hover:text-acp-bronze transition-colors">
                              {deal.companyName || "Not specified"}
                            </h3>
                          </div>
                          <div className="shrink-0">
                            <StatusBadge status={deal.status} />
                          </div>
                        </div>

                        <p className="mt-3.5 text-xs text-slate-400 font-medium line-clamp-2 leading-relaxed">
                          Secure deal room active for {deal.companyName || "this transaction"}. Review documents and checklists.
                        </p>

                        <div className="mt-6 pt-4 border-t border-white/[0.04] flex items-center justify-between gap-4">
                          <div className="flex items-center gap-4">
                            <div className="text-left">
                              <span className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Total Indexed</span>
                              <span className="mt-0.5 block text-xs font-bold text-white">
                                {outstandingDocumentCount} files
                              </span>
                            </div>
                            <div className="text-left border-l border-white/[0.06] pl-4">
                              <span className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Last Contact</span>
                              <span className="mt-0.5 block text-xs font-bold text-white">
                                {daysSinceLastLenderContact === null ? "No contact" : `${daysSinceLastLenderContact}d ago`}
                              </span>
                            </div>
                          </div>

                          <div className="flex -space-x-1.5 overflow-hidden">
                            <div 
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/10 border border-blue-500/20 text-[9px] font-bold text-blue-400 shadow-sm"
                              title={`Assigned Executive: ${execName}`}
                            >
                              {execInitials}
                            </div>
                            <div 
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-acp-bronze/10 border border-acp-bronze/20 text-[9px] font-bold text-acp-bronze shadow-sm"
                              title={`Sponsoring Broker: ${brokerName}`}
                              >
                              {brokerInitials}
                            </div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}


function DealRoomHero({ 
  viewMode, 
  onToggleViewMode 
}: { 
  viewMode: "pipeline" | "registry"; 
  onToggleViewMode: () => void; 
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-r from-[#C5A059] to-[#A8873F] text-white shadow-[0_20px_50px_rgba(197,160,89,0.15)] card-sheen">
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-[40px] pointer-events-none" />
      
      <div className="absolute right-12 top-1/2 -translate-y-1/2 opacity-10 pointer-events-none hidden lg:block">
        <FolderOpen className="h-32 w-32 text-white" strokeWidth={1} />
      </div>

      <div className="px-6 py-8 sm:px-8 relative z-10">
        <div className="max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.2em] text-white font-sans">
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
            Deal Operations
          </div>
          <h1 className="mt-5 font-heading text-4xl sm:text-[40px] font-black tracking-tight text-white uppercase leading-none">
            Active Deals
          </h1>
          <p className="mt-3.5 text-xs font-semibold leading-relaxed text-slate-100">
            Secure dashboard to review transactions, document checklists, and submission timelines.
          </p>
          <button
            onClick={onToggleViewMode}
            className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-5 text-xs font-black uppercase tracking-wider text-slate-950 shadow-md hover:bg-slate-100 transition-all transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
          >
            {viewMode === "pipeline" ? "View All Deals" : "View Pipeline"}
          </button>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ 
  icon, 
  label, 
  value, 
  iconBgClass 
}: { 
  icon: ReactNode; 
  label: string; 
  value: string | number; 
  iconBgClass: string; 
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#0D0D0E] p-5 shadow-premium-card transition-all duration-300 hover:border-white/15 hover:bg-[#0c1122]/60 hover:-translate-y-0.5 group card-sheen">
      <div className="flex items-center gap-4">
        <div className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-md transition-transform duration-300 group-hover:scale-105", iconBgClass)}>
          {icon}
        </div>
        <div className="min-w-0 font-sans">
          <p className="text-2xl font-bold tracking-tight text-white leading-none">{value}</p>
          <p className="mt-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 truncate">{label}</p>
        </div>
      </div>
    </div>
  );
}
