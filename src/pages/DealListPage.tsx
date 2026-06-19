import { useState, useEffect, useMemo } from "react";
import { 
  Search, Filter, Plus, X, AlertTriangle, ChevronLeft, ChevronRight, 
  Database, RefreshCw, FolderOpen, ArrowUpRight, TrendingUp, Sparkles,
  Kanban, Upload, FileText
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getDealInbox, getAllDocuments } from "../api/airtable";
import { fetchAdminLenders, createAdminDeal, uploadImDocument } from "../api/admin";
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
  const { deals, loading: pipelineLoading, error: pipelineError, refresh: refreshPipeline } = usePipeline();
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  
  const isLoading = pipelineLoading;
  const error = pipelineError;

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
  // Institutional fields
  const [newDealProject, setNewDealProject] = useState("");
  const [newDealIndustry, setNewDealIndustry] = useState("");
  const [newDealWebsite, setNewDealWebsite] = useState("");
  const [newDealLocation, setNewDealLocation] = useState("");
  const [newDealOwner, setNewDealOwner] = useState("");
  const [newDealAnalyst, setNewDealAnalyst] = useState("");
  const [newDealSource, setNewDealSource] = useState("");
  const [newDealRevenue, setNewDealRevenue] = useState("");
  const [newDealEbitda, setNewDealEbitda] = useState("");
  const [newDealEV, setNewDealEV] = useState("");
  const [newDealAskingPrice, setNewDealAskingPrice] = useState("");
  const [newDealNotes, setNewDealNotes] = useState("");
  
  // IM & Attachment upload states for new deal
  const [pendingFiles, setPendingFiles] = useState<Array<{ fileName: string; fileType: string; fileData: string }>>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    if (searchParams.get("create") === "true") {
      setIsModalOpen(true);
      const newParams = new URLSearchParams(searchParams);
      newParams.delete("create");
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Available unique stages for raw items (excluding Killed by default for calculations)
  const stages = useMemo(() => {
    const unique = new Set<string>();
    deals.forEach((d: any) => {
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

  // Pre-joined deals are served directly from the backend
  const joinedDeals = useMemo(() => {
    return deals;
  }, [deals]);

  // Dynamically extract unique owners & sectors from joinedDeals
  const owners = useMemo(() => {
    const list = new Set<string>();
    joinedDeals.forEach((d: any) => {
      if (d.ownerName) list.add(d.ownerName);
    });
    return ["All", ...Array.from(list)];
  }, [joinedDeals]);

  const sectors = useMemo(() => {
    const list = new Set<string>();
    joinedDeals.forEach((d: any) => {
      if (d.sector) list.add(d.sector);
    });
    return ["All", ...Array.from(list)];
  }, [joinedDeals]);

  const baseFilteredDeals = useMemo(() => {
    let result = joinedDeals;
    if (selectedOwnerFilter !== "All") {
      result = result.filter((d: any) => d.ownerName === selectedOwnerFilter);
    }
    if (selectedSectorFilter !== "All") {
      result = result.filter((d: any) => (d.sector || "").toLowerCase() === selectedSectorFilter.toLowerCase());
    }
    return result;
  }, [joinedDeals, selectedOwnerFilter, selectedSectorFilter]);

  // Filter base list by stage (but before search query) to get correct stage denominators
  const stageFilteredDeals = useMemo(() => {
    let result = baseFilteredDeals;

    if (selectedStageFilter !== "All") {
      if (selectedStageFilter === "Inbound") {
        result = result.filter((d: any) => {
          const status = (d.status || "").toLowerCase();
          return status === "intro" || status === "inbound" || status === "information requested";
        });
      } else if (selectedStageFilter === "DD") {
        result = result.filter((d: any) => {
          const status = (d.status || "").toLowerCase();
          return status === "dd" || status === "due diligence" || status === "offer submitted";
        });
      } else {
        result = result.filter((d: any) => (d.status || "").toLowerCase() === selectedStageFilter.toLowerCase());
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
      result = result.filter((d: any) => 
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
      result = result.filter((d: any) => 
        (d.companyName || "").toLowerCase().includes(q) ||
        (d.dealRef || "").toLowerCase().includes(q) ||
        (d.sector || "").toLowerCase().includes(q) ||
        (d.location || "").toLowerCase().includes(q)
      );
    }

    return result;
  }, [baseFilteredDeals, searchQuery]);

  const isInactiveStage = (stage: string): boolean => {
    const s = (stage || "").toLowerCase().trim();
    return ["killed", "dead", "rejected", "closed lost", "archived"].includes(s) || s === "";
  };

  // Active Deals count excluding Killed/Archived/Dead/etc.
  const activeJoinedDeals = useMemo(() => {
    return baseFilteredDeals.filter((d: any) => !isInactiveStage(d.status));
  }, [baseFilteredDeals]);

  // Overdue actions count (contextual to active filters)
  const overdueCount = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    return baseFilteredDeals.filter((d: any) => {
      if (isInactiveStage(d.status)) return false;
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
    return activeJoinedDeals.filter((d: any) => (d.status || "").toLowerCase() === "im review").length;
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
      const res = await createAdminDeal({
        dealName: newDealName.trim(),
        companyName: newDealName.trim(),
        projectName: newDealProject.trim() || undefined,
        industry: newDealIndustry.trim() || undefined,
        website: newDealWebsite.trim() || undefined,
        location: newDealLocation.trim() || undefined,
        owner: newDealOwner.trim() || undefined,
        analyst: newDealAnalyst.trim() || undefined,
        source: newDealSource.trim() || undefined,
        revenue: newDealRevenue ? Number(newDealRevenue) : undefined,
        ebitda: newDealEbitda ? Number(newDealEbitda) : undefined,
        enterpriseValue: newDealEV ? Number(newDealEV) : undefined,
        askingPrice: newDealAskingPrice ? Number(newDealAskingPrice) : undefined,
        acpRefNo: newDealRef.trim() || undefined,
        stage: newDealStage,
        nextAction: newDealNextAction.trim() || undefined,
        nextActionDate: newDealNextActionDate || undefined,
        internalNotes: newDealNotes.trim() || undefined,
      });

      // Sequentially upload all files in pendingFiles
      if (res.success && res.result?.id && pendingFiles.length > 0) {
        setIsUploadingFiles(true);
        const dealId = res.result.id;
        for (const file of pendingFiles) {
          try {
            await uploadImDocument(dealId, file.fileName, file.fileType, file.fileData);
          } catch (uploadErr) {
            console.error("Failed to upload pending file during deal creation:", file.fileName, uploadErr);
          }
        }
      }

      // Reset state and close modal
      setNewDealName(""); setNewDealRef(""); setNewDealStage("Intro");
      setNewDealNextAction(""); setNewDealNextActionDate("");
      setNewDealProject(""); setNewDealIndustry(""); setNewDealWebsite("");
      setNewDealLocation(""); setNewDealOwner(""); setNewDealAnalyst("");
      setNewDealSource(""); setNewDealRevenue(""); setNewDealEbitda("");
      setNewDealEV(""); setNewDealAskingPrice(""); setNewDealNotes("");
      setPendingFiles([]);
      setIsModalOpen(false);
      
      // Trigger data refresh
      refreshPipeline();
    } catch (err: any) {
      console.error("Error creating deal:", err);
      setDealSubmitError(err.message || "Failed to create deal.");
    } finally {
      setIsSubmittingDeal(false);
      setIsUploadingFiles(false);
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
                  ? "border-[#C6A66B] bg-[#C6A66B]/5 text-[#C6A66B]"
                  : "border-white/[0.02] bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/[0.03]"
              )}
            >
              Inbound ({baseFilteredDeals.filter((d: any) => {
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
                  ? "border-[#C6A66B] bg-[#C6A66B]/5 text-[#C6A66B]"
                  : "border-white/[0.02] bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/[0.03]"
              )}
            >
              Seller Call ({baseFilteredDeals.filter((d: any) => (d.status || "").toLowerCase() === "seller call").length})
            </button>

            {/* IM Review */}
            <button
              onClick={() => { setSelectedStageFilter("IM Review"); setCurrentPage(1); }}
              className={cx(
                "px-3.5 py-1.5 rounded-full border transition cursor-pointer font-bold",
                selectedStageFilter === "IM Review"
                  ? "border-[#C6A66B] bg-[#C6A66B]/5 text-[#C6A66B]"
                  : "border-white/[0.02] bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/[0.03]"
              )}
            >
              IM Review ({baseFilteredDeals.filter((d: any) => (d.status || "").toLowerCase() === "im review").length})
            </button>

            {/* DD */}
            <button
              onClick={() => { setSelectedStageFilter("DD"); setCurrentPage(1); }}
              className={cx(
                "px-3.5 py-1.5 rounded-full border transition cursor-pointer font-bold",
                selectedStageFilter === "DD"
                  ? "border-[#C6A66B] bg-[#C6A66B]/5 text-[#C6A66B]"
                  : "border-white/[0.02] bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/[0.03]"
              )}
            >
              DD ({baseFilteredDeals.filter((d: any) => {
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
                  : "border-rose-500/10 bg-white/[0.01] text-rose-400 hover:text-rose-300"
              )}
            >
              Killed ({baseFilteredDeals.filter((d: any) => (d.status || "").toLowerCase() === "killed").length})
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
              {owners.map((o: string) => (
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
              {sectors.map((s: string) => (
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
                    {paginatedDeals.map((deal: any) => {
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
                              {getOwnerAvatar(deal.ownerInitials || "")}
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
                    onClick={() => setCurrentPage((prev: number) => Math.max(prev - 1, 1))}
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
                    onClick={() => setCurrentPage((prev: number) => Math.min(prev + 1, totalPages))}
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

      {/* New Deal Creation Modal — Full Institutional Intake */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add New Deal to Pipeline"
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleCreateDeal} className="space-y-5 font-sans max-h-[75vh] overflow-y-auto pr-1">
          {dealSubmitError && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs font-semibold text-rose-400 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {dealSubmitError}
            </div>
          )}

          {/* Company Information */}
          <div className="space-y-3">
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">Company Information</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Company Name" id="new-deal-company" required>
                <input id="new-deal-company" type="text" required value={newDealName} onChange={(e) => setNewDealName(e.target.value)} placeholder="e.g. Clear Water Cleaning Services" className={inputClass} />
              </FormField>
              <FormField label="Project Name" id="new-deal-project">
                <input id="new-deal-project" type="text" value={newDealProject} onChange={(e) => setNewDealProject(e.target.value)} placeholder="e.g. Project Aqua" className={inputClass} />
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Industry" id="new-deal-industry">
                <input id="new-deal-industry" type="text" value={newDealIndustry} onChange={(e) => setNewDealIndustry(e.target.value)} placeholder="e.g. Facilities Management" className={inputClass} />
              </FormField>
              <FormField label="Website" id="new-deal-website">
                <input id="new-deal-website" type="text" value={newDealWebsite} onChange={(e) => setNewDealWebsite(e.target.value)} placeholder="e.g. https://example.com" className={inputClass} />
              </FormField>
              <FormField label="Location" id="new-deal-location">
                <input id="new-deal-location" type="text" value={newDealLocation} onChange={(e) => setNewDealLocation(e.target.value)} placeholder="e.g. London, UK" className={inputClass} />
              </FormField>
            </div>
          </div>

          {/* Ownership */}
          <div className="space-y-3">
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">Ownership</p>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Owner" id="new-deal-owner">
                <input id="new-deal-owner" type="text" value={newDealOwner} onChange={(e) => setNewDealOwner(e.target.value)} placeholder="e.g. Ayo Yusuf" className={inputClass} />
              </FormField>
              <FormField label="Analyst" id="new-deal-analyst">
                <input id="new-deal-analyst" type="text" value={newDealAnalyst} onChange={(e) => setNewDealAnalyst(e.target.value)} placeholder="e.g. Prince Realo" className={inputClass} />
              </FormField>
              <FormField label="Source" id="new-deal-source">
                <input id="new-deal-source" type="text" value={newDealSource} onChange={(e) => setNewDealSource(e.target.value)} placeholder="e.g. Broker / Direct" className={inputClass} />
              </FormField>
            </div>
          </div>

          {/* Financials */}
          <div className="space-y-3">
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">Financials (£)</p>
            <div className="grid grid-cols-4 gap-3">
              <FormField label="Revenue" id="new-deal-revenue">
                <input id="new-deal-revenue" type="number" step="any" value={newDealRevenue} onChange={(e) => setNewDealRevenue(e.target.value)} placeholder="0" className={inputClass} />
              </FormField>
              <FormField label="EBITDA" id="new-deal-ebitda">
                <input id="new-deal-ebitda" type="number" step="any" value={newDealEbitda} onChange={(e) => setNewDealEbitda(e.target.value)} placeholder="0" className={inputClass} />
              </FormField>
              <FormField label="Enterprise Value" id="new-deal-ev">
                <input id="new-deal-ev" type="number" step="any" value={newDealEV} onChange={(e) => setNewDealEV(e.target.value)} placeholder="0" className={inputClass} />
              </FormField>
              <FormField label="Asking Price" id="new-deal-asking">
                <input id="new-deal-asking" type="number" step="any" value={newDealAskingPrice} onChange={(e) => setNewDealAskingPrice(e.target.value)} placeholder="0" className={inputClass} />
              </FormField>
            </div>
          </div>

          {/* Workflow */}
          <div className="space-y-3">
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">Workflow</p>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Pipeline Stage" id="new-deal-stage">
                <select id="new-deal-stage" value={newDealStage} onChange={(e) => setNewDealStage(e.target.value)} className={selectClass}>
                  <option value="Intro">Intro</option>
                  <option value="Seller Call">Seller Call</option>
                  <option value="IM Review">IM Review</option>
                  <option value="Information Requested">Information Requested</option>
                  <option value="Offer Submitted">Offer Submitted</option>
                  <option value="Due Diligence">Due Diligence</option>
                </select>
              </FormField>
              <FormField label="ACP Reference" id="new-deal-ref">
                <input id="new-deal-ref" type="text" value={newDealRef} onChange={(e) => setNewDealRef(e.target.value)} placeholder="Auto-generated" className={inputClass} />
              </FormField>
              <FormField label="Target Date" id="new-deal-target-date">
                <input id="new-deal-target-date" type="date" value={newDealNextActionDate} onChange={(e) => setNewDealNextActionDate(e.target.value)} className={inputClass} />
              </FormField>
            </div>
            <FormField label="Next Action" id="new-deal-next-action">
              <input id="new-deal-next-action" type="text" value={newDealNextAction} onChange={(e) => setNewDealNextAction(e.target.value)} placeholder="e.g. Schedule initial discovery call" className={inputClass} />
            </FormField>
          </div>

          {/* Notes */}
          <FormField label="Internal Notes" id="new-deal-notes">
            <textarea id="new-deal-notes" value={newDealNotes} onChange={(e) => setNewDealNotes(e.target.value)} placeholder="Private internal notes..." rows={2} className={textareaClass} />
          </FormField>

          {/* IM & Attachments Upload Section */}
          <div className="space-y-3 pt-2 border-t border-white/[0.02]">
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500 font-sans">IM & Attachments (Optional)</p>
            
            {pendingFiles.length > 0 && (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {pendingFiles.map((file: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.015] border border-white/5 text-[11px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-3.5 w-3.5 text-[#C6A66B] shrink-0" />
                      <span className="text-white truncate font-medium">{file.fileName}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingFiles((prev: any) => prev.filter((_: any, i: number) => i !== idx))}
                      className="text-[10px] font-bold text-rose-450 hover:text-rose-400 select-none cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                  Array.from(files).forEach(file => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      const base64Data = (reader.result as string).split(",")[1];
                      setPendingFiles((prev: any[]) => [...prev, { fileName: file.name, fileType: file.type, fileData: base64Data }]);
                    };
                    reader.readAsDataURL(file);
                  });
                }
              }}
              className={cx(
                "border border-dashed rounded-xl p-6 text-center transition cursor-pointer select-none relative",
                dragActive
                  ? "border-[#C6A66B] bg-[#C6A66B]/5 text-white"
                  : "border-white/10 bg-white/[0.005] hover:border-white/20 text-slate-400"
              )}
            >
              <input
                type="file"
                id="add-deal-file-upload"
                accept=".pdf,.docx,.xlsx"
                multiple
                disabled={isUploadingFiles}
                onChange={(e) => {
                  const files = e.target.files;
                  if (files) {
                    Array.from(files).forEach(file => {
                      const reader = new FileReader();
                      reader.onload = () => {
                        const base64Data = (reader.result as string).split(",")[1];
                        setPendingFiles((prev: any[]) => [...prev, { fileName: file.name, fileType: file.type, fileData: base64Data }]);
                      };
                      reader.readAsDataURL(file);
                    });
                  }
                }}
                className="hidden"
              />
              <label htmlFor="add-deal-file-upload" className="cursor-pointer space-y-2 block">
                <div className="flex justify-center">
                  {isUploadingFiles ? (
                    <RefreshCw className="h-5 w-5 text-[#C6A66B] animate-spin" />
                  ) : (
                    <Upload className="h-5 w-5 text-slate-500" />
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">
                    {isUploadingFiles ? "Uploading attachments..." : "Drag & drop files here, or click to browse"}
                  </p>
                  <p className="text-[9px] text-slate-500 mt-1 font-medium">Supports PDF, DOCX, XLSX</p>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2.5 pt-2 border-t border-white/[0.02]">
            <button type="button" onClick={() => { setIsModalOpen(false); setPendingFiles([]); }} className="h-9 px-4 rounded-xl border border-white/[0.02] text-slate-400 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] transition cursor-pointer">
              Cancel
            </button>
            <button type="submit" disabled={isSubmittingDeal || isUploadingFiles} className="h-9 px-5 rounded-xl bg-gradient-to-r from-[#C6A66B] to-[#B8924F] text-slate-950 text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-bronze transition cursor-pointer">
              {isSubmittingDeal ? "Adding Deal..." : isUploadingFiles ? "Uploading Files..." : "Add Deal"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
