import { useState, useMemo, useEffect } from "react";
import { 
  Search, Filter, Plus, X, AlertTriangle, ChevronLeft, ChevronRight, 
  Database, RefreshCw, FolderOpen, ArrowUpRight, TrendingUp, Sparkles,
  Kanban
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getDealInbox, getAllDocuments } from "../api/airtable";
import { fetchAdminLenders, createAdminDeal } from "../api/admin";
import type { PipelineDeal, DealDocument } from "../types/deal";
import { cx } from "../utils/cx";
import { usePipeline } from "../context/PipelineContext";
import { HeaderMetrics } from "../components/ui/HeaderMetrics";
import { LoadingState } from "../components/ui/LoadingState";
import { Modal } from "../components/ui/Modal";
import { FormField, inputClass, selectClass, textareaClass } from "../components/ui/FormField";
import { DealKanban } from "../components/deals/DealKanban";

export function DealListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { deals, refresh: refreshPipeline } = usePipeline();
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
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
  const [selectedOwnerFilter, setSelectedOwnerFilter] = useState("All");
  const [selectedSectorFilter, setSelectedSectorFilter] = useState("All");

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
    if (searchParams.get("create") === "true") {
      setIsModalOpen(true);
      const newParams = new URLSearchParams(searchParams);
      newParams.delete("create");
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setIsLoading(true);
    setError("");

    Promise.all([
      getDealInbox().catch(() => []),
      getAllDocuments().catch(() => []),
      fetchAdminLenders().catch(() => [])
    ])
      .then(([inboxData, docsData, lendersData]) => {
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

  // Clean references and names helpers
  const formatRefDisplay = (ref: string): string => {
    if (!ref) return "";
    const clean = ref.split(/[—\-\s]+/)[0].trim();
    return clean || ref;
  };

  const cleanCompanyName = (name: string): string => {
    if (!name) return "Not Specified";
    return name.replace(/^[A-Z0-9]+\s*[—\-:]\s*/i, "").replace(/^(PARKED|KILLED|INBOUND|INTRO)\s*[—\-:]\s*/i, "").trim();
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

  // Dynamically extract unique owners & sectors from joinedDeals
  const owners = useMemo(() => {
    const list = new Set<string>();
    joinedDeals.forEach(d => {
      if (d.ownerName) list.add(d.ownerName);
    });
    return ["All", ...Array.from(list)];
  }, [joinedDeals]);

  const sectors = useMemo(() => {
    const list = new Set<string>();
    joinedDeals.forEach(d => {
      if (d.sector) list.add(d.sector);
    });
    return ["All", ...Array.from(list)];
  }, [joinedDeals]);

  const baseFilteredDeals = useMemo(() => {
    let result = joinedDeals;
    if (selectedOwnerFilter !== "All") {
      result = result.filter(d => d.ownerName === selectedOwnerFilter);
    }
    if (selectedSectorFilter !== "All") {
      result = result.filter(d => (d.sector || "").toLowerCase() === selectedSectorFilter.toLowerCase());
    }
    return result;
  }, [joinedDeals, selectedOwnerFilter, selectedSectorFilter]);

  // Filter base list by stage (but before search query) to get correct stage denominators
  const stageFilteredDeals = useMemo(() => {
    let result = baseFilteredDeals;

    if (selectedStageFilter !== "All") {
      if (selectedStageFilter === "Inbound") {
        result = result.filter(d => {
          const status = (d.status || "").toLowerCase();
          return status === "intro" || status === "inbound" || status === "information requested";
        });
      } else if (selectedStageFilter === "DD") {
        result = result.filter(d => {
          const status = (d.status || "").toLowerCase();
          return status === "dd" || status === "due diligence" || status === "offer submitted";
        });
      } else {
        result = result.filter(d => (d.status || "").toLowerCase() === selectedStageFilter.toLowerCase());
      }
    }

    return result;
  }, [baseFilteredDeals, selectedStageFilter]);

  // Filter & Search Deals
  const filteredDeals = useMemo(() => {
    let result = stageFilteredDeals;

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
  }, [stageFilteredDeals, searchQuery]);

  // Filter & Search Deals for Kanban (ignores stage filter pills)
  const kanbanFilteredDeals = useMemo(() => {
    let result = baseFilteredDeals;

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
  }, [baseFilteredDeals, searchQuery]);

  // Active Deals count excluding Killed
  const activeJoinedDeals = useMemo(() => {
    return baseFilteredDeals.filter(d => (d.status || "").toLowerCase() !== "killed");
  }, [baseFilteredDeals]);

  // Overdue actions count (contextual to active filters)
  const overdueCount = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    return baseFilteredDeals.filter(d => {
      if ((d.status || "").toLowerCase() === "killed") return false;
      const actDate = d.rawFields?.["Next Action Date"];
      const actText = d.rawFields?.["Next Action"];
      return actDate && actText && actDate < todayStr;
    }).length;
  }, [baseFilteredDeals]);

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
      return <div className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-[#C6A66B] to-[#D4B06A] text-slate-950 text-[9px] font-bold border border-[#C6A66B]/10 shadow-inner select-none">AY</div>;
    }
    if (initials === "CH") {
      return <div className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-purple-500/80 to-purple-400/80 text-white text-[9px] font-bold border border-purple-500/10 shadow-inner select-none">CH</div>;
    }
    if (initials === "PR") {
      return <div className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-blue-500/80 to-blue-400/80 text-white text-[9px] font-bold border border-blue-500/10 shadow-inner select-none">PR</div>;
    }
    if (initials === "DA" || initials === "DM") {
      return <div className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-500/80 to-emerald-400/80 text-slate-950 text-[9px] font-bold border border-emerald-500/10 shadow-inner select-none">DM</div>;
    }
    return <div className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-white/[0.015] border border-white/[0.02] text-slate-400 text-[9px] font-bold shadow-sm select-none">?</div>;
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
      refreshPipeline();
    } catch (err: any) {
      console.error("Error creating deal:", err);
      setDealSubmitError(err.message || "Failed to create deal.");
    } finally {
      setIsSubmittingDeal(false);
    }
  };

  return (
    <div className="space-y-8 text-[#E2E8F0] font-sans animate-fade-in-up">
      
      {/* Header section with Dynamic overview & Warning Pills */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.02] pb-5">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-white tracking-tight">Deal Pipeline</h1>
          <p className="text-xs text-slate-500 font-medium">
            Pipeline Overview — {imReviewDealsCount} in IM Review
          </p>
        </div>
        
        <div className="flex items-center gap-2 select-none">
          {overdueCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-rose-500/5 border border-rose-500/10 px-2.5 py-0.5 text-[9px] font-semibold text-rose-400 tracking-wide select-none animate-pulse">
              {overdueCount} OVERDUE TASKS
            </span>
          )}
          <span className="inline-flex items-center rounded-full bg-blue-500/5 border border-blue-500/10 px-2.5 py-0.5 text-[9px] font-semibold text-blue-400 tracking-wide select-none">
            {activeJoinedDeals.length} LIVE DEALS
          </span>
          
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/[0.02] bg-white/[0.02] px-3.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white cursor-pointer transition"
          >
            + NEW DEAL
          </button>
        </div>
      </div>

      {/* Stage Filter pills horizontal bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 select-none">
        {viewMode === "list" ? (
          <div className="flex flex-wrap gap-2 text-[10px] font-bold tracking-wide">
            {/* All */}
            <button
              onClick={() => { setSelectedStageFilter("All"); setCurrentPage(1); }}
              className={cx(
                "px-3.5 py-1.5 rounded-full border transition cursor-pointer font-bold",
                selectedStageFilter === "All"
                  ? "border-[#C6A66B] bg-[#C6A66B]/5 text-[#C6A66B]"
                  : "border-white/[0.02] bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/[0.03]"
              )}
            >
              All ({baseFilteredDeals.length})
            </button>

            {/* Inbound */}
            <button
              onClick={() => { setSelectedStageFilter("Inbound"); setCurrentPage(1); }}
              className={cx(
                "px-3.5 py-1.5 rounded-full border transition cursor-pointer font-bold",
                selectedStageFilter === "Inbound"
                  ? "border-blue-500/30 bg-blue-500/5 text-blue-400"
                  : "border-white/[0.02] bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/[0.03]"
              )}
            >
              Inbound ({baseFilteredDeals.filter(d => {
                const status = (d.status || "").toLowerCase();
                return status === "intro" || status === "inbound" || status === "information requested";
              }).length})
            </button>

            {/* Seller Call */}
            <button
              onClick={() => { setSelectedStageFilter("Seller Call"); setCurrentPage(1); }}
              className={cx(
                "px-3.5 py-1.5 rounded-full border transition cursor-pointer font-bold",
                selectedStageFilter === "Seller Call"
                  ? "border-indigo-500/30 bg-indigo-500/5 text-indigo-400"
                  : "border-white/[0.02] bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/[0.03]"
              )}
            >
              Seller Call ({baseFilteredDeals.filter(d => (d.status || "").toLowerCase() === "seller call").length})
            </button>

            {/* IM Review */}
            <button
              onClick={() => { setSelectedStageFilter("IM Review"); setCurrentPage(1); }}
              className={cx(
                "px-3.5 py-1.5 rounded-full border transition cursor-pointer font-bold",
                selectedStageFilter === "IM Review"
                  ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                  : "border-white/[0.02] bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/[0.03]"
              )}
            >
              IM Review ({baseFilteredDeals.filter(d => (d.status || "").toLowerCase() === "im review").length})
            </button>

            {/* DD */}
            <button
              onClick={() => { setSelectedStageFilter("DD"); setCurrentPage(1); }}
              className={cx(
                "px-3.5 py-1.5 rounded-full border transition cursor-pointer font-bold",
                selectedStageFilter === "DD"
                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                  : "border-white/[0.02] bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/[0.03]"
              )}
            >
              DD ({baseFilteredDeals.filter(d => {
                const status = (d.status || "").toLowerCase();
                return status === "dd" || status === "due diligence" || status === "offer submitted";
              }).length})
            </button>

            {/* Killed */}
            <button
              onClick={() => { setSelectedStageFilter("Killed"); setCurrentPage(1); }}
              className={cx(
                "px-3.5 py-1.5 rounded-full border transition cursor-pointer font-bold",
                selectedStageFilter === "Killed"
                  ? "border-rose-500 bg-rose-500/5 text-rose-500"
                  : "border-rose-500/10 bg-white/[0.01] text-rose-400/70 hover:text-rose-400"
              )}
            >
              Killed ({baseFilteredDeals.filter(d => (d.status || "").toLowerCase() === "killed").length})
            </button>
          </div>
        ) : (
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider select-none bg-white/[0.02] border border-white/[0.02] px-3.5 py-2 rounded-xl">
            Drag cards to progress stages · Checked by deal lifecycle engine
          </div>
        )}

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
              className="h-9 w-36 rounded-xl border border-white/[0.02] bg-[#0B0B0C] pl-9 pr-3 text-xs text-white placeholder-slate-500 outline-none transition focus:border-[#C6A66B] focus:w-44 shadow-inner"
            />
          </div>

          <button
            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/[0.02] bg-[#0B0B0C] px-3.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.03] transition cursor-pointer shadow-inner"
          >
            <Filter className="h-4 w-4" />
            <span>Filter</span>
          </button>

          {/* View Toggles */}
          <div className="flex rounded-xl border border-white/[0.02] bg-[#0B0B0C] p-0.5 shadow-inner">
            <button
              onClick={() => setViewMode("list")}
              className={cx(
                "flex h-8 w-8 items-center justify-center rounded-lg transition-all cursor-pointer",
                viewMode === "list"
                  ? "bg-white/[0.03] text-white border border-white/[0.02] shadow-sm"
                  : "text-slate-400 hover:text-white"
              )}
              title="Table View"
            >
              <Database className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("kanban")}
              className={cx(
                "flex h-8 w-8 items-center justify-center rounded-lg transition-all cursor-pointer",
                viewMode === "kanban"
                  ? "bg-white/[0.03] text-white border border-white/[0.02] shadow-sm"
                  : "text-slate-400 hover:text-white"
              )}
              title="Kanban Board"
            >
              <Kanban className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Filter Dropdown Panel */}
      {showFilterDropdown && (
        <div className="rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 animate-fade-in-up premium-card">
          <div className="space-y-2">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 select-none">
              Filter by Owner
            </label>
            <select
              value={selectedOwnerFilter}
              onChange={(e) => {
                setSelectedOwnerFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="h-10 w-full rounded-xl border border-white/[0.02] bg-[#0F1115] px-3.5 text-xs text-white outline-none focus:border-[#C6A66B] transition cursor-pointer shadow-inner"
            >
              {owners.map(o => (
                <option key={o} value={o} className="bg-[#0B0B0C]">{o}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 select-none">
              Filter by Sector
            </label>
            <select
              value={selectedSectorFilter}
              onChange={(e) => {
                setSelectedSectorFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="h-10 w-full rounded-xl border border-white/[0.02] bg-[#0F1115] px-3.5 text-xs text-white outline-none focus:border-[#C6A66B] transition cursor-pointer shadow-inner"
            >
              {sectors.map(s => (
                <option key={s} value={s} className="bg-[#0B0B0C]">{s}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {isLoading && <LoadingState variant="table" label="Loading pipeline deals" />}

      {error && (
        <div className="rounded-2xl border border-rose-500/10 bg-rose-500/5 p-6 text-center text-xs font-semibold text-rose-400 border-l-4 border-l-rose-500">
          {error}
        </div>
      )}

      {!isLoading && !error && (
        <div className="space-y-6">
          {viewMode === "list" ? (
            /* Structured Deal Table Container */
            <div className="rounded-2xl premium-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse table-fixed min-w-[950px]">
                  <thead>
                    <tr className="border-b border-white/[0.02] bg-white/[0.01] select-none text-slate-400">
                      <th className="w-[200px] px-5 py-3.5 text-[10px] font-semibold tracking-wide uppercase">Deal</th>
                      <th className="w-[85px] px-4 py-3.5 text-[10px] font-semibold tracking-wide uppercase">Ref</th>
                      <th className="w-[100px] px-4 py-3.5 text-[10px] font-semibold tracking-wide uppercase">Sector</th>
                      <th className="w-[80px] px-4 py-3.5 text-[10px] font-semibold tracking-wide uppercase">Revenue</th>
                      <th className="w-[80px] px-4 py-3.5 text-[10px] font-semibold tracking-wide uppercase">Ebitda</th>
                      <th className="w-[80px] px-4 py-3.5 text-[10px] font-semibold tracking-wide uppercase">EV Ask</th>
                      <th className="w-[85px] px-4 py-3.5 text-[10px] font-semibold tracking-wide uppercase">Mult</th>
                      <th className="w-[110px] px-4 py-3.5 text-[10px] font-semibold tracking-wide uppercase">Stage</th>
                      <th className="w-[170px] px-4 py-3.5 text-[10px] font-semibold tracking-wide uppercase">Next Action</th>
                      <th className="w-[110px] px-5 py-3.5 text-[10px] font-semibold tracking-wide uppercase">Owner</th>
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
                          className="table-row-hover border-b border-white/[0.02]"
                        >
                          {/* Company Details */}
                          <td className="px-5 py-4 min-w-0">
                            <Link 
                              to={`/deals/${encodeURIComponent(deal.dealRef)}`}
                              className="block font-sans font-semibold text-xs text-white hover:text-[#C6A66B] transition-colors truncate"
                            >
                              {cleanCompanyName(deal.companyName)}
                            </Link>
                            <p className="mt-1 text-[10px] text-slate-500 truncate leading-tight select-none">
                              {deal.location} — Ref: {formatRefDisplay(deal.dealRef)}
                            </p>
                          </td>

                          {/* Deal Ref */}
                          <td className="px-4 py-4 select-none">
                            <span className="inline-flex items-center rounded-lg bg-white/[0.02] border border-white/[0.02] px-2 py-0.5 text-[10px] font-medium text-slate-400 font-mono">
                              {formatRefDisplay(deal.dealRef)}
                            </span>
                          </td>

                          {/* Sector Pill */}
                          <td className="px-4 py-4 select-none">
                            <span className="inline-flex items-center rounded-full bg-blue-500/5 border border-blue-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-blue-400">
                              {deal.sector}
                            </span>
                          </td>

                          {/* Revenue */}
                          <td className="px-4 py-4 font-sans text-xs font-medium text-white">
                            {formatFinancial(deal.revenue)}
                          </td>

                          {/* EBITDA */}
                          <td className="px-4 py-4 font-sans text-xs font-medium text-white">
                            {formatFinancial(deal.ebitda)}
                          </td>

                          {/* EV Ask */}
                          <td className="px-4 py-4 font-sans text-xs font-medium text-white">
                            {formatFinancial(deal.evAsk)}
                          </td>

                          {/* Multipliers with Caution Alert */}
                          <td className="px-4 py-4 font-sans text-xs font-medium">
                            <span className={cx(
                              "inline-flex items-center gap-1",
                              isHighMultiplier ? "text-amber-500 font-semibold" : "text-emerald-400"
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
                              "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-normal border",
                              (() => {
                                const s = (deal.status || "").toLowerCase();
                                if (s === "intro" || s === "inbound" || s === "information requested") {
                                    return "bg-blue-500/5 text-blue-400 border-blue-500/10";
                                }
                                if (s === "seller call") {
                                    return "bg-pink-500/5 text-pink-400 border-pink-500/10";
                                }
                                if (s === "im review") {
                                    return "bg-amber-500/5 text-amber-400 border-amber-500/10";
                                }
                                if (s === "killed") {
                                    return "bg-rose-500/5 text-rose-500 border-rose-500/10";
                                }
                                return "bg-[#C6A66B]/5 text-[#C6A66B] border-[#C6A66B]/10";
                              })()
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
                                deal.nextActionColor === "yellow" ? "bg-amber-500" : "bg-blue-400"
                              )} />
                              <div className="min-w-0">
                                <p className="text-[10px] font-semibold text-white leading-tight truncate">
                                  {deal.nextActionTitle}
                                </p>
                                <p className="mt-1 text-[10px] font-medium text-slate-500 truncate leading-none">
                                  {deal.nextActionSub}
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* Owner Avatars */}
                          <td className="px-5 py-4 select-none">
                            <div className="flex items-center gap-2">
                              {getOwnerAvatar(deal.ownerInitials)}
                              <span className="text-[10px] font-medium text-slate-400">{deal.ownerName}</span>
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
              <div className="flex items-center justify-between border-t border-white/[0.02] bg-white/[0.01] px-5 py-3.5 select-none">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                  Showing {Math.min((currentPage - 1) * itemsPerPage + 1, filteredDeals.length)}–{Math.min(currentPage * itemsPerPage, filteredDeals.length)} of {filteredDeals.length}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none hover:bg-white/[0.05] transition cursor-pointer"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-[10px] font-bold text-slate-400 min-w-[60px] text-center">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none hover:bg-white/[0.05] transition cursor-pointer"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <DealKanban
              deals={kanbanFilteredDeals}
              onStageChanged={() => refreshPipeline()}
            />
          )}
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

          <FormField label="Deal / Company Name" id="new-deal-company" required>
            <input
              id="new-deal-company"
              type="text"
              required
              value={newDealName}
              onChange={(e) => setNewDealName(e.target.value)}
              placeholder="e.g. Clear Water Cleaning Services"
              className={inputClass}
            />
          </FormField>

          <FormField label="ACP Reference No." id="new-deal-ref">
            <input
              id="new-deal-ref"
              type="text"
              value={newDealRef}
              onChange={(e) => setNewDealRef(e.target.value)}
              placeholder="e.g. ACP-CFS-006"
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
              placeholder="e.g. 2nd call TBC"
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
              className="h-9 px-4 rounded-xl bg-gradient-to-r from-[#C6A66B] to-[#B8924F] text-slate-950 text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-bronze transition cursor-pointer"
            >
              {isSubmittingDeal ? "Adding..." : "Add Deal"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
