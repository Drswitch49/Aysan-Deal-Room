import { useState, useEffect, useMemo } from "react";
import { 
  Link2, KeyRound, Copy, Check, ShieldCheck, LockKeyhole,
  RotateCcw, Trash2, X, CheckCircle, Search, 
  Settings, ChevronDown, ChevronUp, Eye, EyeOff
} from "lucide-react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/ui/LoadingState";
import { Modal } from "../components/ui/Modal";
import { FormField, inputClass, selectClass } from "../components/ui/FormField";
import { 
  fetchAdminLenders, createLender, assignDealToLender, 
  removeDealAssignment, resetLenderPassword, regenerateLenderPortal, deleteLender,
  toggleLenderNda, fetchLenderPasscode
} from "../api/admin";
import { cx } from "../utils/cx";
import { usePipeline } from "../context/PipelineContext";
import { HeaderMetrics } from "../components/ui/HeaderMetrics";

type LenderAssignment = {
  assignmentId: string;
  dealRef: string;
  assignedAt: string;
  ndaApproved: boolean;
};

type Lender = {
  id: string;
  Lender_ID: string;
  Company_Name: string;
  Contact_Name?: string;
  Email?: string;
  Phone?: string;
  Portal_Slug: string;
  Portal_Password?: string;
  Status: string;
  assignments: LenderAssignment[];
  Created_At: string;
  ndaApproved: boolean;
  Criteria_Pills?: string;
  Last_Contact_Date?: string;
  Passcode_Plain?: string;
};

export function LenderManagementPage() {
  const [lenders, setLenders] = useState<Lender[]>([]);
  const { deals } = usePipeline();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [appetiteFilter, setAppetiteFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("name");

  // Selected Lender ID for bottom OSINT log view
  const [selectedOsintLenderId, setSelectedOsintLenderId] = useState<string>("");

  // Slide-over Side Drawer settings
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerLender, setDrawerLender] = useState<Lender | null>(null);

  // Passcode reveal states
  const [passcodeVisibleLenderId, setPasscodeVisibleLenderId] = useState<string | null>(null);
  const [passcodeText, setPasscodeText] = useState<string>("");
  const [fetchingPasscode, setFetchingPasscode] = useState(false);

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  
  const [selectedLender, setSelectedLender] = useState<Lender | null>(null);
  
  // Create / reset success details display
  const [createdLenderDetails, setCreatedLenderDetails] = useState<{ url: string; pass: string; company: string } | null>(null);
  const [newResetPassword, setNewResetPassword] = useState<string | null>(null);

  // Form Inputs
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [selectedDealRef, setSelectedDealRef] = useState("");
  const [modalNdaApproved, setModalNdaApproved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dealSearchQuery, setDealSearchQuery] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    setError("");
    try {
      const lendersList = await fetchAdminLenders();
      setLenders(lendersList);

      // Auto-select first lender for logs if none selected
      if (lendersList.length > 0 && !selectedOsintLenderId) {
        setSelectedOsintLenderId(lendersList[0].id);
      }

      // Sync side drawer state if open
      if (drawerLender) {
        const updated = lendersList.find((l: Lender) => l.id === drawerLender.id);
        if (updated) {
          setDrawerLender(updated);
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to query database schema.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const getPortalUrl = (slug: string) => {
    return `${window.location.origin}/portal/${slug}`;
  };

  const getDaysSinceLastContact = (dateStr?: string) => {
    if (!dateStr) return null;
    const diffTime = Date.now() - new Date(dateStr).getTime();
    return Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
  };

  const getCriteriaPills = (criteria?: string) => {
    if (!criteria || !criteria.trim()) return ["SME Debt"];
    return criteria.split(",").map(s => s.trim()).filter(Boolean);
  };

  const openPortalConfig = (lender: Lender) => {
    setDrawerLender(lender);
    setIsDrawerOpen(true);
    setPasscodeVisibleLenderId(null);
    setPasscodeText("");
  };

  async function togglePasscodeVisibility(lenderId: string) {
    if (passcodeVisibleLenderId === lenderId) {
      setPasscodeVisibleLenderId(null);
      setPasscodeText("");
    } else {
      setFetchingPasscode(true);
      try {
        const passcode = await fetchLenderPasscode(lenderId);
        setPasscodeText(passcode || "Awaiting Reset");
        setPasscodeVisibleLenderId(lenderId);
      } catch (err: any) {
        alert(err.message || "Failed to retrieve passcode.");
      } finally {
        setFetchingPasscode(false);
      }
    }
  }

  // Add Lender Handler
  async function handleAddLender(e: React.FormEvent) {
    e.preventDefault();
    if (!newCompanyName) return;
    setSubmitting(true);
    try {
      const result = await createLender({
        companyName: newCompanyName,
        contactName: newContactName,
        email: newEmail,
        phone: newPhone,
        status: "Active"
      });

      setNewCompanyName("");
      setNewContactName("");
      setNewEmail("");
      setNewPhone("");
      
      await loadData();

      setCreatedLenderDetails({
        url: getPortalUrl(result.Portal_Slug),
        pass: result.Portal_Password || "",
        company: result.Company_Name
      });
    } catch (err: any) {
      alert(err.message || "Error creating lender");
    } finally {
      setSubmitting(false);
    }
  }

  // Assign Deal Handler
  async function handleAssignDeal(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLender || !selectedDealRef) return;
    setSubmitting(true);
    try {
      await assignDealToLender(selectedLender.id, selectedDealRef, modalNdaApproved);
      setIsAssignModalOpen(false);
      setSelectedDealRef("");
      setModalNdaApproved(false);
      await loadData();
    } catch (err: any) {
      alert(err.message || "Error assigning deal");
    } finally {
      setSubmitting(false);
    }
  }

  // Remove Assignment Handler
  async function handleRemoveAssignment(asgId: string) {
    if (!confirm("Are you sure you want to revoke access to this deal?")) return;
    try {
      await removeDealAssignment(asgId);
      await loadData();
    } catch (err: any) {
      alert(err.message || "Error removing assignment");
    }
  }

  // Toggle NDA Approval Handler
  async function handleToggleLenderNda(lenderId: string, currentNdaState: boolean) {
    try {
      await toggleLenderNda(lenderId, currentNdaState);
      await loadData();
    } catch (err: any) {
      alert(err.message || "Error toggling NDA status");
    }
  }

  // Reset Password Handler
  async function handleResetPassword() {
    if (!selectedLender) return;
    setSubmitting(true);
    try {
      const result = await resetLenderPassword(selectedLender.id);
      setNewResetPassword(result.password);
      await loadData();
    } catch (err: any) {
      alert(err.message || "Error resetting password");
    } finally {
      setSubmitting(false);
    }
  }

  // Regenerate Slug Handler
  async function handleRegeneratePortal(lenderId: string) {
    if (!confirm("Regenerating the portal link will deactivate the old portal URL. Continue?")) return;
    try {
      await regenerateLenderPortal(lenderId);
      await loadData();
    } catch (err: any) {
      alert(err.message || "Error regenerating link");
    }
  }

  // Delete Lender Handler
  async function handleDeleteLender() {
    if (!selectedLender) return;
    setSubmitting(true);
    try {
      await deleteLender(selectedLender.id);
      setIsDeleteConfirmOpen(false);
      setIsDrawerOpen(false);
      setDrawerLender(null);
      setSelectedLender(null);
      await loadData();
    } catch (err: any) {
      alert(err.message || "Error deleting lender");
    } finally {
      setSubmitting(false);
    }
  }

  // Close modals safely
  function closeAddModal() {
    setIsAddModalOpen(false);
    setCreatedLenderDetails(null);
  }

  function closeResetModal() {
    setIsResetConfirmOpen(false);
    setNewResetPassword(null);
    setSelectedLender(null);
  }

  function closeDeleteModal() {
    setIsDeleteConfirmOpen(false);
    setSelectedLender(null);
    setDeleteConfirmText("");
  }

  // Compute metrics dynamically from the live Lenders records
  const activeLendersCount = useMemo(() => {
    return lenders.filter(l => l.Status === "Active").length;
  }, [lenders]);

  const staleLendersCount = useMemo(() => {
    return lenders.filter(l => {
      const days = getDaysSinceLastContact(l.Last_Contact_Date);
      return days === null || days > 90;
    }).length;
  }, [lenders]);

  const staleLenderName = useMemo(() => {
    const staleItem = lenders.find(l => {
      const days = getDaysSinceLastContact(l.Last_Contact_Date);
      return days === null || days > 90;
    });
    return staleItem ? staleItem.Company_Name : "None";
  }, [lenders]);

  const liveSubmissionsCount = useMemo(() => {
    return lenders.filter(l => l.assignments && l.assignments.length > 0).length;
  }, [lenders]);

  // Filters & Sorting calculations
  const filteredAndSortedLenders = useMemo(() => {
    return lenders
      .filter((l) => {
        if (searchQuery.trim() !== "") {
          const q = searchQuery.toLowerCase();
          const name = (l.Company_Name || "").toLowerCase();
          const contact = (l.Contact_Name || "").toLowerCase();
          const email = (l.Email || "").toLowerCase();
          return name.includes(q) || contact.includes(q) || email.includes(q);
        }
        return true;
      })
      .filter((l) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "active") return l.Status === "Active";
        if (statusFilter === "inactive") return l.Status === "Inactive";
        if (statusFilter === "stale") {
          const days = getDaysSinceLastContact(l.Last_Contact_Date);
          return days === null || days > 90;
        }
        return true;
      })
      .filter((l) => {
        if (appetiteFilter === "all") return true;
        const criteria = (l.Criteria_Pills || "").toLowerCase();
        if (appetiteFilter === "small") {
          return criteria.includes("k") && (criteria.includes("50k") || criteria.includes("100k") || criteria.includes("200k"));
        }
        if (appetiteFilter === "medium") {
          return criteria.includes("250k") || criteria.includes("500k") || criteria.includes("1000k") || criteria.includes("1m");
        }
        if (appetiteFilter === "large") {
          return criteria.includes("2000k") || criteria.includes("5000k") || criteria.includes("10000k") || criteria.includes("15000k") || criteria.includes("m") && !criteria.includes("1m ");
        }
        return true;
      })
      .sort((a, b) => {
        if (sortOrder === "name") {
          return (a.Company_Name || "").localeCompare(b.Company_Name || "");
        }
        if (sortOrder === "assignments") {
          return (b.assignments?.length || 0) - (a.assignments?.length || 0);
        }
        if (sortOrder === "last_contact") {
          if (!a.Last_Contact_Date) return 1;
          if (!b.Last_Contact_Date) return -1;
          return new Date(b.Last_Contact_Date).getTime() - new Date(a.Last_Contact_Date).getTime();
        }
        return 0;
      });
  }, [lenders, searchQuery, statusFilter, appetiteFilter, sortOrder]);

  const selectedLenderInfo = useMemo(() => {
    return lenders.find(l => l.id === selectedOsintLenderId) || lenders[0];
  }, [lenders, selectedOsintLenderId]);

  // Compute real dynamic logs from DB states instead of static text
  const lenderAuditLogs = useMemo(() => {
    if (!selectedLenderInfo) return [];
    const logs: Array<{ text: string; source: string; date: string; isGreenDot?: boolean }> = [];
    
    if (selectedLenderInfo.Created_At) {
      logs.push({
        text: `Portal setup verified and access token initialized for ${selectedLenderInfo.Company_Name}`,
        source: "ACP Security Node",
        date: new Date(selectedLenderInfo.Created_At).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
        isGreenDot: true
      });
    }

    if (selectedLenderInfo.ndaApproved) {
      logs.push({
        text: `Non-Disclosure Agreement signed and compliance status approved`,
        source: "ACP Compliance Engine",
        date: "Current Active Status",
        isGreenDot: true
      });
    }

    if (selectedLenderInfo.assignments) {
      selectedLenderInfo.assignments.forEach(asg => {
        logs.push({
          text: `Granted portal review access to Acquisition Deal Room [${asg.dealRef}]`,
          source: "Deal Lifecycle manager",
          date: asg.assignedAt 
            ? new Date(asg.assignedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            : "Recently"
        });
      });
    }

    return logs;
  }, [selectedLenderInfo]);

  return (
    <div className="space-y-6 text-[#E2E8F0] font-sans">
      
      {/* Title block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white tracking-tight">
            Lender <span className="text-[#C6A66B]">Intelligence</span>
          </h1>
          <p className="text-xs text-slate-400 font-medium">
            {activeLendersCount} active lenders tracked — {staleLendersCount} stale record{staleLendersCount !== 1 ? 's' : ''}
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <HeaderMetrics />
          
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.02] bg-white/[0.015] px-3.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-300 shadow-sm hover:bg-white/[0.02] hover:text-white cursor-pointer transition"
          >
            + NEW LENDER
          </button>
        </div>
      </div>

      {isLoading && <LoadingState />}

      {error && (
        <div className="rounded-2xl border border-rose-500/10 bg-rose-500/5 p-6 text-center text-xs font-semibold text-rose-400 border-l-4 border-l-rose-500">
          {error}
        </div>
      )}

      {!isLoading && !error && (
        <div className="space-y-6">
          
          {/* Summary metrics row */}
          <div className="grid gap-4 sm:grid-cols-3">
            {/* Active Lenders */}
            <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 shadow-premium-card card-sheen select-none">
              <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-550">Active Lenders</p>
              <h2 className="text-3xl font-black text-white mt-1.5 tracking-tight">{activeLendersCount}</h2>
            </div>

            {/* Stale Records */}
            <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 shadow-premium-card card-sheen select-none">
              <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-550">Stale Records</p>
              <h2 className="text-3xl font-black text-white mt-1.5 tracking-tight">{staleLendersCount}</h2>
              <p className="text-[10px] font-bold text-amber-500 mt-1">&gt;90 days — {staleLenderName}</p>
            </div>

            {/* Live Submissions */}
            <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 shadow-premium-card card-sheen select-none">
              <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-550">Live Submissions</p>
              <h2 className="text-3xl font-black text-white mt-1.5 tracking-tight">{liveSubmissionsCount}</h2>
              <p className="text-[10px] font-bold text-slate-550 mt-1">Total active deal assignments</p>
            </div>
          </div>

          {/* Search & Filters Controls Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#161B22] border border-white/[0.04] p-4 rounded-2xl">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search by company, contact, email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#0F1115] pl-10 pr-4 text-xs text-white placeholder-slate-500 outline-none focus:border-[#C6A66B] transition"
              />
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-10 rounded-xl border border-white/[0.08] bg-[#0F1115] px-3.5 text-xs text-slate-300 outline-none cursor-pointer focus:border-[#C6A66B] transition"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active Status</option>
                <option value="inactive">Inactive Status</option>
                <option value="stale">Touch-point Due (&gt;90d)</option>
              </select>

              <select
                value={appetiteFilter}
                onChange={(e) => setAppetiteFilter(e.target.value)}
                className="h-10 rounded-xl border border-white/[0.08] bg-[#0F1115] px-3.5 text-xs text-slate-300 outline-none cursor-pointer focus:border-[#C6A66B] transition"
              >
                <option value="all">All Appetite Sizes</option>
                <option value="small">Small Tier (&lt; £250k)</option>
                <option value="medium">Mid Tier (£250k - £1M)</option>
                <option value="large">Large Tier (&gt; £1M)</option>
              </select>

              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="h-10 rounded-xl border border-white/[0.08] bg-[#0F1115] px-3.5 text-xs text-slate-300 outline-none cursor-pointer focus:border-[#C6A66B] transition"
              >
                <option value="name">Sort: Company Name</option>
                <option value="assignments">Sort: Active Deals</option>
                <option value="last_contact">Sort: Last Contact</option>
              </select>
            </div>
          </div>

          {/* Interactive Cards Grid */}
          <div className="flex items-center justify-between mt-8 select-none">
            <h3 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400">
              Lender Grid ({filteredAndSortedLenders.length})
            </h3>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-[#C6A66B]/35 bg-[#C6A66B]/5 px-3.5 text-[9px] font-black uppercase text-[#C6A66B] hover:bg-[#C6A66B]/10 transition cursor-pointer"
            >
              + Create Lender Portal
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {filteredAndSortedLenders.map((lender) => {
              const isSelected = selectedOsintLenderId === lender.id;
              const daysSinceContact = getDaysSinceLastContact(lender.Last_Contact_Date);
              
              const isStale = daysSinceContact === null || daysSinceContact > 90;
              const badgeText = lender.Status === "Inactive" ? "INACTIVE" : isStale ? "TOUCH-POINT DUE" : "ACTIVE";
              const badgeColor = lender.Status === "Inactive" ? "grey" : isStale ? "yellow" : "green";

              const lastContactText = daysSinceContact !== null 
                ? `Last contact: ${new Date(lender.Last_Contact_Date!).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} — ${daysSinceContact}d ago`
                : "Last contact: Pending Log";
              const lastContactColor = daysSinceContact === null || daysSinceContact > 90 ? "red" : "grey";

              return (
                <div 
                  key={lender.id}
                  onClick={() => setSelectedOsintLenderId(lender.id)}
                  className={cx(
                    "rounded-2xl border bg-[#161B22] p-5 shadow-premium-card card-sheen flex flex-col justify-between transition-all cursor-pointer relative group",
                    isSelected ? "border-[#C6A66B]/40 bg-[#0c1122]/30 shadow-inner" : "border-white/[0.02] hover:border-white/12"
                  )}
                >
                  <div>
                    {/* Card Header with Title and Badge */}
                    <div className="flex items-start justify-between gap-4">
                      <h4 className="text-sm font-bold text-white tracking-tight leading-tight select-none">
                        {lender.Company_Name}
                      </h4>
                      <span className={cx(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[8px] font-black uppercase tracking-wider select-none shrink-0 border",
                        badgeColor === "green" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                        badgeColor === "yellow" ? "bg-amber-500/10 text-amber-550 border-amber-500/20" :
                        "bg-white/[0.015] text-slate-400 border-white/[0.02]"
                      )}>
                        {badgeText}
                      </span>
                    </div>

                    {/* Subtitle / Contacts */}
                    <p className="mt-1 text-[10px] font-bold text-slate-500 leading-tight">
                      {lender.Contact_Name ? `${lender.Contact_Name} — Relationship active` : "No contact registered"}
                    </p>

                    {/* Last Contact Info */}
                    <p className={cx(
                      "mt-4 text-[10px] font-black select-none uppercase tracking-wide",
                      lastContactColor === "red" ? "text-rose-500" : "text-slate-400"
                    )}>
                      {lastContactText}
                    </p>
                  </div>

                  {/* Criteria Pills and Setup settings */}
                  <div className="mt-5 space-y-4">
                    {/* Target criteria horizontal pills */}
                    <div className="flex flex-wrap gap-1.5 select-none">
                      {getCriteriaPills(lender.Criteria_Pills).map((pill, idx) => (
                        <span 
                          key={idx} 
                          className="inline-flex items-center rounded-md bg-[#131E35] border border-blue-500/10 px-2 py-0.5 text-[9px] font-black text-blue-400"
                        >
                          {pill}
                        </span>
                      ))}
                    </div>

                    {/* Portal Actions Control Panel Trigger */}
                    <div 
                      className="border-t border-white/[0.02] pt-3.5 mt-3 flex items-center justify-between gap-2"
                      onClick={(e) => e.stopPropagation()} // block parent click
                    >
                      <div className="flex items-center gap-1 text-[9px] font-extrabold uppercase text-slate-500 tracking-wider">
                        {lender.Portal_Slug ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <ShieldCheck className="h-3.5 w-3.5" /> Portal Connected
                          </span>
                        ) : (
                          <span className="text-slate-650 flex items-center gap-1">
                            <LockKeyhole className="h-3.5 w-3.5" /> Offline Profile
                          </span>
                        )}
                      </div>
                      
                      <button
                        onClick={() => openPortalConfig(lender)}
                        className="inline-flex h-6.5 items-center gap-1 rounded px-2.5 text-[9px] font-extrabold uppercase tracking-wide border border-white/[0.02] bg-white/[0.015] text-slate-350 hover:bg-white/[0.02] transition cursor-pointer select-none"
                      >
                        <Settings className="h-3 w-3" />
                        <span>Portal Config</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* OSINT Intelligence Log Section */}
          {selectedLenderInfo && (
            <div className="mt-8 rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 shadow-premium-card card-sheen">
              <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400 border-b border-white/[0.02] pb-2.5 select-none">
                OSINT Intelligence Log — {selectedLenderInfo.Company_Name.toUpperCase()}
              </h3>
              
              <div className="mt-4 space-y-4 font-sans">
                {lenderAuditLogs.map((log, idx) => (
                  <div key={idx} className="flex items-start gap-3 animate-fade-in">
                    <span className={cx(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      log.isGreenDot ? "bg-emerald-400" : "bg-blue-450"
                    )} />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white leading-tight">
                        {log.text}
                      </p>
                      <p className="mt-1 text-[9px] font-semibold text-slate-550 leading-none">
                        Source: {log.source} — {log.date}
                      </p>
                    </div>
                  </div>
                ))}

                {lenderAuditLogs.length === 0 && (
                  <p className="text-xs text-slate-400 font-medium py-3 text-center">
                    No recent activities recorded for this lender.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SLIDE-OVER SIDE DRAWER: PORTAL CONFIG */}
      {isDrawerOpen && drawerLender && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop with transition */}
          <div 
            className="fixed inset-0 bg-[#07090c]/85 backdrop-blur-sm transition-opacity" 
            onClick={() => {
              setIsDrawerOpen(false);
              setDrawerLender(null);
            }} 
          />
          
          {/* Drawer panel */}
          <div className="relative w-full max-w-lg bg-[#0F1115] border-l border-white/10 h-full p-6 flex flex-col justify-between shadow-2xl z-10 text-slate-100 overflow-y-auto font-sans">
            <div>
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-6">
                <div className="space-y-1">
                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#C6A66B]">Portal Administration</span>
                  <h2 className="text-lg font-bold text-white tracking-tight">{drawerLender.Company_Name}</h2>
                </div>
                <button 
                  onClick={() => {
                    setIsDrawerOpen(false);
                    setDrawerLender(null);
                  }}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/5 bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Content Sections */}
              <div className="space-y-6">
                {/* Contact card */}
                <div className="bg-white/[0.01] border border-white/5 rounded-xl p-4 space-y-2 text-xs">
                  <p className="text-slate-400"><strong className="text-slate-300">Contact:</strong> {drawerLender.Contact_Name || "None registered"}</p>
                  <p className="text-slate-400"><strong className="text-slate-300">Email:</strong> {drawerLender.Email || "None registered"}</p>
                  <p className="text-slate-400"><strong className="text-slate-300">Phone:</strong> {drawerLender.Phone || "None registered"}</p>
                </div>

                {/* Secure Access Link */}
                <div className="space-y-1.5">
                  <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-550">Secure Access Link</label>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-mono text-slate-400 truncate flex-1 bg-white/[0.02] border border-white/5 rounded-lg px-2.5 py-2 select-all">
                      {getPortalUrl(drawerLender.Portal_Slug)}
                    </span>
                    <button
                      onClick={() => handleCopy(getPortalUrl(drawerLender.Portal_Slug), `${drawerLender.id}-url`)}
                      className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg bg-white/[0.015] border border-white/[0.02] text-slate-300 hover:text-white hover:bg-white/5 transition cursor-pointer"
                      title="Copy URL"
                    >
                      {copiedId === `${drawerLender.id}-url` ? <Check className="h-4 w-4 text-emerald-450" /> : <Link2 className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Passcode & Compliance */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-550">Portal Passcode</label>
                    <div className="flex items-center justify-between gap-1.5 bg-white/[0.02] border border-white/5 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-slate-450">
                      <div className="flex items-center gap-1.5 truncate">
                        <KeyRound className="h-3.5 w-3.5 text-[#C6A66B] shrink-0" />
                        <span className="truncate text-slate-300 select-all">
                          {passcodeVisibleLenderId === drawerLender.id ? passcodeText : "••••••••"}
                        </span>
                      </div>
                      <button
                        onClick={() => togglePasscodeVisibility(drawerLender.id)}
                        disabled={fetchingPasscode}
                        className="text-slate-450 hover:text-white transition p-1 shrink-0 cursor-pointer"
                        title={passcodeVisibleLenderId === drawerLender.id ? "Hide passcode" : "Show passcode"}
                      >
                        {passcodeVisibleLenderId === drawerLender.id ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-555">NDA Compliance</label>
                    <select
                      value={drawerLender.ndaApproved ? "Yes" : "No"}
                      onChange={(e) => handleToggleLenderNda(drawerLender.id, e.target.value === "Yes")}
                      className={cx(
                        "h-8.5 w-full bg-[#161B22] border rounded-lg px-2.5 text-[10px] font-bold outline-none cursor-pointer text-center",
                        drawerLender.ndaApproved 
                          ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5" 
                          : "text-amber-400 border-amber-500/20 bg-amber-500/5"
                      )}
                      style={{ appearance: "auto" }}
                    >
                      <option value="Yes">NDA: Yes</option>
                      <option value="No">NDA: No</option>
                    </select>
                  </div>
                </div>

                {/* Assigned Deals */}
                <div className="space-y-2 pt-4 border-t border-white/5">
                  <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-550">Assigned Acquisition Deals</label>
                  <div className="flex flex-wrap gap-2 mt-1.5 items-center select-none">
                    {drawerLender.assignments.map((asg) => (
                      <span
                        key={asg.assignmentId}
                        className={cx(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold tracking-wide transition-colors",
                          drawerLender.ndaApproved 
                            ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400"
                            : "border-amber-500/20 bg-amber-500/5 text-amber-400"
                        )}
                      >
                        <Link
                          to={`/deals/${encodeURIComponent(asg.dealRef)}?tab=chat&lenderId=${drawerLender.id}`}
                          className="hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          {asg.dealRef}
                        </Link>
                        <button
                          onClick={() => handleRemoveAssignment(asg.assignmentId)}
                          className="text-slate-500 hover:text-rose-500 transition cursor-pointer shrink-0 ml-1"
                          title="Revoke access"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}

                    <button
                      onClick={() => {
                        setSelectedLender(drawerLender);
                        setDealSearchQuery("");
                        setSelectedDealRef("");
                        setModalNdaApproved(drawerLender.ndaApproved);
                        setIsAssignModalOpen(true);
                      }}
                      className="inline-flex items-center justify-center h-6.5 px-3 rounded-full bg-[#C6A66B]/10 border border-[#C6A66B]/20 text-[#C6A66B] hover:bg-[#C6A66B] hover:text-white transition cursor-pointer shrink-0 font-extrabold uppercase text-[9px] tracking-wide"
                      title="Assign deal"
                    >
                      + Assign Deal
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Controls */}
            <div className="pt-6 border-t border-white/5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => {
                    setSelectedLender(drawerLender);
                    setIsResetConfirmOpen(true);
                  }}
                  className="flex-1 inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-white/5 bg-white/[0.01] text-[10px] font-bold uppercase tracking-wider text-slate-350 hover:bg-white/5 transition cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Reset Pass</span>
                </button>
                
                <button
                  onClick={() => handleRegeneratePortal(drawerLender.id)}
                  className="flex-1 inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-white/5 bg-white/[0.01] text-[10px] font-bold uppercase tracking-wider text-slate-355 hover:bg-white/5 transition cursor-pointer"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  <span>New Link</span>
                </button>
              </div>

              <button
                onClick={() => {
                  setSelectedLender(drawerLender);
                  setIsDeleteConfirmOpen(true);
                }}
                className="w-full inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/5 text-[10px] font-bold uppercase tracking-wider text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/30 transition cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Permanently Delete Profile</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: CREATE NEW LENDER */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={closeAddModal}
        title={createdLenderDetails ? "Portal Access Ready" : "Create New Lender"}
        onSubmit={!createdLenderDetails ? handleAddLender : undefined}
        footer={!createdLenderDetails ? (
          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-bronze disabled:opacity-40 select-none cursor-pointer"
          >
            {submitting ? "Creating..." : "Generate Portal Access"}
          </button>
        ) : (
          <button
            onClick={closeAddModal}
            className="w-full inline-flex h-10 items-center justify-center rounded-xl bg-white/[0.015] border border-white/[0.02] text-xs font-bold uppercase tracking-wider text-white hover:bg-white/[0.02]"
          >
            Done
          </button>
        )}
      >
        {!createdLenderDetails ? (
          <div className="space-y-4">
            <FormField label="Company Name" required id="add-lender-company">
              <input
                id="add-lender-company"
                type="text"
                required
                value={newCompanyName}
                onChange={(e) => setNewCompanyName(e.target.value)}
                placeholder="e.g. Moorfields Capital"
                className={inputClass}
              />
            </FormField>

            <FormField label="Contact Name" id="add-lender-contact">
              <input
                id="add-lender-contact"
                type="text"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                placeholder="e.g. Lee Coutanche"
                className={inputClass}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Email Address" id="add-lender-email">
                <input
                  id="add-lender-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="e.g. contact@moorfields.com"
                  className={inputClass}
                />
              </FormField>
              <FormField label="Phone Number" id="add-lender-phone">
                <input
                  id="add-lender-phone"
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="e.g. +44 790 798 1105"
                  className={inputClass}
                />
              </FormField>
            </div>
          </div>
        ) : (
          <div className="space-y-5 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-450 border border-emerald-500/20 mx-auto">
              <CheckCircle className="h-6 w-6" />
            </div>
            <p className="text-xs text-slate-400">Lender portal generated successfully for {createdLenderDetails.company}.</p>

            <div className="text-left space-y-3.5 bg-white/[0.015] border border-white/[0.02] rounded-xl p-4">
              {/* URL */}
              <div>
                <span className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Secure URL</span>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] font-mono text-white truncate flex-1 bg-white/[0.015] border border-white/5 rounded-lg px-2.5 py-1">{createdLenderDetails.url}</span>
                  <button
                    onClick={() => handleCopy(createdLenderDetails.url, "modal-url")}
                    className="h-7 w-7 flex items-center justify-center rounded-lg bg-white/[0.015] border border-white/[0.02] text-slate-355 hover:text-white"
                  >
                    {copiedId === "modal-url" ? <Check className="h-3.5 w-3.5 text-emerald-455" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Password */}
              <div>
                <span className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Temporary Passcode</span>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[12px] font-mono font-bold text-acp-bronze bg-white/[0.015] border border-white/5 rounded-lg px-2.5 py-1 flex-1">{createdLenderDetails.pass}</span>
                  <button
                    onClick={() => handleCopy(createdLenderDetails.pass, "modal-pass")}
                    className="h-7 w-7 flex items-center justify-center rounded-lg bg-white/[0.015] border border-white/[0.02] text-slate-355 hover:text-white"
                  >
                    {copiedId === "modal-pass" ? <Check className="h-3.5 w-3.5 text-emerald-455" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* MODAL 2: ASSIGN DEALS */}
      <Modal 
        isOpen={isAssignModalOpen && selectedLender !== null} 
        onClose={() => {
          setIsAssignModalOpen(false);
          setSelectedLender(null);
          setModalNdaApproved(false);
        }} 
        title="Assign Deal Access"
        onSubmit={handleAssignDeal}
        footer={(
          <button
            type="submit"
            disabled={submitting || !selectedDealRef}
            className="w-full inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-bronze disabled:opacity-40 cursor-pointer"
          >
            {submitting ? "Assigning..." : "Assign Access"}
          </button>
        )}
      >
        {selectedLender && (
          <div className="space-y-4">
            <p className="text-xs text-slate-400 leading-relaxed">Grant portal review access to {selectedLender.Company_Name}.</p>

            <FormField label="Select Acquisition Deal" id="deal-search-input">
              {/* Search Bar Input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  id="deal-search-input"
                  type="text"
                  placeholder="Search by Deal ID or Company Name..."
                  value={dealSearchQuery}
                  onChange={(e) => setDealSearchQuery(e.target.value)}
                  className={cx(inputClass, "pl-9")}
                />
              </div>
            </FormField>

            {/* Searchable Scroll Container */}
            <div className="max-h-48 overflow-y-auto rounded-xl border border-white/[0.02] bg-[#0F1115] divide-y divide-white/[0.04] custom-scrollbar select-none">
              {deals
                .filter(deal => !selectedLender.assignments.some(a => a.dealRef === deal.dealRef))
                .filter(deal => {
                  if (!dealSearchQuery.trim()) return true;
                  const q = dealSearchQuery.toLowerCase();
                  const refStr = String(deal.dealRef || "").toLowerCase();
                  const company = String(deal.companyName || "").toLowerCase();
                  return refStr.includes(q) || company.includes(q);
                })
                .map(deal => {
                  const isSelected = selectedDealRef === deal.dealRef;
                  return (
                    <button
                      key={deal.id}
                      type="button"
                      onClick={() => setSelectedDealRef(deal.dealRef)}
                      className={cx(
                        "w-full text-left px-3.5 py-2.5 text-xs transition-colors flex items-center justify-between cursor-pointer",
                        isSelected 
                          ? "bg-acp-bronze/10 text-white font-bold" 
                          : "text-slate-350 hover:bg-white/[0.015]"
                      )}
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-white">{deal.dealRef}</span>
                        <span className="text-slate-450 ml-2">— {deal.companyName || "Not specified"}</span>
                      </div>
                      {isSelected && <Check className="h-4 w-4 text-acp-bronze shrink-0" />}
                    </button>
                  );
                })}

              {deals
                .filter(deal => !selectedLender.assignments.some(a => a.dealRef === deal.dealRef))
                .filter(deal => {
                  if (!dealSearchQuery.trim()) return true;
                  const q = dealSearchQuery.toLowerCase();
                  const refStr = String(deal.dealRef || "").toLowerCase();
                  const company = String(deal.companyName || "").toLowerCase();
                  return refStr.includes(q) || company.includes(q);
                }).length === 0 && (
                  <div className="p-4 text-center text-xs text-slate-500 font-medium">
                    No assignable deals found
                  </div>
                )}
            </div>

            <FormField label="NDA Status" id="modal-nda-select">
              <select
                id="modal-nda-select"
                value={modalNdaApproved ? "Yes" : "No"}
                onChange={(e) => setModalNdaApproved(e.target.value === "Yes")}
                className={selectClass}
              >
                <option value="No">NDA Approved: No</option>
                <option value="Yes">NDA Approved: Yes</option>
              </select>
            </FormField>

          </div>
        )}
      </Modal>

      {/* MODAL 3: PASSWORD RESET CONFIRMATION */}
      <Modal 
        isOpen={isResetConfirmOpen && selectedLender !== null} 
        onClose={closeResetModal} 
        title={newResetPassword ? "Passcode Reset Complete" : "Reset Passcode?"}
      >
        {selectedLender && (
          <div className="text-center">
            {!newResetPassword ? (
              <div className="space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-450 border border-rose-500/20 mx-auto">
                  <RotateCcw className="h-6 w-6" />
                </div>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">This will immediately revoke the current passcode for {selectedLender.Company_Name}.</p>
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={closeResetModal}
                    className="flex-1 inline-flex h-10 items-center justify-center rounded-xl bg-white/[0.015] border border-white/[0.02] text-xs font-bold uppercase tracking-wider text-white hover:bg-white/[0.02] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleResetPassword}
                    disabled={submitting}
                    className="flex-1 inline-flex h-10 items-center justify-center rounded-xl bg-rose-500 text-xs font-bold uppercase tracking-wider text-white hover:bg-rose-650 disabled:opacity-40 cursor-pointer"
                  >
                    {submitting ? "Resetting..." : "Confirm Reset"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-450 border border-emerald-500/20 mx-auto">
                  <CheckCircle className="h-6 w-6" />
                </div>
                <p className="text-xs text-slate-400 mt-1">The new passcode is successfully written to database.</p>

                <div className="bg-white/[0.015] border border-white/[0.02] rounded-xl p-4 text-left">
                  <span className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">New Passcode</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[12px] font-mono font-bold text-acp-bronze bg-white/[0.015] border border-white/5 rounded-lg px-2.5 py-1 flex-1">{newResetPassword}</span>
                    <button
                      onClick={() => handleCopy(newResetPassword || "", "modal-reset-pass")}
                      className="h-7 w-7 flex items-center justify-center rounded-lg bg-white/[0.015] border border-white/[0.02] text-slate-350 hover:text-white"
                    >
                      {copiedId === "modal-reset-pass" ? <Check className="h-3.5 w-3.5 text-emerald-450" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <button
                  onClick={closeResetModal}
                  className="w-full inline-flex h-10 items-center justify-center rounded-xl bg-white/[0.015] border border-white/[0.02] text-xs font-bold uppercase tracking-wider text-white hover:bg-white/[0.02] mt-4 cursor-pointer"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* MODAL 4: DELETE LENDER CONFIRMATION */}
      <Modal 
        isOpen={isDeleteConfirmOpen && selectedLender !== null} 
        onClose={closeDeleteModal} 
        title="Delete Lender?"
      >
        {selectedLender && (
          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-455 border border-rose-500/20 mx-auto">
              <Trash2 className="h-6 w-6" />
            </div>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed text-center">
              Are you sure you want to delete <strong>{selectedLender.Company_Name}</strong>? This will permanently remove their portal access and all active deal assignments in Airtable.
            </p>

            <FormField label="Type company name to confirm" id="delete-confirm-input">
              <input
                id="delete-confirm-input"
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={selectedLender.Company_Name}
                className={cx(inputClass, "focus:border-rose-500")}
              />
            </FormField>

            <div className="flex gap-3 pt-4">
              <button
                onClick={closeDeleteModal}
                className="flex-1 inline-flex h-10 items-center justify-center rounded-xl bg-white/[0.015] border border-white/[0.02] text-xs font-bold uppercase tracking-wider text-white hover:bg-white/[0.02] cursor-pointer"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteLender}
                disabled={submitting || deleteConfirmText.trim() !== selectedLender.Company_Name.trim()}
                className="flex-1 inline-flex h-10 items-center justify-center rounded-xl bg-rose-500 text-xs font-bold uppercase tracking-wider text-white hover:bg-rose-600 disabled:opacity-40 cursor-pointer"
                type="button"
              >
                {submitting ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
