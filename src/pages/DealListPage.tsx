import { useState, useMemo, useEffect } from "react";
import { 
  Search, Filter, Plus, X, AlertTriangle, ChevronLeft, ChevronRight, 
  Database, RefreshCw, FolderOpen, ArrowUpRight, TrendingUp, Sparkles
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { getDeals, getDealInbox, getAllDocuments } from "../api/airtable";
import { fetchAdminLenders, createAdminDeal } from "../api/admin";
import type { PipelineDeal, DealDocument } from "../types/deal";
import { cx } from "../utils/cx";

export function DealListPage() {
  const navigate = useNavigate();
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [inbox, setInbox] = useState<any[]>([]);
  const [documents, setDocuments] = useState<DealDocument[]>([]);
  const [lenders, setLenders] = useState<any[]>([]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Search & Pagination States
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Stage filters selection (All, Inbound, Seller Call, IM Review, DD, Killed)
  const [selectedStageFilter, setSelectedStageFilter] = useState("All");

  // Filter Dropdown State
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // New deal modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newDealName, setNewDealName] = useState("");
  const [newDealRef, setNewDealRef] = useState("");
  const [newDealStage, setNewDealStage] = useState("Intro");
  const [newDealNextAction, setNewDealNextAction] = useState("");
  const [newDealNextActionDate, setNewDealNextActionDate] = useState("");
  const [isSubmittingDeal, setIsSubmittingDeal] = useState(false);
  const [dealSubmitError, setDealSubmitError] = useState("");

  useEffect(() => {
    setIsLoading(true);
    setError("");

    Promise.all([
      getDeals().catch(() => []),
      getDealInbox().catch(() => []),
      getAllDocuments().catch(() => []),
      fetchAdminLenders().catch(() => [])
    ])
      .then(([dealsData, inboxData, docsData, lendersData]) => {
        setDeals(dealsData);
        setInbox(inboxData);
        setDocuments(docsData);
        setLenders(lendersData);
      })
      .catch((err) => {
        console.error("Error loading deal pipeline data:", err);
        setError("Failed to load deal pipeline metrics.");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [refreshTrigger]);

  // Available unique stages for raw items (excluding Killed by default for calculations)
  const stages = useMemo(() => {
    const unique = new Set<string>();
    deals.forEach(d => {
      if (d.status) unique.add(d.status);
    });
    return ["All", ...Array.from(unique)];
  }, [deals]);

  // Clean financial formatting helpers
  const formatFinancial = (val: any): string => {
    if (val === undefined || val === null || val === "" || String(val).toLowerCase() === "tbc") {
      return "TBC";
    }
    const num = Number(val);
    if (isNaN(num)) return String(val);
    if (num >= 1000000) {
      return `£${(num / 1000000).toFixed(1).replace(/\.0$/, "")}m`;
    }
    if (num >= 1000) {
      return `£${(num / 1000).toFixed(0)}k`;
    }
    return `£${num}`;
  };

  const formatMultiplier = (val: any): string => {
    if (val === undefined || val === null || val === "" || String(val).toLowerCase() === "tbc" || String(val) === "—") {
      return "—";
    }
    const num = Number(val);
    if (isNaN(num)) return String(val);
    return `${num.toFixed(1)}x`;
  };

  // Process & Join deals with Inbox data
  const joinedDeals = useMemo(() => {
    return deals.map(d => {
      // Find matching Deal_Inbox record using record link array or ref match
      const inboxRec = inbox.find(i => {
        const dealInboxLinks = d.rawFields["Deal_Inbox"] as any;
        return (dealInboxLinks && 
         Array.isArray(dealInboxLinks) && 
         dealInboxLinks.includes(i.id)) ||
        (i.fields["REF. NO"] && 
         d.dealRef && 
         String(i.fields["REF. NO"]).toLowerCase() === String(d.dealRef).toLowerCase());
      });

      const fields = inboxRec ? inboxRec.fields : {};

      // Match financials
      const revenue = fields["Turnover"] || d.rawFields["Turnover"] || "";
      const ebitda = fields["EBITDA_GBP"] || d.rawFields["EBITDA_GBP"] || "";
      const evAsk = fields["Asking_Price_GBP"] || d.rawFields["Asking_Price_GBP"] || d.rawFields["EV"] || "";
      const multiplier = fields["EV Multiple"] || d.rawFields["EV Multiple"] || d.rawFields["EV"] || "";

      // Sector and Location fallbacks
      const sector = fields["Sector"] || d.sector || "General";
      const location = fields["Location"] || d.location || "UK";

      // Match collaborator
      let ownerName = "Unassigned";
      let ownerInitials = "??";
      const collabs = d.rawFields["Collaborator"] as any;
      if (collabs && Array.isArray(collabs) && collabs.length > 0) {
        ownerName = String(collabs[0]?.name || "Unassigned");
        // Simplify name
        if (ownerName.includes("Ayodeji") || ownerName.includes("Ayo")) {
          ownerName = "Ayo";
        } else if (ownerName.toLowerCase().includes("dami") || ownerName.toLowerCase().includes("dallience")) {
          ownerName = "Dami";
        } else if (ownerName.toLowerCase().includes("chante")) {
          ownerName = "Chante";
        } else if (ownerName.toLowerCase().includes("prince")) {
          ownerName = "Prince";
        }
        ownerInitials = ownerName.slice(0, 2).toUpperCase();
      }

      // Next Action details
      const actionDate = d.rawFields["Next Action Date"];
      const actionText = d.rawFields["Next Action"];
      let nextActionTitle = "Initial Screening";
      let nextActionSub = "Outreach phase";
      let nextActionColor: "red" | "yellow" | "blue" | "green" = "blue";
      
      if (actionDate && actionText) {
        const todayStr = new Date().toISOString().split("T")[0];
        const isOverdue = actionDate < todayStr;
        const isToday = actionDate === todayStr;

        nextActionTitle = String(actionText).split("\n")[0].split("|")[0].split("—")[0].trim();
        nextActionSub = isOverdue ? "Urgent focus" : isToday ? "Chante to update" : "Awaiting callback";
        nextActionColor = isOverdue ? "red" : isToday ? "yellow" : "blue";
      }

      return {
        ...d,
        sector,
        location,
        revenue,
        ebitda,
        evAsk,
        multiplier,
        ownerName,
        ownerInitials,
        nextActionTitle,
        nextActionSub,
        nextActionColor,
        actionDate
      };
    });
  }, [deals, inbox]);

  // Filter & Search Deals
  const filteredDeals = useMemo(() => {
    let result = joinedDeals;

    // Stage filter bar implementation
    if (selectedStageFilter !== "All") {
      if (selectedStageFilter === "Inbound") {
        result = result.filter(d => (d.status || "").toLowerCase() === "intro" || (d.status || "").toLowerCase() === "inbound");
      } else if (selectedStageFilter === "DD") {
        result = result.filter(d => (d.status || "").toLowerCase() === "dd" || (d.status || "").toLowerCase() === "due diligence" || (d.status || "").toLowerCase() === "offer submitted");
      } else {
        result = result.filter(d => (d.status || "").toLowerCase() === selectedStageFilter.toLowerCase());
      }
    } else {
      // Exclude Killed from "All" by default to match dashboard
      result = result.filter(d => (d.status || "").toLowerCase() !== "killed");
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(d => 
        (d.companyName || "").toLowerCase().includes(q) ||
        (d.dealRef || "").toLowerCase().includes(q) ||
        (d.sector || "").toLowerCase().includes(q) ||
        (d.location || "").toLowerCase().includes(q)
      );
    }

    return result;
  }, [joinedDeals, selectedStageFilter, searchQuery]);

  // Active Deals count excluding Killed
  const activeJoinedDeals = useMemo(() => {
    return joinedDeals.filter(d => (d.status || "").toLowerCase() !== "killed");
  }, [joinedDeals]);

  // Pagination Logic
  const totalPages = Math.ceil(filteredDeals.length / itemsPerPage) || 1;
  const paginatedDeals = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredDeals.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredDeals, currentPage]);

  const imReviewDealsCount = useMemo(() => {
    return activeJoinedDeals.filter(d => (d.status || "").toLowerCase() === "im review").length;
  }, [activeJoinedDeals]);

  // Handle Owner Avatars formatting to match high-fidelity circles
  const getOwnerAvatar = (initials: string) => {
    if (initials === "AY") {
      return <div className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-slate-950 text-[9px] font-black shadow-sm select-none">AY</div>;
    }
    if (initials === "CH") {
      return <div className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-[#A855F7] text-white text-[9px] font-black shadow-sm select-none">CH</div>;
    }
    if (initials === "PR") {
      return <div className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-[#3B82F6] text-white text-[9px] font-black shadow-sm select-none">PR</div>;
    }
    if (initials === "DA" || initials === "DM") {
      return <div className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-[#10B981] text-slate-950 text-[9px] font-black shadow-sm select-none">DM</div>;
    }
    return <div className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-white/10 border border-white/5 text-slate-400 text-[9px] font-bold shadow-sm select-none">?</div>;
  };

  const handleCreateDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDealName.trim()) {
      setDealSubmitError("Deal / Company Name is required.");
      return;
    }
    setIsSubmittingDeal(true);
    setDealSubmitError("");
    try {
      await createAdminDeal({
        dealName: newDealName.trim(),
        acpRefNo: newDealRef.trim() || undefined,
        stage: newDealStage,
        nextAction: newDealNextAction.trim() || undefined,
        nextActionDate: newDealNextActionDate || undefined,
      });

      // Reset state and close modal
      setNewDealName("");
      setNewDealRef("");
      setNewDealStage("Intro");
      setNewDealNextAction("");
      setNewDealNextActionDate("");
      setIsModalOpen(false);
      
      // Trigger data refresh
      setRefreshTrigger(prev => prev + 1);
    } catch (err: any) {
      console.error("Error creating deal:", err);
      setDealSubmitError(err.message || "Failed to create deal.");
    } finally {
      setIsSubmittingDeal(false);
    }
  };

  return (
    <div className="space-y-6 text-[#E2E8F0] font-sans">
      
      {/* Header section with Dynamic overview & Warning Pills */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white tracking-tight">Deal Pipeline</h1>
          <p className="text-xs text-slate-550 font-medium">
            {activeJoinedDeals.length} active deals - {imReviewDealsCount} in IM Review
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[9px] font-bold text-amber-500 uppercase tracking-wider select-none">
            2 OVERDUE TASKS
          </span>
          <span className="inline-flex items-center rounded-full bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[9px] font-bold text-blue-400 uppercase tracking-wider select-none">
            2 LIVE DEALS
          </span>
          
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-300 shadow-sm hover:bg-white/10 hover:text-white cursor-pointer transition"
          >
            + NEW DEAL
          </button>
        </div>
      </div>

      {/* Stage Filter pills horizontal bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 select-none">
        <div className="flex flex-wrap gap-2 text-[10px] font-extrabold uppercase tracking-wider">
          
          {/* All */}
          <button
            onClick={() => { setSelectedStageFilter("All"); setCurrentPage(1); }}
            className={cx(
              "px-3.5 py-1.5 rounded-full border transition cursor-pointer font-bold",
              selectedStageFilter === "All"
                ? "border-[#10B981] bg-[#10B981]/5 text-[#10B981]"
                : "border-white/5 bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/5"
            )}
          >
            All ({activeJoinedDeals.length})
          </button>

          {/* Inbound */}
          <button
            onClick={() => { setSelectedStageFilter("Inbound"); setCurrentPage(1); }}
            className={cx(
              "px-3.5 py-1.5 rounded-full border transition cursor-pointer font-bold",
              selectedStageFilter === "Inbound"
                ? "border-blue-500 bg-blue-500/5 text-blue-400"
                : "border-white/5 bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/5"
            )}
          >
            Inbound ({joinedDeals.filter(d => (d.status || "").toLowerCase() === "intro" || (d.status || "").toLowerCase() === "inbound").length})
          </button>

          {/* Seller Call */}
          <button
            onClick={() => { setSelectedStageFilter("Seller Call"); setCurrentPage(1); }}
            className={cx(
              "px-3.5 py-1.5 rounded-full border transition cursor-pointer font-bold",
              selectedStageFilter === "Seller Call"
                ? "border-blue-500 bg-blue-500/5 text-blue-400"
                : "border-white/5 bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/5"
            )}
          >
            Seller Call ({joinedDeals.filter(d => (d.status || "").toLowerCase() === "seller call").length})
          </button>

          {/* IM Review */}
          <button
            onClick={() => { setSelectedStageFilter("IM Review"); setCurrentPage(1); }}
            className={cx(
              "px-3.5 py-1.5 rounded-full border transition cursor-pointer font-bold",
              selectedStageFilter === "IM Review"
                ? "border-amber-500 bg-amber-500/5 text-amber-500"
                : "border-white/5 bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/5"
            )}
          >
            IM Review ({joinedDeals.filter(d => (d.status || "").toLowerCase() === "im review").length})
          </button>

          {/* DD */}
          <button
            onClick={() => { setSelectedStageFilter("DD"); setCurrentPage(1); }}
            className={cx(
              "px-3.5 py-1.5 rounded-full border transition cursor-pointer font-bold",
              selectedStageFilter === "DD"
                ? "border-blue-500 bg-blue-500/5 text-blue-400"
                : "border-white/5 bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/5"
            )}
          >
            DD ({joinedDeals.filter(d => (d.status || "").toLowerCase() === "dd" || (d.status || "").toLowerCase() === "due diligence").length})
          </button>

          {/* Killed */}
          <button
            onClick={() => { setSelectedStageFilter("Killed"); setCurrentPage(1); }}
            className={cx(
              "px-3.5 py-1.5 rounded-full border transition cursor-pointer font-bold",
              selectedStageFilter === "Killed"
                ? "border-rose-500 bg-rose-500/5 text-rose-500 font-extrabold"
                : "border-rose-500/20 bg-white/[0.01] text-rose-450/70 hover:text-rose-400"
            )}
          >
            Killed
          </button>
        </div>

        {/* Right side actions - Search / Filter / Add */}
        <div className="flex items-center gap-3 select-none">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="h-9 w-36 rounded-xl border border-white/10 bg-[#0E121A] pl-8.5 pr-3 text-xs text-white placeholder-slate-600 outline-none transition focus:border-acp-bronze focus:w-44"
            />
          </div>

          <button
            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-[#0E121A] px-3.5 text-xs font-bold text-slate-350 hover:bg-white/5 transition cursor-pointer"
          >
            <Filter className="h-4 w-4" />
            <span>Filter</span>
          </button>

          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-acp-bronze hover:bg-acp-bronze/10 px-3.5 text-xs font-bold uppercase tracking-wider text-acp-bronze transition cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Add Deal</span>
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-12 text-center">
          <Database className="mx-auto h-8 w-8 text-acp-bronze animate-pulse mb-3" />
          <p className="text-xs font-bold text-slate-350">Loading pipeline deals...</p>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-500/10 bg-rose-500/5 p-6 text-center text-xs font-semibold text-rose-400 border-l-4 border-l-rose-500">
          {error}
        </div>
      )}

      {!isLoading && !error && (
        <div className="space-y-6">
          
          {/* Structured Deal Table Container */}
          <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse table-fixed min-w-[950px]">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-white/[0.01] select-none text-slate-500">
                    <th className="w-[200px] px-5 py-3 text-[9px] font-extrabold uppercase tracking-wider">Deal</th>
                    <th className="w-[85px] px-4 py-3 text-[9px] font-extrabold uppercase tracking-wider">Ref</th>
                    <th className="w-[100px] px-4 py-3 text-[9px] font-extrabold uppercase tracking-wider">Sector</th>
                    <th className="w-[80px] px-4 py-3 text-[9px] font-extrabold uppercase tracking-wider">Revenue</th>
                    <th className="w-[80px] px-4 py-3 text-[9px] font-extrabold uppercase tracking-wider">Ebitda</th>
                    <th className="w-[80px] px-4 py-3 text-[9px] font-extrabold uppercase tracking-wider">EV Ask</th>
                    <th className="w-[85px] px-4 py-3 text-[9px] font-extrabold uppercase tracking-wider">Mult</th>
                    <th className="w-[110px] px-4 py-3 text-[9px] font-extrabold uppercase tracking-wider">Stage</th>
                    <th className="w-[170px] px-4 py-3 text-[9px] font-extrabold uppercase tracking-wider">Next Action</th>
                    <th className="w-[110px] px-5 py-3 text-[9px] font-extrabold uppercase tracking-wider">Owner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {paginatedDeals.map((deal) => {
                    const multVal = Number(deal.multiplier);
                    const isHighMultiplier = !isNaN(multVal) && multVal > 6.0;

                    return (
                      <tr 
                        key={deal.id} 
                        onClick={() => navigate(`/deals/${encodeURIComponent(deal.dealRef)}`)}
                        className="hover:bg-white/[0.01] transition-colors cursor-pointer"
                      >
                        {/* Company Details */}
                        <td className="px-5 py-4 min-w-0">
                          <Link 
                            to={`/deals/${encodeURIComponent(deal.dealRef)}`}
                            className="block font-sans font-bold text-xs text-white hover:text-acp-bronze transition-colors truncate"
                          >
                            {deal.companyName || "Not Specified"}
                          </Link>
                          <p className="mt-0.5 text-[9px] text-slate-500 truncate leading-tight select-none">
                            {deal.location} — KBS {deal.dealRef}
                          </p>
                        </td>

                        {/* Deal Ref */}
                        <td className="px-4 py-4 select-none">
                          <span className="inline-flex items-center rounded-md bg-white/[0.03] border border-white/5 px-2 py-0.5 text-[9px] font-black text-slate-400 font-mono">
                            {deal.dealRef}
                          </span>
                        </td>

                        {/* Sector Blue Pill */}
                        <td className="px-4 py-4 select-none">
                          <span className="inline-flex items-center rounded-full bg-[#131E35] border border-blue-500/10 px-2.5 py-0.5 text-[9px] font-extrabold text-[#3B82F6]">
                            {deal.sector}
                          </span>
                        </td>

                        {/* Revenue */}
                        <td className="px-4 py-4 font-sans text-xs font-semibold text-white">
                          {formatFinancial(deal.revenue)}
                        </td>

                        {/* EBITDA */}
                        <td className="px-4 py-4 font-sans text-xs font-semibold text-white">
                          {formatFinancial(deal.ebitda)}
                        </td>

                        {/* EV Ask */}
                        <td className="px-4 py-4 font-sans text-xs font-semibold text-white">
                          {formatFinancial(deal.evAsk)}
                        </td>

                        {/* Multipliers with Caution Alert */}
                        <td className="px-4 py-4 font-sans text-xs font-bold">
                          <span className={cx(
                            "inline-flex items-center gap-1",
                            isHighMultiplier ? "text-amber-500 font-extrabold" : "text-[#10B981]"
                          )}>
                            {formatMultiplier(deal.multiplier)}
                            {isHighMultiplier && (
                              <span title="Multiplier threshold breached">
                                <AlertTriangle className="h-3 w-3 text-amber-500 animate-pulse" />
                              </span>
                            )}
                          </span>
                        </td>

                        {/* Stage Badge */}
                        <td className="px-4 py-4 select-none">
                          <span className={cx(
                            "inline-flex items-center rounded px-2.5 py-0.5 text-[8px] font-black uppercase tracking-widest",
                            (deal.status || "").toLowerCase() === "intro" || (deal.status || "").toLowerCase() === "inbound" ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" :
                            (deal.status || "").toLowerCase() === "im review" ? "bg-[#2D2214] text-[#D97706] border border-[#D97706]/20" :
                            (deal.status || "").toLowerCase() === "seller call" ? "bg-pink-500/10 text-pink-405 border border-pink-500/20" :
                            "bg-acp-bronze/10 text-acp-bronze border border-acp-bronze/20"
                          )}>
                            {deal.status}
                          </span>
                        </td>

                        {/* Next Action Text */}
                        <td className="px-4 py-4 min-w-0">
                          <div className="flex items-start gap-2 min-w-0 font-sans">
                            <span className={cx(
                              "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                              deal.nextActionColor === "red" ? "bg-rose-500" :
                              deal.nextActionColor === "yellow" ? "bg-amber-450" : "bg-blue-400"
                            )} />
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold text-white leading-tight truncate">
                                {deal.nextActionTitle}
                              </p>
                              <p className="mt-0.5 text-[9px] font-semibold text-slate-500 truncate leading-none">
                                {deal.nextActionSub}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Owner Avatars */}
                        <td className="px-5 py-4 select-none">
                          <div className="flex items-center gap-2">
                            {getOwnerAvatar(deal.ownerInitials)}
                            <span className="text-[10px] font-bold text-slate-400">{deal.ownerName}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredDeals.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-5 py-12 text-center text-xs font-bold text-slate-500">
                        No deals found matching your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between border-t border-white/[0.04] bg-white/[0.01] px-5 py-3.5 select-none">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                SHOWING {filteredDeals.length} OF {activeJoinedDeals.length} ACTIVE OPPORTUNITIES
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="h-8 rounded-lg border border-white/10 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none hover:bg-white/5 transition cursor-pointer"
                >
                  Previous
                </button>
                <span className="h-8 w-8 flex items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/20 text-[10px] font-extrabold text-blue-400">
                  {currentPage}
                </span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="h-8 rounded-lg border border-white/10 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none hover:bg-white/5 transition cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* New Deal Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
          
          <form 
            onSubmit={handleCreateDeal}
            className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-[#0E121A] p-6 shadow-2xl backdrop-blur-xl animate-fade-in-up"
          >
            <div className="flex items-center justify-between pb-4 border-b border-white/5">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Add New Deal to Pipeline
              </h3>
              <button 
                type="button" 
                onClick={() => setIsModalOpen(false)} 
                className="text-slate-405 hover:text-white transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4 font-sans">
              {dealSubmitError && (
                <div className="rounded-lg border border-rose-500/10 bg-rose-500/5 p-3 text-center text-xs font-semibold text-rose-455 border-l-2 border-l-rose-500">
                  {dealSubmitError}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">
                  Deal / Company Name *
                </label>
                <input
                  type="text"
                  required
                  value={newDealName}
                  onChange={(e) => setNewDealName(e.target.value)}
                  placeholder="e.g. Clear Water Cleaning Services"
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze transition"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">
                  ACP Reference No. (optional)
                </label>
                <input
                  type="text"
                  value={newDealRef}
                  onChange={(e) => setNewDealRef(e.target.value)}
                  placeholder="e.g. ACP-CFS-006"
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze transition"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">
                  Pipeline Stage
                </label>
                <select
                  value={newDealStage}
                  onChange={(e) => setNewDealStage(e.target.value)}
                  className="h-10 w-full rounded-xl border border-white/10 bg-[#0E121A] px-3 text-xs text-white outline-none focus:border-acp-bronze transition"
                >
                  <option value="Intro">Intro</option>
                  <option value="IM Review">IM Review</option>
                  <option value="Information Requested">Information Requested</option>
                  <option value="Offer Submitted">Offer Submitted</option>
                  <option value="Seller Call">Seller Call</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">
                  Next Action Details
                </label>
                <textarea
                  value={newDealNextAction}
                  onChange={(e) => setNewDealNextAction(e.target.value)}
                  placeholder="e.g. 2nd call TBC"
                  rows={3}
                  className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze transition resize-none font-sans"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">
                  Next Action Target Date
                </label>
                <input
                  type="date"
                  value={newDealNextActionDate}
                  onChange={(e) => setNewDealNextActionDate(e.target.value)}
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white outline-none focus:border-acp-bronze transition"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2.5 font-sans">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="h-9 px-4 rounded-xl border border-white/10 text-slate-350 text-xs font-bold uppercase tracking-wider hover:bg-white/5 transition"
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
        </div>
      )}
    </div>
  );
}
