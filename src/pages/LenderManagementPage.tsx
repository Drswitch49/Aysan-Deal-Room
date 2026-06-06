import { useState, useEffect, useMemo } from "react";
import { 
  Building2, Users, Link2, KeyRound, Copy, Check, ShieldCheck, LockKeyhole,
  RotateCcw, Trash2, UserPlus, X, ChevronRight, Ban, CheckCircle, ExternalLink, Search, 
  MessageSquare, Settings, ChevronDown, ChevronUp, AlertCircle, Database
} from "lucide-react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/ui/LoadingState";
import { 
  fetchAdminLenders, createLender, assignDealToLender, 
  removeDealAssignment, resetLenderPassword, regenerateLenderPortal, deleteLender,
  toggleLenderNda
} from "../api/admin";
import type { PipelineDeal } from "../types/deal";
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
};

// High-Fidelity Mock & Target Criteria mappings to merge with real DB records
const mockLenderDetails: Record<string, {
  displayName: string;
  badgeText: "PRIMARY" | "ACTIVE" | "TOUCH-POINT DUE";
  badgeColor: "green" | "grey" | "yellow";
  subtitle: string;
  lastContactText: string;
  lastContactColor: "blue" | "red" | "grey";
  criteriaPills: string[];
  osintLogs: Array<{ text: string; source: string; date: string; isGreenDot?: boolean }>;
}> = {
  "moorfields": {
    displayName: "Moorfields Commercial Finance",
    badgeText: "PRIMARY",
    badgeColor: "green",
    subtitle: "Lee Coutanche — Relationship active",
    lastContactText: "Last contact: 22 May 2026 — MGL submission live",
    lastContactColor: "blue",
    criteriaPills: ["£100k - £2000k", "No CVA", "3-5m pack gain"],
    osintLogs: [
      { text: "Moorfields announced expansion of corporate finance advisory team in North West", source: "Moorfields PR — 25 May 2026", date: "25 May 2026" },
      { text: "Director shared case study about successfully funding £1.8m engineering acquisition", source: "LinkedIn — 21 May 2026", date: "21 May 2026" },
      { text: "Moorfields SME debt fund confirms deployment target of £50m for remainder of 2026", source: "Industry news — May 2026", date: "May 2026", isGreenDot: true }
    ]
  },
  "hsbc": {
    displayName: "HSBC Commercial",
    badgeText: "ACTIVE",
    badgeColor: "grey",
    subtitle: "Senior relationship — OSINT tracked",
    lastContactText: "Last contact: 15 Apr 2026 — 41 days ago",
    lastContactColor: "grey",
    criteriaPills: ["£250k - £5000k", "No CVA", "Auto-captured updates"],
    osintLogs: [
      { text: "HSBC published SME lending appetite update — increased focus on essential services Q2 2026", source: "HSBC press release — 20 May 2026 — Auto-captured", date: "20 May 2026" },
      { text: "Senior relationship manager posted about FM sector funding appetite on LinkedIn", source: "LinkedIn scraper — 18 May 2026", date: "18 May 2026" },
      { text: "BoE base rate stable at 4.25% — HSBC SME spread estimated 3.5-4.5% over base", source: "FT.com + HSBC product sheet — May 2026", date: "May 2026", isGreenDot: true }
    ]
  },
  "lendo": {
    displayName: "Lendo",
    badgeText: "TOUCH-POINT DUE",
    badgeColor: "yellow",
    subtitle: "Alternative finance — Warm relationship",
    lastContactText: "Last contact: 10 Feb 2026 — 106 days — stale",
    lastContactColor: "red",
    criteriaPills: ["£50k - £1000k", "Asset Backed", "10-15% range"],
    osintLogs: [
      { text: "Lendo updates platform terms for secured lending facility lines", source: "Lendo website — 14 May 2026", date: "14 May 2026" },
      { text: "CEO interview outlines new £10m funding backing from institutional investors", source: "TechCrunch — 28 Apr 2026", date: "28 Apr 2026" }
    ]
  },
  "reward": {
    displayName: "Reward Finance",
    badgeText: "ACTIVE",
    badgeColor: "grey",
    subtitle: "Asset-based lending",
    lastContactText: "Last contact: 3 May 2026 — 32 days ago",
    lastContactColor: "grey",
    criteriaPills: ["£100k - £1500k", "Property security", "Quick completion"],
    osintLogs: [
      { text: "Reward Finance expands regional presence with new corporate development managers", source: "Reward News — 10 May 2026", date: "10 May 2026" },
      { text: "Case study published on £750k short-term bridge facility for manufacturing client", source: "Reward Finance Case Studies — 02 May 2026", date: "02 May 2026" }
    ]
  },
  "sammy": {
    displayName: "Sammy Automations",
    badgeText: "ACTIVE",
    badgeColor: "grey",
    subtitle: "Samuel A. — Relationship active",
    lastContactText: "Last contact: 28 May 2026 — 7 days ago",
    lastContactColor: "grey",
    criteriaPills: ["£50k - £500k", "Automated billing", "SaaS recurring"],
    osintLogs: [
      { text: "Sammy Automations integrates direct ledger sync capabilities", source: "Product log — May 2026", date: "May 2026" }
    ]
  },
  "barclays": {
    displayName: "Barclays Business",
    badgeText: "ACTIVE",
    badgeColor: "grey",
    subtitle: "John Smith — OSINT tracked",
    lastContactText: "Last contact: 12 May 2026 — 23 days ago",
    lastContactColor: "grey",
    criteriaPills: ["£500k - £10000k", "Corporate tier", "Debt fund stack"],
    osintLogs: [
      { text: "Barclays SME lending tracker reports Q1 growth in mid-market manufacturing queries", source: "Barclays research — 15 May 2026", date: "15 May 2026" }
    ]
  },
  "oaknorth": {
    displayName: "OakNorth Bank",
    badgeText: "ACTIVE",
    badgeColor: "grey",
    subtitle: "Sarah Davis — Relationship active",
    lastContactText: "Last contact: 18 May 2026 — 17 days ago",
    lastContactColor: "grey",
    criteriaPills: ["£1000k - £15000k", "Property/Trading", "Leveraged buyout"],
    osintLogs: [
      { text: "OakNorth provides £12m growth loan to hospitality group expansion", source: "OakNorth news — 22 May 2026", date: "22 May 2026" }
    ]
  },
  "thincats": {
    displayName: "ThinCats",
    badgeText: "ACTIVE",
    badgeColor: "grey",
    subtitle: "Marc Jenkins — Warm relationship",
    lastContactText: "Last contact: 20 May 2026 — 15 days ago",
    lastContactColor: "grey",
    criteriaPills: ["£250k - £5000k", "Cashflow lending", "Enterprise focus"],
    osintLogs: [
      { text: "ThinCats confirms record funding quarter for UK SME mid-market buyouts", source: "ThinCats press release — 12 May 2026", date: "12 May 2026" }
    ]
  }
};

export function LenderManagementPage() {
  const [lenders, setLenders] = useState<Lender[]>([]);
  const { deals } = usePipeline();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Selected Lender for bottom OSINT log view (defaults to hsbc)
  const [selectedOsintLenderKey, setSelectedOsintLenderKey] = useState<string>("hsbc");

  // Expanded panel settings within each card
  const [expandedLenderSettingsId, setExpandedLenderSettingsId] = useState<string | null>(null);

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

  const toggleSettingsExpanded = (lenderId: string) => {
    setExpandedLenderSettingsId(prev => prev === lenderId ? null : lenderId);
  };

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    setError("");
    try {
      const lendersList = await fetchAdminLenders();
      setLenders(lendersList);
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
      
      const updatedLenders = await fetchAdminLenders();
      setLenders(updatedLenders);

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
      const updated = await fetchAdminLenders();
      setLenders(updated);
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
      const updated = await fetchAdminLenders();
      setLenders(updated);
    } catch (err: any) {
      alert(err.message || "Error removing assignment");
    }
  }

  // Toggle NDA Approval Handler
  async function handleToggleLenderNda(lenderId: string, currentNdaState: boolean) {
    try {
      await toggleLenderNda(lenderId, currentNdaState);
      const updated = await fetchAdminLenders();
      setLenders(updated);
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
      const updated = await fetchAdminLenders();
      setLenders(updated);
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
      const updated = await fetchAdminLenders();
      setLenders(updated);
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
      setSelectedLender(null);
      const updated = await fetchAdminLenders();
      setLenders(updated);
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

  // Map Real Airtable Lenders onto Mock template placeholders
  const joinedLenders = useMemo(() => {
    // 1. Establish matched keys set
    const matchedKeys = new Set<string>();
    const matchedList: Array<{
      key: string;
      displayName: string;
      badgeText: "PRIMARY" | "ACTIVE" | "TOUCH-POINT DUE";
      badgeColor: "green" | "grey" | "yellow";
      subtitle: string;
      lastContactText: string;
      lastContactColor: "blue" | "red" | "grey";
      criteriaPills: string[];
      osintLogs: Array<{ text: string; source: string; date: string; isGreenDot?: boolean }>;
      dbRecord?: Lender;
    }> = [];

    // 2. Loop real database records and match them
    lenders.forEach(dbLender => {
      const nameLower = dbLender.Company_Name.toLowerCase();
      let key = "";
      
      if (nameLower.includes("moorfields")) {
        key = "moorfields";
      } else if (nameLower.includes("lendo")) {
        key = "lendo";
      } else if (nameLower.includes("sammy")) {
        key = "sammy";
      } else if (nameLower.includes("hsbc")) {
        key = "hsbc";
      } else if (nameLower.includes("reward")) {
        key = "reward";
      } else if (nameLower.includes("barclays")) {
        key = "barclays";
      } else if (nameLower.includes("oaknorth")) {
        key = "oaknorth";
      } else if (nameLower.includes("thincats")) {
        key = "thincats";
      } else {
        key = `dynamic-${dbLender.id}`;
      }

      const mockData = mockLenderDetails[key];
      if (mockData) {
        matchedKeys.add(key);
        matchedList.push({
          key,
          displayName: mockData.displayName,
          badgeText: mockData.badgeText,
          badgeColor: mockData.badgeColor,
          subtitle: dbLender.Contact_Name ? `${dbLender.Contact_Name} — Relationship active` : mockData.subtitle,
          lastContactText: mockData.lastContactText,
          lastContactColor: mockData.lastContactColor,
          criteriaPills: mockData.criteriaPills,
          osintLogs: mockData.osintLogs,
          dbRecord: dbLender
        });
      } else {
        // Fallback for custom added records
        matchedList.push({
          key,
          displayName: dbLender.Company_Name,
          badgeText: "ACTIVE",
          badgeColor: "grey",
          subtitle: dbLender.Contact_Name ? `${dbLender.Contact_Name} — Relationship active` : "External Investor",
          lastContactText: "Last contact: Active session ready",
          lastContactColor: "grey",
          criteriaPills: ["£100k - £1000k", "General SME", "LBO access"],
          osintLogs: [
            { text: `Portal setup verified for ${dbLender.Company_Name}`, source: "Aysan Security", date: "Recently", isGreenDot: true }
          ],
          dbRecord: dbLender
        });
      }
    });

    // 3. Append remaining unmatched mock placeholders to populate standard 8 lenders tracked count
    Object.keys(mockLenderDetails).forEach(key => {
      if (!matchedKeys.has(key)) {
        const mockData = mockLenderDetails[key];
        matchedList.push({
          key,
          ...mockData
        });
      }
    });

    return matchedList;
  }, [lenders]);

  // Compute Metrics dynamically based on combined list
  const activeLendersCount = useMemo(() => {
    return joinedLenders.length; // 8 tracked
  }, [joinedLenders]);

  const staleLendersCount = useMemo(() => {
    return joinedLenders.filter(l => l.badgeText === "TOUCH-POINT DUE" || l.lastContactColor === "red").length;
  }, [joinedLenders]);

  const staleLenderName = useMemo(() => {
    const staleItem = joinedLenders.find(l => l.badgeText === "TOUCH-POINT DUE" || l.lastContactColor === "red");
    return staleItem ? staleItem.displayName : "Lendo";
  }, [joinedLenders]);

  const liveSubmissionsCount = useMemo(() => {
    return joinedLenders.filter(l => l.dbRecord && l.dbRecord.assignments?.length > 0).length || 1;
  }, [joinedLenders]);

  // Find OSINT logs for the selected key
  const selectedLenderInfo = useMemo(() => {
    return joinedLenders.find(l => l.key === selectedOsintLenderKey) || joinedLenders[0] || { displayName: "HSBC", osintLogs: [] };
  }, [joinedLenders, selectedOsintLenderKey]);

  return (
    <div className="space-y-6 text-[#E2E8F0] font-sans">
      
      {/* Title block with Dynamic eyebrow & Warning Pills */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white tracking-tight">
            Lender <span className="text-[#C5A059]">Intelligence</span>
          </h1>
          <p className="text-xs text-slate-550 font-medium">
            {activeLendersCount} lenders tracked — {staleLendersCount} stale record{staleLendersCount !== 1 ? 's' : ''}
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <HeaderMetrics />
          
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-300 shadow-sm hover:bg-white/10 hover:text-white cursor-pointer transition"
          >
            + NEW DEAL
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
            <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 shadow-premium-card card-sheen select-none">
              <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">Active Lenders</p>
              <h2 className="text-3xl font-black text-white mt-1.5 tracking-tight">{activeLendersCount}</h2>
            </div>

            {/* Stale Records */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 shadow-premium-card card-sheen select-none">
              <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">Stale Records</p>
              <h2 className="text-3xl font-black text-white mt-1.5 tracking-tight">{staleLendersCount}</h2>
              <p className="text-[10px] font-bold text-amber-500 mt-1">&gt;90 days — {staleLenderName}</p>
            </div>

            {/* Live Submissions */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 shadow-premium-card card-sheen select-none">
              <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">Live Submissions</p>
              <h2 className="text-3xl font-black text-white mt-1.5 tracking-tight">{liveSubmissionsCount}</h2>
              <p className="text-[10px] font-bold text-slate-500 mt-1">Moorfields — MGL</p>
            </div>
          </div>

          {/* Interactive Cards Grid */}
          <div className="flex items-center justify-between mt-8 select-none">
            <h3 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400">
              Lender Grid
            </h3>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-acp-bronze/35 bg-acp-bronze/5 px-3.5 text-[9px] font-black uppercase text-acp-bronze hover:bg-acp-bronze/10 transition cursor-pointer"
            >
              + Create Lender Portal
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {joinedLenders.map((lender) => {
              const isSelected = selectedOsintLenderKey === lender.key;
              const hasSettingsExpanded = expandedLenderSettingsId === lender.key;
              const hasDbRecord = !!lender.dbRecord;

              return (
                <div 
                  key={lender.key}
                  onClick={() => setSelectedOsintLenderKey(lender.key)}
                  className={cx(
                    "rounded-2xl border bg-[#0E121A] p-5 shadow-premium-card card-sheen flex flex-col justify-between transition-all cursor-pointer relative group",
                    isSelected ? "border-[#C5A059]/40 bg-[#0c1122]/30 shadow-inner" : "border-white/[0.06] hover:border-white/12"
                  )}
                >
                  <div>
                    {/* Card Header with Title and Badge */}
                    <div className="flex items-start justify-between gap-4">
                      <h4 className="text-sm font-bold text-white tracking-tight leading-tight select-none">
                        {lender.displayName}
                      </h4>
                      <span className={cx(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[8px] font-black uppercase tracking-wider select-none shrink-0 border",
                        lender.badgeColor === "green" ? "bg-emerald-500/10 text-emerald-450 border-emerald-500/20" :
                        lender.badgeColor === "yellow" ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                        "bg-white/5 text-slate-400 border-white/10"
                      )}>
                        {lender.badgeText}
                      </span>
                    </div>

                    {/* Subtitle / Contacts */}
                    <p className="mt-1 text-[10px] font-bold text-slate-500 leading-tight">
                      {lender.subtitle}
                    </p>

                    {/* Last Contact Info */}
                    <p className={cx(
                      "mt-4 text-[10px] font-black select-none uppercase tracking-wide",
                      lender.lastContactColor === "blue" ? "text-blue-400" :
                      lender.lastContactColor === "red" ? "text-rose-500" : "text-slate-450"
                    )}>
                      {lender.lastContactText}
                    </p>
                  </div>

                  {/* Criteria Pills and Setup settings */}
                  <div className="mt-5 space-y-4">
                    {/* Target criteria horizontal pills */}
                    <div className="flex flex-wrap gap-1.5 select-none">
                      {lender.criteriaPills.map((pill, idx) => (
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
                      className="border-t border-white/[0.04] pt-3.5 mt-3 flex items-center justify-between gap-2"
                      onClick={(e) => e.stopPropagation()} // block parent click
                    >
                      <div className="flex items-center gap-1 text-[9px] font-extrabold uppercase text-slate-500 tracking-wider">
                        {hasDbRecord ? (
                          <span className="text-emerald-450 flex items-center gap-1">
                            <ShieldCheck className="h-3 w-3" /> Portal Connected
                          </span>
                        ) : (
                          <span className="text-slate-600 flex items-center gap-1">
                            <LockKeyhole className="h-3 w-3" /> Offline Profile
                          </span>
                        )}
                      </div>
                      
                      {hasDbRecord && (
                        <button
                          onClick={() => toggleSettingsExpanded(lender.key)}
                          className={cx(
                            "inline-flex h-6.5 items-center gap-1 rounded px-2.5 text-[9px] font-extrabold uppercase tracking-wide border transition cursor-pointer select-none",
                            hasSettingsExpanded ? "border-[#C5A059] bg-[#C5A059]/10 text-white" : "border-white/10 bg-white/5 text-slate-350 hover:bg-white/10"
                          )}
                        >
                          <Settings className="h-3 w-3" />
                          <span>Portal Config</span>
                          {hasSettingsExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                      )}
                    </div>

                    {/* Collapsible settings panel contents */}
                    {hasSettingsExpanded && lender.dbRecord && (
                      <div 
                        className="bg-black/25 border border-white/5 rounded-xl p-3.5 space-y-3 mt-2 text-left font-sans select-text animate-fade-in-up"
                        onClick={(e) => e.stopPropagation()} // block card selections
                      >
                        {/* URL Copy Link */}
                        <div className="space-y-1">
                          <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Secure Access Link</label>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-mono text-slate-400 truncate flex-1 bg-white/[0.02] border border-white/5 rounded-lg px-2.5 py-1">
                              {getPortalUrl(lender.dbRecord.Portal_Slug)}
                            </span>
                            <button
                              onClick={() => handleCopy(getPortalUrl(lender.dbRecord!.Portal_Slug), `${lender.dbRecord!.id}-url`)}
                              className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white transition"
                              title="Copy URL"
                            >
                              {copiedId === `${lender.dbRecord.id}-url` ? <Check className="h-3.5 w-3.5 text-emerald-450" /> : <Link2 className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>

                        {/* Passcode Copy & NDA select */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Passcode</label>
                            <div className="flex items-center gap-1.5 mt-1 bg-white/[0.02] border border-white/5 rounded-lg px-2.5 py-1 text-[10px] font-mono text-slate-300">
                              <KeyRound className="h-3 w-3 text-acp-bronze shrink-0" />
                              <span className="truncate"><b>{lender.dbRecord.Portal_Password || "None"}</b></span>
                              {lender.dbRecord.Portal_Password && (
                                <button
                                  onClick={() => handleCopy(lender.dbRecord!.Portal_Password || "", `${lender.dbRecord!.id}-pass`)}
                                  className="text-slate-450 hover:text-white text-[9px] flex items-center gap-0.5 ml-auto font-sans font-bold select-none shrink-0"
                                >
                                  {copiedId === `${lender.dbRecord.id}-pass` ? <Check className="h-3 w-3 text-emerald-450" /> : <Copy className="h-3 w-3" />}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">NDA Approved</label>
                            <select
                              value={lender.dbRecord.ndaApproved ? "Yes" : "No"}
                              onChange={(e) => handleToggleLenderNda(lender.dbRecord!.id, e.target.value === "Yes")}
                              className={cx(
                                "mt-1 h-7.5 w-full bg-[#0E121A] border rounded-lg px-2 text-[10px] font-bold outline-none cursor-pointer select-none text-center",
                                lender.dbRecord.ndaApproved 
                                  ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5" 
                                  : "text-amber-400 border-amber-500/20 bg-amber-500/5"
                              )}
                              style={{ appearance: "auto" }}
                            >
                              <option value="Yes" className="bg-[#0E121A] text-emerald-400 font-bold">NDA: Yes</option>
                              <option value="No" className="bg-[#0E121A] text-amber-400 font-bold">NDA: No</option>
                            </select>
                          </div>
                        </div>

                        {/* Assigned Deal tags checklist */}
                        <div className="space-y-1 pt-1.5 border-t border-white/[0.04]">
                          <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Assigned Deals</label>
                          <div className="flex flex-wrap gap-1.5 mt-1.5 items-center select-none">
                            {lender.dbRecord.assignments.map((asg) => (
                              <span
                                key={asg.assignmentId}
                                className={cx(
                                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-black tracking-wide transition-colors",
                                  lender.dbRecord!.ndaApproved 
                                    ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400"
                                    : "border-amber-500/20 bg-amber-500/5 text-amber-400"
                                )}
                              >
                                <Link
                                  to={`/deals/${encodeURIComponent(asg.dealRef)}?tab=chat&lenderId=${lender.dbRecord!.id}`}
                                  className="hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                  {asg.dealRef}
                                </Link>
                                <button
                                  onClick={() => handleRemoveAssignment(asg.assignmentId)}
                                  className="text-slate-550 hover:text-rose-405 transition cursor-pointer shrink-0"
                                  title="Revoke access"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ))}

                            <button
                              onClick={() => {
                                setSelectedLender(lender.dbRecord!);
                                setDealSearchQuery("");
                                setSelectedDealRef("");
                                setModalNdaApproved(lender.dbRecord!.ndaApproved);
                                setIsAssignModalOpen(true);
                              }}
                              className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-acp-bronze/10 border border-acp-bronze/20 text-acp-bronze hover:bg-acp-bronze hover:text-white transition cursor-pointer shrink-0 font-bold"
                              title="Assign deal"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {/* Actions buttons */}
                        <div className="pt-2 mt-2 border-t border-white/[0.04] flex items-center justify-between gap-1.5 select-none">
                          <button
                            onClick={() => {
                              setSelectedLender(lender.dbRecord!);
                              setIsResetConfirmOpen(true);
                            }}
                            className="flex-1 inline-flex h-7.5 items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 text-[9px] font-bold uppercase tracking-wider text-slate-300 hover:bg-white/10 transition"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>Reset Pass</span>
                          </button>
                          
                          <button
                            onClick={() => handleRegeneratePortal(lender.dbRecord!.id)}
                            className="flex-1 inline-flex h-7.5 items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 text-[9px] font-bold uppercase tracking-wider text-slate-300 hover:bg-white/10 transition"
                          >
                            <Link2 className="h-3 w-3" />
                            <span>New Link</span>
                          </button>

                          <button
                            onClick={() => {
                              setSelectedLender(lender.dbRecord!);
                              setIsDeleteConfirmOpen(true);
                            }}
                            className="flex-1 inline-flex h-7.5 items-center justify-center gap-1 rounded-lg border border-rose-500/20 bg-rose-500/5 text-[9px] font-bold uppercase tracking-wider text-rose-450 hover:bg-rose-500/10 hover:border-rose-500/30 transition cursor-pointer"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* OSINT Intelligence Log Section */}
          <div className="mt-8 rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 shadow-premium-card card-sheen">
            <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400 border-b border-white/[0.04] pb-2.5 select-none">
              OSINT Intelligence Log — {selectedLenderInfo.displayName.toUpperCase()}
            </h3>
            
            <div className="mt-4 space-y-4 font-sans">
              {selectedLenderInfo.osintLogs?.map((log, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <span className={cx(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    log.isGreenDot ? "bg-emerald-450" : "bg-blue-400"
                  )} />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white leading-tight">
                      {log.text}
                    </p>
                    <p className="mt-1 text-[9px] font-semibold text-slate-500 leading-none">
                      Source: {log.source}
                    </p>
                  </div>
                </div>
              ))}

              {(!selectedLenderInfo.osintLogs || selectedLenderInfo.osintLogs.length === 0) && (
                <p className="text-xs text-slate-550 font-medium py-3 text-center">
                  No recent OSINT logs logged for this lender.
                </p>
              )}
            </div>
          </div>

        </div>
      )}

      {/* MODAL 1: CREATE NEW LENDER */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0E121A] p-6 shadow-2xl relative font-sans animate-fade-in-up">
            <button
              onClick={closeAddModal}
              className="absolute right-4 top-4 text-slate-450 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            {!createdLenderDetails ? (
              <form onSubmit={handleAddLender} className="space-y-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-2 border-b border-white/5 pb-2">Create New Lender</h3>
                
                <div className="space-y-1.5">
                  <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Company Name *</label>
                  <input
                    type="text"
                    required
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    placeholder="e.g. Moorfields Capital"
                    className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Contact Name</label>
                  <input
                    type="text"
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    placeholder="e.g. Lee Coutanche"
                    className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Email Address</label>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="e.g. contact@moorfields.com"
                      className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Phone Number</label>
                    <input
                      type="text"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      placeholder="e.g. +44 790 798 1105"
                      className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-bronze disabled:opacity-40 select-none cursor-pointer mt-4"
                >
                  {submitting ? "Creating..." : "Generate Portal Access"}
                </button>
              </form>
            ) : (
              <div className="space-y-5 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-450 border border-emerald-500/20 mx-auto">
                  <CheckCircle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Portal Access Ready</h3>
                  <p className="text-xs text-slate-450 mt-1">Lender portal generated successfully for {createdLenderDetails.company}.</p>
                </div>

                <div className="text-left space-y-3.5 bg-white/5 border border-white/10 rounded-xl p-4">
                  {/* URL */}
                  <div>
                    <span className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Secure URL</span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] font-mono text-white truncate flex-1 bg-white/5 border border-white/5 rounded-lg px-2.5 py-1">{createdLenderDetails.url}</span>
                      <button
                        onClick={() => handleCopy(createdLenderDetails.url, "modal-url")}
                        className="h-7 w-7 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-slate-350 hover:text-white"
                      >
                        {copiedId === "modal-url" ? <Check className="h-3.5 w-3.5 text-emerald-455" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Password */}
                  <div>
                    <span className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Temporary Passcode</span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[12px] font-mono font-bold text-acp-bronze bg-white/5 border border-white/5 rounded-lg px-2.5 py-1 flex-1">{createdLenderDetails.pass}</span>
                      <button
                        onClick={() => handleCopy(createdLenderDetails.pass, "modal-pass")}
                        className="h-7 w-7 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-slate-355 hover:text-white"
                      >
                        {copiedId === "modal-pass" ? <Check className="h-3.5 w-3.5 text-emerald-455" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  onClick={closeAddModal}
                  className="w-full inline-flex h-10 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10 mt-4"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 2: ASSIGN DEALS */}
      {isAssignModalOpen && selectedLender && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0E121A] p-6 shadow-2xl relative font-sans animate-scale-in">
            <button
              onClick={() => {
                setIsAssignModalOpen(false);
                setSelectedLender(null);
                setModalNdaApproved(false);
              }}
              className="absolute right-4 top-4 text-slate-450 hover:text-white cursor-pointer"
              type="button"
            >
              <X className="h-5 w-5" />
            </button>

            <form onSubmit={handleAssignDeal} className="space-y-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider border-b border-white/5 pb-2">Assign Deal Access</h3>
              <p className="text-xs text-slate-450 leading-relaxed">Grant portal review access to {selectedLender.Company_Name}.</p>

              <div className="space-y-2">
                <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Select Acquisition Deal</label>
                
                {/* Search Bar Input */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search by Deal ID or Company Name..."
                    value={dealSearchQuery}
                    onChange={(e) => setDealSearchQuery(e.target.value)}
                    className="h-10 w-full rounded-xl border border-white/10 bg-[#0A0A0B] pl-8.5 pr-4 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze"
                  />
                </div>

                {/* Searchable Scroll Container */}
                <div className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-[#0A0A0B] divide-y divide-white/[0.04] custom-scrollbar select-none">
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
                              : "text-slate-300 hover:bg-white/5"
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
                      <div className="p-4 text-center text-xs text-slate-550 font-medium">
                        No assignable deals found
                      </div>
                    )}
                </div>
              </div>

              {/* NDA Approval Toggle Option */}
              <div className="space-y-1.5">
                <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">
                  NDA Status
                </label>
                <select
                  value={modalNdaApproved ? "Yes" : "No"}
                  onChange={(e) => setModalNdaApproved(e.target.value === "Yes")}
                  className="h-10 w-full rounded-xl border border-white/10 bg-[#0A0A0B] px-3 text-xs text-white outline-none focus:border-acp-bronze cursor-pointer"
                  style={{ appearance: "auto" }}
                >
                  <option value="No">NDA Approved: No</option>
                  <option value="Yes">NDA Approved: Yes</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={submitting || !selectedDealRef}
                className="w-full inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-bronze disabled:opacity-40 cursor-pointer mt-4"
              >
                {submitting ? "Assigning..." : "Assign Access"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: PASSWORD RESET CONFIRMATION */}
      {isResetConfirmOpen && selectedLender && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0E121A] p-6 shadow-2xl relative text-center font-sans">
            <button
              onClick={closeResetModal}
              className="absolute right-4 top-4 text-slate-450 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            {!newResetPassword ? (
              <div className="space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 mx-auto">
                  <RotateCcw className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Reset Passcode?</h3>
                  <p className="text-xs text-slate-450 mt-1.5 leading-relaxed">This will immediately revoke the current passcode for {selectedLender.Company_Name}.</p>
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={closeResetModal}
                    className="flex-1 inline-flex h-10 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleResetPassword}
                    disabled={submitting}
                    className="flex-1 inline-flex h-10 items-center justify-center rounded-xl bg-rose-500 text-xs font-bold uppercase tracking-wider text-white hover:bg-rose-600 disabled:opacity-40 cursor-pointer"
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
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Passcode Reset Complete</h3>
                  <p className="text-xs text-slate-450 mt-1">The new passcode is successfully written to database.</p>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-left">
                  <span className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">New Passcode</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[12px] font-mono font-bold text-acp-bronze bg-white/5 border border-white/5 rounded-lg px-2.5 py-1 flex-1">{newResetPassword}</span>
                    <button
                      onClick={() => handleCopy(newResetPassword || "", "modal-reset-pass")}
                      className="h-7 w-7 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-slate-355 hover:text-white"
                    >
                      {copiedId === "modal-reset-pass" ? <Check className="h-3.5 w-3.5 text-emerald-455" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <button
                  onClick={closeResetModal}
                  className="w-full inline-flex h-10 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10 mt-4 cursor-pointer"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 4: DELETE LENDER CONFIRMATION */}
      {isDeleteConfirmOpen && selectedLender && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0E121A] p-6 shadow-2xl relative text-center animate-scale-in font-sans">
            <button
              onClick={closeDeleteModal}
              className="absolute right-4 top-4 text-slate-455 hover:text-white cursor-pointer"
              type="button"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-450 border border-rose-500/20 mx-auto">
                <Trash2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Delete Lender?</h3>
                <p className="text-xs text-slate-450 mt-1.5 leading-relaxed">
                  Are you sure you want to delete <strong>{selectedLender.Company_Name}</strong>? This will permanently remove their portal access and all active deal assignments in Airtable.
                </p>
              </div>

              <div className="text-left space-y-1.5">
                <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">
                  Type company name to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={selectedLender.Company_Name}
                  className="h-10 w-full rounded-xl border border-white/10 bg-[#0A0A0B] px-3 text-xs text-white placeholder-slate-655 outline-none focus:border-rose-500 transition-all"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={closeDeleteModal}
                  className="flex-1 inline-flex h-10 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10 cursor-pointer"
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
          </div>
        </div>
      )}
    </div>
  );
}
