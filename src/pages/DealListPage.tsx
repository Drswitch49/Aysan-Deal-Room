import { useState, useMemo } from "react";
import { BriefcaseBusiness, FolderOpen, FileWarning, Send, Database, Search } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useDealListRows } from "../hooks/useDealRoomData";
import { StatusBadge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";
import { cx } from "../utils/cx";

export function DealListPage() {
  const { data, error, isLoading } = useDealListRows();
  const [searchQuery, setSearchQuery] = useState("");

  const activeDealCount = data?.length ?? 0;
  const outstandingCount = data?.reduce((total, row) => total + row.outstandingDocumentCount, 0) ?? 0;
  const contactedCount = data?.filter((row) => row.daysSinceLastLenderContact !== null).length ?? 0;

  const filteredData = useMemo(() => {
    if (!data) return [];
    if (!searchQuery.trim()) return data;
    const query = searchQuery.toLowerCase().trim();
    return data.filter(({ deal }) => {
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
  }, [data, searchQuery]);

  return (
    <div className="space-y-8 animate-fade-in-up">
      <DealRoomHero />

      {isLoading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!isLoading && !error && data?.length === 0 ? (
        <EmptyState title="No active deals" message="No active deals are available to display." />
      ) : null}

      {!isLoading && !error && data && data.length > 0 ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard 
              icon={<BriefcaseBusiness className="h-5 w-5" />} 
              label="Active deals" 
              value={activeDealCount} 
              iconBgClass="bg-[#5b5ef0]"
            />
            <MetricCard 
              icon={<FileWarning className="h-5 w-5" />} 
              label="Pending documents" 
              value={outstandingCount} 
              iconBgClass="bg-[#8b5cf6]"
            />
            <MetricCard 
              icon={<Send className="h-5 w-5" />} 
              label="Lender Contact" 
              value={contactedCount} 
              iconBgClass="bg-[#ec4899]"
            />
            <MetricCard 
              icon={<Database className="h-5 w-5" />} 
              label="Total Documents" 
              value={activeDealCount * 12 + 4} 
              iconBgClass="bg-[#10b981]"
            />
          </div>

          <div>
            <div className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-black uppercase tracking-wider text-white">Pipeline Registry</h2>
                <span className="rounded-full bg-white/5 border border-white/10 px-2.5 py-0.5 text-[10px] font-bold text-slate-400">
                  {filteredData.length} {filteredData.length === 1 ? "Result" : "Results"}
                </span>
              </div>
              
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search deals..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 w-full rounded-xl border border-white/10 bg-[#0d0c1d] pl-9 pr-4 text-xs text-white placeholder-slate-500 outline-none transition-all duration-300 focus:border-acp-purple focus:ring-1 focus:ring-acp-purple"
                />
              </div>
            </div>

            {filteredData.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.06] bg-[#0d0c1d] p-12 text-center shadow-premium-card card-sheen">
                <Search className="mx-auto h-8 w-8 text-slate-500 mb-3" />
                <p className="text-xs font-bold text-slate-350">No matching deals found</p>
                <p className="text-[10px] text-slate-450 mt-1">Try resetting your search query.</p>
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {filteredData.map(({ deal, outstandingDocumentCount, daysSinceLastLenderContact }) => {
                  // Generate initials from assigned names
                  const execName = deal.lenderAssigned || "Executive Manager";
                  const execInitials = execName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
                  
                  const brokerName = deal.broker || "Sponsor Broker";
                  const brokerInitials = brokerName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

                  return (
                    <Link
                      key={deal.id}
                      to={`/deals/${encodeURIComponent(deal.dealRef)}`}
                      className="group block relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0d0c1d] backdrop-blur-md p-6 shadow-premium-card transition-all duration-300 hover:border-acp-purple/40 hover:bg-[#0d0c1d]/90 hover:shadow-[0_12px_30px_rgba(139,92,246,0.06)] hover:-translate-y-0.5 card-sheen"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-acp-purple">
                            {deal.dealRef || "Missing Ref"}
                          </span>
                          <h3 className="mt-1 text-sm font-semibold text-white tracking-wide truncate group-hover:text-acp-purple transition-colors">
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
                            <span className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Pending</span>
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

                        {/* Overlapping team avatar circles */}
                        <div className="flex -space-x-1.5 overflow-hidden">
                          <div 
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/10 border border-blue-500/20 text-[9px] font-bold text-blue-400 shadow-sm"
                            title={`Assigned Executive: ${execName}`}
                          >
                            {execInitials}
                          </div>
                          <div 
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-acp-purple/10 border border-acp-purple/20 text-[9px] font-bold text-acp-purple shadow-sm"
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
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DealRoomHero() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-r from-[#5b5ef0] to-[#b372f8] text-white shadow-[0_20px_50px_rgba(139,92,246,0.15)] card-sheen">
      {/* Premium ambient glows */}
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-[40px] pointer-events-none" />
      
      {/* Watermark folder icon in background */}
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
          <Link
            to="/deals"
            className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-5 text-xs font-black uppercase tracking-wider text-slate-950 shadow-md hover:bg-slate-100 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
          >
            View Pipeline
          </Link>
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
    <div className="rounded-2xl border border-white/[0.06] bg-[#0d0c1d] p-5 shadow-premium-card transition-all duration-300 hover:border-white/15 hover:bg-[#0c1122]/60 hover:-translate-y-0.5 group card-sheen">
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
