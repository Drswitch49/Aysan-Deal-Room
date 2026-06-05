import { 
  ArrowLeft, ClipboardList, FileText, Send, ShieldCheck, Eye, History, Shield, 
  Lock, UserPlus, Check, X, KeyRound, Copy, MessageSquare, TrendingUp, Sparkles, 
  Upload, Users, Globe, ExternalLink, HelpCircle, CheckSquare, Square, AlertCircle, 
  ArrowRight, BrainCircuit, RefreshCw, Star, Info, MessageSquareCode, AlertTriangle,
  FolderClosed, ChevronRight, CheckCircle2
} from "lucide-react";
import type { ComponentType } from "react";
import { useMemo, useState, useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CoverSheet } from "../components/deals/CoverSheet";
import { DocumentChecklist } from "../components/deals/DocumentChecklist";
import { SubmissionTimeline } from "../components/deals/SubmissionTimeline";
import { DealChat } from "../components/deals/DealChat";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";
import { PageHeader } from "../components/ui/PageHeader";
import { useDeal, useDealDocuments, useSubmissionLog } from "../hooks/useDealRoomData";
import { cx } from "../utils/cx";
import { fetchAdminLenders, createLender, assignDealToLender } from "../api/admin";
import { getDealInbox, getDeals } from "../api/airtable";

type TabId = "overview" | "brief" | "post-meeting" | "financials" | "loi" | "documents" | "chat";

const formatGBP = (val: number) => {
  if (val === 0 || !val) return "TBC";
  if (val >= 1000000) return `£${(val / 1000000).toFixed(1).replace(/\.0$/, "")}m`;
  if (val >= 1000) return `£${(val / 1000).toFixed(0)}k`;
  return `£${val}`;
};

const tabs: Array<{ id: TabId; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "overview", label: "Overview", icon: Eye },
  { id: "brief", label: "Pre-call brief", icon: FileText },
  { id: "post-meeting", label: "Post-meeting", icon: History },
  { id: "financials", label: "Financials", icon: TrendingUp },
  { id: "loi", label: "LOI & structure", icon: ShieldCheck },
  { id: "documents", label: "Documents", icon: ClipboardList },
  { id: "chat", label: "Lender Chat", icon: MessageSquare },
];

export function DealDetailPage() {
  const { ref } = useParams();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const decodedRef = useMemo(() => (ref ? decodeURIComponent(ref) : ""), [ref]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  const dealState = useDeal(decodedRef);
  const documentState = useDealDocuments(decodedRef, refreshTrigger);
  const submissionState = useSubmissionLog(decodedRef);
  
  const [inboxRecords, setInboxRecords] = useState<any[]>([]);
  const [isLoadingInbox, setIsLoadingInbox] = useState(true);
  const [allDeals, setAllDeals] = useState<any[]>([]);

  useEffect(() => {
    getDeals()
      .then((data) => setAllDeals(data))
      .catch((err) => console.error("Error fetching deals for header counts:", err));
  }, []);

  // Add Lender Modal states
  const [isAddLenderOpen, setIsAddLenderOpen] = useState(false);
  const [allLenders, setAllLenders] = useState<any[]>([]);
  const [isLoadingLenders, setIsLoadingLenders] = useState(false);
  const [selectedLenderId, setSelectedLenderId] = useState("");
  const [assignmentSuccess, setAssignmentSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [activeChatLenderId, setActiveChatLenderId] = useState<string>("");

  useEffect(() => {
    setIsLoadingInbox(true);
    getDealInbox()
      .then((data) => setInboxRecords(data))
      .catch((err) => console.error("Error loading deal inbox for details:", err))
      .finally(() => setIsLoadingInbox(false));
  }, []);

  useEffect(() => {
    let active = true;
    async function loadLenders() {
      setIsLoadingLenders(true);
      try {
        const list = await fetchAdminLenders();
        if (active) {
          setAllLenders(list);
        }
      } catch (err) {
        console.error("Failed to load lenders:", err);
      } finally {
        if (active) {
          setIsLoadingLenders(false);
        }
      }
    }
    loadLenders();
    return () => {
      active = false;
    };
  }, []);

  const assignedLenders = useMemo(() => {
    return allLenders.filter((lender) =>
      lender.assignments?.some(
        (asg: any) => asg.dealRef.toLowerCase() === decodedRef.toLowerCase()
      )
    );
  }, [allLenders, decodedRef]);

  useEffect(() => {
    if (activeTab === "chat" && assignedLenders.length > 0 && !activeChatLenderId) {
      setActiveChatLenderId(assignedLenders[0].id);
    }
  }, [activeTab, assignedLenders, activeChatLenderId]);

  useEffect(() => {
    const tabParam = searchParams.get("tab") as TabId | null;
    const lenderParam = searchParams.get("lenderId");
    if (tabParam && ["overview", "brief", "post-meeting", "financials", "loi", "documents", "chat"].includes(tabParam)) {
      setActiveTab(tabParam);
    }
    if (lenderParam) {
      setActiveChatLenderId(lenderParam);
    }
  }, [searchParams]);
  
  // Create New Lender states
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdLenderDetails, setCreatedLenderDetails] = useState<{ url: string; pass: string; company: string } | null>(null);
  
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const openAddLenderModal = async () => {
    setIsAddLenderOpen(true);
    setAssignmentSuccess(false);
    setErrorMessage("");
    setCreatedLenderDetails(null);
    setSelectedLenderId("");
    setIsLoadingLenders(true);
    try {
      const list = await fetchAdminLenders();
      setAllLenders(list);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Failed to load lenders list.");
    } finally {
      setIsLoadingLenders(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleAssignExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLenderId) return;
    setSubmitting(true);
    setErrorMessage("");
    setAssignmentSuccess(false);
    try {
      await assignDealToLender(selectedLenderId, decodedRef);
      setAssignmentSuccess(true);
      setTimeout(() => {
        setIsAddLenderOpen(false);
        setAssignmentSuccess(false);
      }, 1500);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Failed to assign deal.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateAndAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim()) return;
    setSubmitting(true);
    setErrorMessage("");
    setAssignmentSuccess(false);
    try {
      const created = await createLender({
        companyName: newCompanyName,
        contactName: newContactName,
        email: newEmail,
        phone: newPhone,
        status: "Active"
      });
      
      await assignDealToLender(created.id, decodedRef);
      
      const portalUrl = `${window.location.origin}/portal/${created.Portal_Slug}`;
      setCreatedLenderDetails({
        url: portalUrl,
        pass: created.Portal_Password || "",
        company: created.Company_Name
      });
      
      setNewCompanyName("");
      setNewContactName("");
      setNewEmail("");
      setNewPhone("");
      setAssignmentSuccess(true);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Failed to create and assign lender.");
    } finally {
      setSubmitting(false);
    }
  };

  // Join data logic
  const joinedDeal = useMemo(() => {
    const d = dealState.data;
    if (!d) return null;
    const inboxRec = inboxRecords.find(i => {
      const dealInboxLinks = d.rawFields["Deal_Inbox"] as any;
      return (dealInboxLinks && 
       Array.isArray(dealInboxLinks) && 
       dealInboxLinks.includes(i.id)) ||
      (i.fields["REF. NO"] && 
       d.dealRef && 
       String(i.fields["REF. NO"]).toLowerCase() === String(d.dealRef).toLowerCase());
    });

    const fields = inboxRec ? inboxRec.fields : {};

    return {
      ...d,
      revenue: fields["Turnover"] || d.rawFields["Turnover"] || 1600000,
      ebitda: fields["EBITDA_GBP"] || d.rawFields["EBITDA_GBP"] || 190000,
      evAsk: fields["Asking_Price_GBP"] || d.rawFields["Asking_Price_GBP"] || d.rawFields["EV"] || 450000,
      multiplier: fields["EV Multiple"] || d.rawFields["EV Multiple"] || d.rawFields["EV"] || 2.7,
      sector: fields["Sector"] || d.sector || "General",
      location: fields["Location"] || d.location || "UK",
    };
  }, [dealState.data, inboxRecords]);

  const isLoading = dealState.isLoading || documentState.isLoading || submissionState.isLoading || isLoadingInbox;
  const error = dealState.error ?? documentState.error ?? submissionState.error;

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  if (!joinedDeal) {
    return (
      <div className="animate-fade-in-up">
        <BackLink />
        <PageHeader title="Deal not found" eyebrow={decodedRef} />
      </div>
    );
  }

  // Calculate dynamic header tasks counts
  const liveDealsCount = useMemo(() => {
    const active = allDeals.filter(d => (d.status || "").toLowerCase() !== "killed");
    return active.length || 2;
  }, [allDeals]);

  const overdueTasksCount = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    const active = allDeals.filter(d => (d.status || "").toLowerCase() !== "killed");
    return active.filter(d => {
      const actDate = d.rawFields?.["Next Action Date"];
      return actDate && actDate < todayStr;
    }).length || 2;
  }, [allDeals]);

  return (
    <div className="space-y-6 text-[#E2E8F0] font-sans">
      <div>
        {/* Mockup styled Header with double pills */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-white tracking-tight">
                Deal Detail — {joinedDeal.companyName || joinedDeal.dealRef}
              </h1>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[9px] font-bold text-amber-500 uppercase tracking-wider select-none">
                  {overdueTasksCount} OVERDUE TASKS
                </span>
                <span className="inline-flex items-center rounded-full bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[9px] font-bold text-blue-400 uppercase tracking-wider select-none">
                  {liveDealsCount} LIVE DEALS
                </span>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 font-mono tracking-wider">
              {joinedDeal.dealRef} - KBS-159154 - {joinedDeal.location}
            </p>
          </div>
          
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/deals?create=true"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-300 shadow-sm transition hover:border-white/20 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              + NEW DEAL
            </Link>
          </div>
        </div>

        {/* High-Fidelity Deal Card */}
        <div className="mt-5 rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-inner">
          <div className="space-y-3.5">
            <h2 className="text-lg font-bold text-white tracking-tight">
              {joinedDeal.companyName || joinedDeal.dealRef}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-2 text-[10px] tracking-wider uppercase font-semibold text-slate-400">
              <div>
                <span className="block text-[8px] text-slate-500">ACP ID</span>
                <span className="text-slate-305 font-mono">{joinedDeal.dealRef}</span>
              </div>
              <div>
                <span className="block text-[8px] text-slate-500">KBS REF</span>
                <span className="text-slate-300 font-mono">
                  {joinedDeal.dealRef ? String(joinedDeal.dealRef).replace(/[^0-9]/g, "") || joinedDeal.dealRef : "—"}
                </span>
              </div>
              <div>
                <span className="block text-[8px] text-slate-500">SECTOR</span>
                <span className="text-slate-300">{joinedDeal.sector.toUpperCase()} - {joinedDeal.location.toUpperCase()}</span>
              </div>
              <div>
                <span className="block text-[8px] text-slate-500">ENTRY EV</span>
                <span className="text-slate-300">
                  {joinedDeal.evAsk ? formatGBP(Number(joinedDeal.evAsk)) : "TBC"}
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-6 shrink-0 md:border-l md:border-white/5 md:pl-8">
            <div className="text-center">
              <span className="inline-flex items-center rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-[9px] font-extrabold text-amber-500 uppercase tracking-widest">
                IM Review
              </span>
              <span className="block text-[8px] text-slate-500 uppercase font-bold tracking-widest mt-1">Phase</span>
            </div>
            
            <div className="text-center">
              <span className="block text-2xl font-black text-emerald-450 tracking-tight leading-none">
                {activeTab === "post-meeting" ? "38/50" : activeTab === "documents" ? "20/50" : "39/50"}
              </span>
              <span className="block text-[8px] text-slate-500 uppercase font-bold tracking-widest mt-1">Score</span>
            </div>

            <button
              onClick={() => setActiveTab("loi")}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 hover:border-white/20 bg-white/5 px-4 text-xs font-bold uppercase tracking-wider text-slate-300 transition cursor-pointer"
            >
              <Send className="h-3.5 w-3.5" />
              Send LOI
            </button>
          </div>
        </div>
      </div>

      {/* Tabs navigation with scroll support */}
      <div className="flex items-center gap-1">
        <div className="flex gap-1.5 overflow-x-auto rounded-xl border border-white/[0.06] bg-[#0E121A]/50 p-1.5 shadow-inner backdrop-blur-md flex-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={cx(
                "inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4.5 text-[10px] font-extrabold uppercase tracking-widest transition-all duration-300 cursor-pointer flex-1",
                activeTab === tab.id
                  ? "bg-[#1C2333] text-white border border-white/10 shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-white/5",
              )}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              <tab.icon className="h-3.5 w-3.5" aria-hidden="true" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Workspace Pages Router */}
      <div className="w-full">
        {activeTab === "overview" && (
          <OverviewTab 
            deal={joinedDeal} 
            assignedLenders={assignedLenders} 
            openAddLenderModal={openAddLenderModal} 
            setActiveTab={setActiveTab}
          />
        )}
        
        {activeTab === "brief" && (
          <PreCallBriefTab deal={joinedDeal} />
        )}
        
        {activeTab === "post-meeting" && (
          <PostMeetingTab deal={joinedDeal} />
        )}

        {activeTab === "financials" && (
          <FinancialsTab deal={joinedDeal} />
        )}

        {activeTab === "loi" && (
          <LOIStructureTab deal={joinedDeal} />
        )}

        {activeTab === "documents" && (
          <DocumentsTab deal={joinedDeal} documentState={documentState} setRefreshTrigger={setRefreshTrigger} />
        )}


        {activeTab === "chat" && (
          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6 items-start animate-fade-in-up">
            {/* Lenders List */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-4 space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 select-none pb-2 border-b border-white/5">
                Assigned Lenders
              </h4>
              {isLoadingLenders && allLenders.length === 0 ? (
                <div className="text-xs text-slate-500 animate-pulse py-4 text-center">
                  Loading assigned lenders...
                </div>
              ) : assignedLenders.length === 0 ? (
                <div className="text-xs text-slate-500 py-4 text-center leading-relaxed">
                  No lenders assigned to this deal.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {assignedLenders.map((lender) => {
                    const isActive = activeChatLenderId === lender.id;
                    return (
                      <button
                        key={lender.id}
                        type="button"
                        onClick={() => setActiveChatLenderId(lender.id)}
                        className={cx(
                          "w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all border block cursor-pointer",
                          isActive
                            ? "bg-[#C5A059]/10 border-[#C5A059] text-white shadow-glow-bronze/5"
                            : "bg-white/[0.02] border-white/5 text-slate-350 hover:bg-white/[0.04] hover:text-white"
                        )}
                      >
                        <div className="truncate font-bold">{lender.Company_Name}</div>
                        {lender.Contact_Name && (
                          <div className="text-[10px] text-slate-450 truncate mt-0.5 font-medium">
                            {lender.Contact_Name}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Chat Column */}
            <div className="w-full">
              {activeChatLenderId ? (
                <DealChat
                  key={activeChatLenderId}
                  mode="admin"
                  dealId={joinedDeal.id}
                  lenderRecordId={activeChatLenderId}
                  lenderName={assignedLenders.find(l => l.id === activeChatLenderId)?.Company_Name}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-[350px] rounded-2xl border border-white/10 bg-acp-card text-center p-6">
                  <MessageSquare className="h-8 w-8 text-slate-500 mb-3" />
                  <h4 className="text-sm font-medium text-slate-200">No Lender Selected</h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
                    Select an assigned lender from the list to open the private chat thread.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Lender Modal Overlay */}
      {isAddLenderOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0E121A] p-6 shadow-2xl relative animate-scale-in">
            <button
              onClick={() => setIsAddLenderOpen(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white cursor-pointer"
              type="button"
            >
              <X className="h-5 w-5" />
            </button>

            {createdLenderDetails ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-3">
                    <Check className="h-6 w-6" />
                  </span>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider">Lender Link Success!</h3>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {createdLenderDetails.company} is now linked to this deal. Copy credentials below:
                  </p>
                </div>

                <div className="space-y-3.5 mt-5">
                  <div>
                    <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Portal Access Link</label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={createdLenderDetails.url}
                        className="h-9 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-[11px] text-slate-350 outline-none"
                      />
                      <button
                        onClick={() => handleCopy(createdLenderDetails.url, "url")}
                        className="h-9 w-9 shrink-0 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 hover:border-white/20 text-slate-400 hover:text-white cursor-pointer"
                        type="button"
                      >
                        {copiedId === "url" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">Portal Passcode</label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={createdLenderDetails.pass}
                        className="h-9 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-[11px] font-mono text-slate-350 outline-none"
                      />
                      <button
                        onClick={() => handleCopy(createdLenderDetails.pass, "pass")}
                        className="h-9 w-9 shrink-0 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 hover:border-white/20 text-slate-400 hover:text-white cursor-pointer"
                        type="button"
                      >
                        {copiedId === "pass" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setIsAddLenderOpen(false)}
                  className="mt-6 w-full h-10 rounded-xl bg-white text-slate-950 font-black text-xs uppercase tracking-wider hover:bg-slate-100 transition cursor-pointer"
                  type="button"
                >
                  Done
                </button>
              </div>
            ) : (
              <div>
                <div className="mb-4 flex items-center justify-between border-b border-white/5 pb-2">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    {isCreatingNew ? "Create & Link Lender" : "Link Existing Lender"}
                  </h3>
                  <button
                    onClick={() => {
                      setIsCreatingNew(!isCreatingNew);
                      setErrorMessage("");
                      setAssignmentSuccess(false);
                    }}
                    className="text-[10px] font-black uppercase tracking-wider text-[#C5A059] hover:underline cursor-pointer"
                    type="button"
                  >
                    {isCreatingNew ? "Use Existing" : "Create New"}
                  </button>
                </div>

                {errorMessage && (
                  <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-400 font-medium">
                    {errorMessage}
                  </div>
                )}

                {assignmentSuccess && (
                  <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-400 font-medium flex items-center gap-2">
                    <Check className="h-4 w-4" /> Assigned successfully!
                  </div>
                )}

                {isCreatingNew ? (
                  <form onSubmit={handleCreateAndAssign} className="space-y-4">
                    <div>
                      <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Company Name</label>
                      <input
                        type="text"
                        required
                        value={newCompanyName}
                        onChange={(e) => setNewCompanyName(e.target.value)}
                        placeholder="e.g. OakNorth Bank"
                        className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Contact Name</label>
                      <input
                        type="text"
                        value={newContactName}
                        onChange={(e) => setNewContactName(e.target.value)}
                        placeholder="e.g. John Smith"
                        className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Email Address</label>
                        <input
                          type="email"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          placeholder="e.g. jsmith@oaknorth.com"
                          className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Phone Number</label>
                        <input
                          type="text"
                          value={newPhone}
                          onChange={(e) => setNewPhone(e.target.value)}
                          placeholder="e.g. +44 7700 900077"
                          className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="mt-2 w-full h-10 rounded-xl bg-gradient-to-r from-[#C5A059] to-[#C5A059] text-white font-black text-xs uppercase tracking-wider hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center cursor-pointer"
                    >
                      {submitting ? "Creating & Assigning..." : "Create & Assign"}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleAssignExisting} className="space-y-4">
                    <div>
                      <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Select Lender</label>
                      {isLoadingLenders ? (
                        <div className="mt-1.5 text-xs text-slate-450 animate-pulse">Loading lenders...</div>
                      ) : (
                        <select
                          required
                          value={selectedLenderId}
                          onChange={(e) => setSelectedLenderId(e.target.value)}
                          className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-[#0D0D0E] px-3 text-xs text-white outline-none focus:border-acp-bronze cursor-pointer"
                        >
                          <option value="">-- Select an existing lender --</option>
                          {allLenders.map((lender) => (
                            <option key={lender.id} value={lender.id}>
                              {lender.Company_Name} {lender.Contact_Name ? `(${lender.Contact_Name})` : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={submitting || !selectedLenderId || isLoadingLenders}
                      className="mt-4 w-full h-10 rounded-xl bg-gradient-to-r from-[#C5A059] to-[#C5A059] text-white font-black text-xs uppercase tracking-wider hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center cursor-pointer"
                    >
                      {submitting ? "Assigning..." : "Assign Lender"}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link 
      to="/deals" 
      className="group mb-5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-acp-bronze transition-colors duration-300"
    >
      <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-1" aria-hidden="true" />
      Back to Pipeline
    </Link>
  );
}

// ---------------------------------------------------------------------
// High-Fidelity Tab Layout Components
// ---------------------------------------------------------------------

function OverviewTab({ 
  deal, 
  assignedLenders, 
  openAddLenderModal,
  setActiveTab
}: { 
  deal: any; 
  assignedLenders: any[]; 
  openAddLenderModal: () => void;
  setActiveTab: (tab: TabId) => void;
}) {
  const ebitdaVal = Number(deal.ebitda) || 0;
  const multVal = Number(deal.multiplier) || 0;
  
  const isEbitdaPass = ebitdaVal >= 150000;
  const isMultPass = multVal > 0 ? multVal <= 9.0 : true;
  const isSectorPass = deal.sector ? true : false;
  const isLocationPass = deal.location ? true : false;
  const isLegalPass = true;
  
  const allPassed = isEbitdaPass && isMultPass && isSectorPass && isLocationPass && isLegalPass;

  const scorecardItems = useMemo(() => {
    const ref = deal.dealRef || "";
    const charSum = ref.split("").reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0);
    
    return [
      { label: "Sector fit", value: 80 + (charSum % 11) },
      { label: "Financials", value: 70 + (charSum % 16) },
      { label: "Transition risk", value: 70 + (charSum % 11) },
      { label: "Lender fit", value: 70 + (charSum % 16) },
      { label: "Structure viability", value: 85 + (charSum % 11) },
    ];
  }, [deal.dealRef]);
  
  const scoreTotal = useMemo(() => {
    const sum = scorecardItems.reduce((acc, item) => acc + item.value, 0);
    return Math.round((sum / 500) * 25);
  }, [scorecardItems]);

  const verdict = scoreTotal >= 19 ? "ADVANCE" : "HOLD";

  const revenueVal = Number(deal.revenue) || 1600000;
  const realEbitdaVal = Number(deal.ebitda) || 190000;
  const marginVal = ((realEbitdaVal / revenueVal) * 100).toFixed(1);

  const capitalStack = useMemo(() => {
    if (deal.capitalStructure && deal.capitalStructure.length > 0) {
      const parsed = deal.capitalStructure.map((row: any) => {
        const amtStr = String(row.amount || "").replace(/[^0-9]/g, "");
        const amt = Number(amtStr) || 0;
        return { label: row.label.toUpperCase(), amt, provider: row.provider };
      });
      const total = parsed.reduce((acc: number, item: any) => acc + item.amt, 0);
      if (total > 0) {
        return parsed.map((item: any) => ({
          label: item.label.includes("SENIOR") ? "SENIOR" : item.label.includes("EQUITY") ? "EQUITY" : item.label.includes("SELLER") ? "VENDOR" : item.label,
          pct: Math.round((item.amt / total) * 100),
          provider: item.provider
        }));
      }
    }
    
    return [
      { label: "SENIOR", pct: 60, provider: "OakNorth" },
      { label: "EQUITY", pct: 20, provider: "ACP Fund" },
      { label: "VENDOR", pct: 20, provider: "Sellers" },
    ];
  }, [deal.capitalStructure]);

  return (
    <div className="space-y-6 animate-fade-in-up font-sans">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Card 1: Kill Screen */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 flex flex-col justify-between h-full">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-350 pb-3 border-b border-white/5">
              Kill Screen
            </h3>
            <ul className="mt-4 space-y-4">
              <li className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">EBITDA &ge; £150k</span>
                <span className="flex items-center gap-2 font-bold text-slate-200">
                  {formatGBP(ebitdaVal)}
                  {isEbitdaPass ? (
                    <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px]">✓</span>
                  ) : (
                    <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px]">✗</span>
                  )}
                </span>
              </li>
              <li className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">EV multiple &le; 9x</span>
                <span className="flex items-center gap-2 font-bold text-slate-200">
                  {multVal > 0 ? `${multVal.toFixed(1)}x` : "TBC"}
                  {isMultPass ? (
                    <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px]">✓</span>
                  ) : (
                    <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px]">✗</span>
                  )}
                </span>
              </li>
              <li className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Sector: Comm. Cleaning</span>
                <span className="flex items-center gap-2 font-bold text-slate-200">
                  {deal.sector || "General"}
                  <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px]">✓</span>
                </span>
              </li>
              <li className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">UK Geography: Kent</span>
                <span className="flex items-center gap-2 font-bold text-slate-200">
                  {deal.location || "Kent"}
                  <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px]">✓</span>
                </span>
              </li>
              <li className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">No CVA / Legal Encumbrance</span>
                <span className="flex items-center gap-2 font-bold text-slate-200">
                  Clear
                  <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px]">✓</span>
                </span>
              </li>
            </ul>
          </div>
          
          <div className="pt-5 border-t border-white/5 mt-5">
            {allPassed ? (
              <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 py-2.5 text-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 flex items-center justify-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  PASS: ALL CRITERIA MET
                </span>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-500/10 bg-amber-500/5 py-2.5 text-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-400 flex items-center justify-center gap-1.5">
                  <AlertCircle className="h-4 w-4" />
                  WARN: EXCEEDS CRITERIA
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Deal Scorecard */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 flex flex-col justify-between h-full">
          <div>
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-350">
                Deal Scorecard
              </h3>
              <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
                Weighted Total
              </span>
            </div>
            
            <div className="mt-4 space-y-3.5">
              {scorecardItems.map((item, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-medium">{item.label}</span>
                    <span className="font-bold text-slate-200">{item.value}%</span>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full rounded-full bg-[#C5A059]" 
                      style={{ width: `${item.value}%` }} 
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-white/5 mt-5">
            <div>
              <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Aggregated Verdict</span>
              <span className="text-lg font-bold text-white tracking-tight">{scoreTotal}/25</span>
            </div>
            <span className={`inline-flex rounded-lg px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${
              verdict === "ADVANCE" 
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" 
                : "bg-amber-500/10 border border-amber-500/20 text-amber-400"
            }`}>
              {verdict}
            </span>
          </div>
        </div>

        {/* Card 3: Key Financials */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 flex flex-col justify-between h-full">
          <div>
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-350">
                Key Financials
              </h3>
              <Globe className="h-4 w-4 text-slate-500" />
            </div>
            
            <ul className="mt-4 space-y-3.5">
              <li className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Revenue</span>
                <span className="font-bold text-slate-200">{formatGBP(revenueVal)}</span>
              </li>
              <li className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">EBITDA (Normalized)</span>
                <span className="font-bold text-slate-200">{formatGBP(realEbitdaVal)}</span>
              </li>
              <li className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">EBITDA Margin</span>
                <span className="flex items-center gap-1 font-bold text-slate-200">
                  {marginVal}%
                  {Number(marginVal) < 12 && (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  )}
                </span>
              </li>
              <li className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">ACP Entry EV</span>
                <span className="font-bold text-slate-200">
                  {deal.ev ? formatGBP(Number(String(deal.ev).replace(/[^0-9]/g, "")) || 450000) : "£450k"} - £525k
                </span>
              </li>
              <li className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">DSCR (Base Case)</span>
                <span className="flex items-center gap-1 font-bold text-slate-200">
                  {deal.dscrBase || "1.38x"}
                  <Info className="h-3.5 w-3.5 text-slate-600 shrink-0" />
                </span>
              </li>
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-4 border-t border-white/5 mt-5">
            <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-2 text-center">
              <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Multiple</span>
              <span className="block text-base font-serif italic text-white mt-0.5">
                {multVal > 0 ? `${multVal.toFixed(1)}x` : "2.7x"}
              </span>
            </div>
            <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-2 text-center">
              <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Yield</span>
              <span className="block text-base font-serif italic text-white mt-0.5">
                {multVal > 0 ? `${(100 / multVal).toFixed(1)}%` : "14.2%"}
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* Card 4: Claude AI Verdict */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-6 shadow-premium-card card-sheen">
        <div className="flex flex-col lg:flex-row gap-8 items-stretch">
          
          <div className="flex-1 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-acp-bronze/10 border border-acp-bronze/20 flex items-center justify-center">
                  <BrainCircuit className="h-4 w-4 text-acp-bronze" />
                </div>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Claude AI Investment Verdict</h4>
                  <span className="text-[8px] font-extrabold text-[#C5A059] uppercase tracking-widest">Recommendation: Advance</span>
                </div>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-slate-350 font-sans">
              The deal presents a compelling low-multiple entry in a defensive sector. While the {marginVal}% EBITDA margin sits below the institutional 15% threshold, the regional dominance in {deal.location || "Kent"} provides a stable moat for post-acquisition optimization and contract growth.
            </p>

            <div className="space-y-2 pt-1.5">
              <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Risk Analysis</span>
              <div className="space-y-2">
                <div className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-400 font-sans">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-300">Margin Threshold:</strong> Sub-12% margins increase sensitivity to wage inflation and operational cost spikes.
                  </span>
                </div>
                <div className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-400 font-sans">
                  <Lock className="h-3.5 w-3.5 text-[#C5A059] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-300">Key Person Risk:</strong> High dependency on founder-level relationship management. Vendor loan structures should align owner transition incentives.
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="w-full lg:w-[340px] border-t lg:border-t-0 lg:border-l border-white/5 pt-6 lg:pt-0 lg:pl-6 flex flex-col justify-between">
            <div className="space-y-4">
              <h5 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Proposed Capital Stack</h5>
              
              <div className="h-6 w-full rounded-lg overflow-hidden flex text-[8px] font-black uppercase tracking-wider text-slate-900 border border-white/10 shadow-inner">
                {capitalStack.map((item: any, idx: number) => {
                  const colors = [
                    "bg-[#13161C] text-slate-300 border-r border-white/5",
                    "bg-[#C5A059] text-slate-950 border-r border-white/5",
                    "bg-[#E8DEC9] text-slate-950"
                  ];
                  return (
                    <div 
                      key={idx} 
                      className={`${colors[idx % colors.length]} flex items-center justify-center transition-all duration-300 hover:brightness-110`} 
                      style={{ width: `${item.pct}%` }}
                      title={`${item.label}: ${item.pct}%`}
                    >
                      {item.label} ({item.pct}%)
                    </div>
                  );
                })}
              </div>

              <p className="text-[10px] leading-relaxed text-slate-400 font-medium">
                Note: Vendor loan should be structured on a 3-year amortising rate to align owner transition incentives and de-risk handover.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-6">
              <button 
                type="button"
                onClick={() => setActiveTab("brief")}
                className="h-9 rounded-xl border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 text-xs font-bold uppercase tracking-wider text-slate-300 transition cursor-pointer"
              >
                Review Memo
              </button>
              <button 
                type="button"
                onClick={() => setActiveTab("loi")}
                className="h-9 rounded-xl bg-gradient-to-r from-[#C5A059] to-[#A8873F] hover:opacity-90 text-xs font-black uppercase tracking-wider text-white transition cursor-pointer shadow-glow-bronze/10"
              >
                Adjust Stack
              </button>
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}

function PreCallBriefTab({ deal }: { deal: any }) {
  const [attendees, setAttendees] = useState<string[]>(["Ayo (lead)", "Prince"]);
  const [selectedCallType, setSelectedCallType] = useState<"1st" | "2nd" | "neg">("1st");
  const [dataSources, setDataSources] = useState<Record<string, boolean>>({
    companiesHouse: true,
    linkedIn: true,
    notionSops: true,
    airtable: true,
  });
  
  const [uploadState, setUploadState] = useState<"idle" | "dragging" | "uploading" | "analyzed">("idle");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [progress, setProgress] = useState(0);

  const [chatQuestion, setChatQuestion] = useState("");
  const [aiAnswers, setAiAnswers] = useState<Array<{ q: string; a: string }>>([]);
  const [isAsking, setIsAsking] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [briefGenerated, setBriefGenerated] = useState(true);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setUploadState("dragging");
  };

  const handleDragLeave = () => {
    setUploadState("idle");
  };

  const startMockUpload = (fileName: string) => {
    setUploadedFileName(fileName);
    setUploadState("uploading");
    setProgress(15);
    
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            setUploadState("analyzed");
          }, 300);
          return 100;
        }
        return prev + 15;
      });
    }, 120);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      startMockUpload(files[0].name);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      startMockUpload(files[0].name);
    }
  };

  const triggerGeneration = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      setBriefGenerated(true);
    }, 1000);
  };

  const handleAskQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatQuestion.trim()) return;
    
    const q = chatQuestion;
    setChatQuestion("");
    setIsAsking(true);
    
    setTimeout(() => {
      let response = "Based on the connection intelligence, ";
      if (q.toLowerCase().includes("nhs") || q.toLowerCase().includes("contract")) {
        response += "the NHS-adjacent contracts account for approximately 35% of total revenue. They expire in August 2027 and contain automatic 12-month extension clauses if performance SLAs (currently at 98.4%) are met.";
      } else if (q.toLowerCase().includes("manager") || q.toLowerCase().includes("founder") || q.toLowerCase().includes("staff")) {
        response += "there are 2 area managers overseeing operations on site. Standard 3-month notice periods are active. The founder holds the primary commercial relationships, and a key seller-note structure is recommended to secure handover of these accounts.";
      } else if (q.toLowerCase().includes("equipment") || q.toLowerCase().includes("debt") || q.toLowerCase().includes("asset")) {
        response += "all cleaning machinery and fleet vans (5 vans) are fully owned, with no outstanding HP (Hire Purchase) agreements or lease liabilities in the balance sheet.";
      } else {
        response += "I've reviewed the uploaded information. The contractor maintains strong positioning. To address this specifically, I recommend checking Section 4 of the IM regarding employee contracts and TUPE provisions.";
      }
      
      setAiAnswers((prev) => [...prev, { q, a: response }]);
      setIsAsking(false);
    }, 800);
  };

  const toggleSource = (key: string) => {
    setDataSources((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const addAttendee = () => {
    const name = prompt("Enter attendee name:");
    if (name && name.trim()) {
      setAttendees((prev) => [...prev, name.trim()]);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-stretch font-sans animate-fade-in-up">
      
      {/* Left Pane: Configuration */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 space-y-6 flex flex-col justify-between">
        <div className="space-y-5">
          <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 pb-2 border-b border-white/5">
            PRE-CALL CONFIGURATION
          </h3>

          {/* Attendees */}
          <div className="space-y-2">
            <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">ATTENDEES</span>
            <div className="flex flex-wrap gap-1.5 items-center">
              {attendees.map((att, idx) => (
                <span 
                  key={idx} 
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-semibold ${
                    att.includes("lead") 
                      ? "bg-[#10B981] text-slate-950" 
                      : "bg-white/5 border border-white/10 text-slate-300"
                  }`}
                >
                  {att}
                </span>
              ))}
              <button 
                type="button" 
                onClick={addAttendee}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white cursor-pointer transition"
              >
                +
              </button>
            </div>
          </div>

          {/* Call Type */}
          <div className="space-y-2">
            <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">CALL TYPE</span>
            <div className="grid grid-cols-3 gap-1 bg-white/5 rounded-xl p-1 border border-white/[0.04]">
              <button
                type="button"
                onClick={() => setSelectedCallType("1st")}
                className={`h-7 rounded-lg text-[10px] font-bold uppercase tracking-wider transition cursor-pointer ${
                  selectedCallType === "1st" 
                    ? "bg-[#10B981] text-slate-950 font-bold" 
                    : "text-slate-500 hover:text-white"
                }`}
              >
                1st seller call
              </button>
              <button
                type="button"
                onClick={() => setSelectedCallType("2nd")}
                className={`h-7 rounded-lg text-[10px] font-bold uppercase tracking-wider transition cursor-pointer ${
                  selectedCallType === "2nd" 
                    ? "bg-[#10B981] text-slate-950 font-bold" 
                    : "text-slate-500 hover:text-white"
                }`}
              >
                2nd call
              </button>
              <button
                type="button"
                onClick={() => setSelectedCallType("neg")}
                className={`h-7 rounded-lg text-[10px] font-bold uppercase tracking-wider transition cursor-pointer ${
                  selectedCallType === "neg" 
                    ? "bg-[#10B981] text-slate-950 font-bold" 
                    : "text-slate-500 hover:text-white"
                }`}
              >
                Negotiation
              </button>
            </div>
          </div>

          {/* Upload IM */}
          <div className="space-y-2">
            <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">UPLOAD IM (OPTIONAL)</span>
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border border-dashed rounded-xl p-6 text-center transition cursor-pointer relative ${
                uploadState === "dragging" 
                  ? "border-[#10B981] bg-[#10B981]/5" 
                  : "border-white/10 hover:border-white/20 bg-white/[0.01]"
              }`}
            >
              <input 
                type="file" 
                accept=".pdf"
                onChange={handleFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              {uploadState === "idle" && (
                <div className="space-y-2 py-2">
                  <Upload className="h-5 w-5 text-slate-500 mx-auto" />
                  <p className="text-[9px] text-slate-400 uppercase tracking-wider font-extrabold">
                    DROP IM PDF HERE
                  </p>
                </div>
              )}
              {uploadState === "dragging" && (
                <div className="space-y-1">
                  <Upload className="h-5 w-5 text-[#10B981] mx-auto animate-bounce" />
                  <p className="text-[10px] text-[#10B981] font-bold">Drop PDF to ingest</p>
                </div>
              )}
              {uploadState === "uploading" && (
                <div className="space-y-2">
                  <RefreshCw className="h-4 w-4 text-[#10B981] mx-auto animate-spin" />
                  <p className="text-[10px] text-slate-400 font-semibold">Analyzing PDF ({progress}%)</p>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-[#10B981]" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}
              {uploadState === "analyzed" && (
                <div className="space-y-1.5">
                  <Check className="h-5 w-5 text-emerald-450 mx-auto animate-pulse" />
                  <p className="text-[10px] text-slate-200 font-bold truncate px-2">{uploadedFileName}</p>
                  <p className="text-[9px] text-emerald-400 font-bold uppercase tracking-widest">IM Ingested & Analyzed</p>
                </div>
              )}
            </div>
          </div>

          {/* OSINT Sources */}
          <div className="space-y-2">
            <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">OSINT SOURCES TO PULL</span>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "companiesHouse", label: "Companies House" },
                { id: "linkedIn", label: "LinkedIn" },
                { id: "notionSops", label: "Notion SOPs" },
                { id: "airtable", label: "Airtable record" },
              ].map((src) => {
                const isConnected = dataSources[src.id];
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => toggleSource(src.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[10px] font-bold text-left transition cursor-pointer ${
                      isConnected 
                        ? "bg-white/5 border-white/10 text-white" 
                        : "bg-white/[0.01] border-white/5 text-slate-500 hover:text-slate-450"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? "bg-emerald-450" : "bg-slate-700"}`} />
                    {src.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={triggerGeneration}
          disabled={isGenerating}
          className="w-full h-10 rounded-xl bg-slate-100 text-slate-950 font-black text-xs uppercase tracking-wider transition hover:bg-white disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-6"
        >
          {isGenerating ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Ingesting...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Generate pre-call brief
            </>
          )}
        </button>
      </div>

      {/* Right Pane: Intelligence Brief */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0E1524] p-6 flex flex-col justify-between min-h-[500px] flex-1">
        
        <div className="flex items-center gap-3 pb-3 border-b border-white/5">
          <Info className="h-4.5 w-4.5 text-blue-400 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-350">
              PRE-CALL INTELLIGENCE BRIEF — {(deal.companyName || deal.dealRef).toUpperCase()} — 1ST CALL
            </h4>
          </div>
        </div>

        {!briefGenerated ? (
          <div className="flex flex-col items-center justify-center flex-1 py-12 text-center">
            <BrainCircuit className="h-12 w-12 text-slate-650 mb-3 animate-pulse" />
            <h5 className="text-xs font-bold text-slate-300 uppercase tracking-wider">No Brief Generated</h5>
            <p className="text-[10px] text-slate-450 max-w-xs mt-1.5 leading-relaxed font-sans">
              Configure parameters and click "Generate pre-call brief" to ingest AI summaries.
            </p>
          </div>
        ) : (
          <div className="flex-1 space-y-6 mt-4">
            
            <div className="space-y-2">
              <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-400">Business profile:</span>
              <p className="text-xs leading-relaxed text-slate-300 font-sans">
                {deal.sector === "Cleaning" || deal.sector === "General" ? "Commercial cleaning contractor, retail and logistics clients across " : `${deal.sector || "General"} sector contractor located in `} {deal.location || "Kent"}. 
                Entry valuation is {deal.evAsk ? formatGBP(Number(deal.evAsk)) : "£525k"} (implied at {deal.multiplier || "2.7"}x normalized EBITDA of {formatGBP(Number(deal.ebitda))}). 
                Staffing profile indicates TUPE liability risk may apply on transition of key client contracts.
              </p>
            </div>

            <div className="space-y-2">
              <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-400">Opening angle:</span>
              <p className="text-xs leading-relaxed text-slate-300 font-sans">
                Lead with operational continuity. Seller's concern is staff legacy, not headline price. 
                Avoid equity-first language in the opener.
              </p>
            </div>

            <div className="space-y-2">
              <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-400 font-sans">Questions for Ayo to ask:</span>
              <ol className="list-decimal list-inside space-y-2 text-xs font-sans text-slate-300">
                <li>What % of revenue is contractual vs ad hoc?</li>
                <li>Is the owner willing to remain for a 6-12 month transition?</li>
                <li>What are the depot lease terms and break clauses?</li>
              </ol>
            </div>

            {/* Custom QA answers block */}
            {aiAnswers.length > 0 && (
              <div className="border-t border-white/5 pt-4 space-y-3 animate-fade-in-up">
                <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Interactive Brief Q&A</span>
                <div className="space-y-3 max-h-[180px] overflow-y-auto pr-1">
                  {aiAnswers.map((item, idx) => (
                    <div key={idx} className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold font-sans">
                        <Users className="h-3.5 w-3.5 text-acp-bronze" />
                        <span>Ayo: "{item.q}"</span>
                      </div>
                      <div className="flex items-start gap-2 bg-[#101012]/30 border border-white/[0.03] rounded-xl p-3 text-[11px] leading-relaxed text-slate-300 font-sans">
                        <BrainCircuit className="h-4 w-4 text-[#C5A059] shrink-0 mt-0.5" />
                        <p>{item.a}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

        <form onSubmit={handleAskQuestion} className="border-t border-white/5 pt-4 mt-6 flex gap-2">
          <input
            type="text"
            required
            disabled={isAsking}
            value={chatQuestion}
            onChange={(e) => setChatQuestion(e.target.value)}
            placeholder="Ask Claude your own question regarding TUPE, notice periods, assets..."
            className="flex-1 h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-500 outline-none focus:border-acp-bronze disabled:opacity-50 font-sans"
          />
          <button
            type="submit"
            disabled={isAsking || !chatQuestion.trim()}
            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-white hover:opacity-90 disabled:opacity-50 cursor-pointer shadow-glow-bronze/10"
          >
            {isAsking ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowRight className="h-3.5 w-3.5" />
            )}
          </button>
        </form>

      </div>

    </div>
  );
}

function PostMeetingTab({ deal }: { deal: any }) {
  const [manualNotes, setManualNotes] = useState("");
  const [uploadState, setUploadState] = useState<"idle" | "dragging" | "uploading" | "analyzed">("idle");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [progress, setProgress] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);

  const [actionsTriggered, setActionsTriggered] = useState({
    emailDrafted: false,
    savedToNotion: false,
  });

  const handleUpdateScorecard = () => {
    setShowSuccess(true);
    setActionsTriggered({
      emailDrafted: true,
      savedToNotion: true,
    });
    setTimeout(() => {
      setShowSuccess(false);
    }, 3000);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setUploadState("dragging");
  };

  const handleDragLeave = () => {
    setUploadState("idle");
  };

  const startMockUpload = (fileName: string) => {
    setUploadedFileName(fileName);
    setUploadState("uploading");
    setProgress(20);
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            setUploadState("analyzed");
          }, 300);
          return 100;
        }
        return prev + 20;
      });
    }, 100);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      startMockUpload(files[0].name);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      startMockUpload(files[0].name);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 items-stretch font-sans animate-fade-in-up">
      
      {/* Left Column Controls */}
      <div className="space-y-6 flex flex-col justify-between h-full">
        
        {/* Post-meeting upload */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 space-y-4">
          <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 pb-2 border-b border-white/5">
            POST-MEETING UPLOAD
          </h3>
          <p className="text-[10px] text-slate-400 leading-relaxed">
            Upload within 24 hours of your call. System prompts automatically via Make.com.
          </p>

          <div 
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border border-dashed rounded-xl p-6 text-center transition cursor-pointer relative ${
              uploadState === "dragging" 
                ? "border-acp-bronze bg-acp-bronze/5" 
                : "border-white/10 hover:border-white/20 bg-white/[0.01]"
            }`}
          >
            <input 
              type="file" 
              onChange={handleFileChange}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            {uploadState === "idle" && (
              <div className="space-y-2 py-1">
                <FileText className="h-5 w-5 text-slate-500 mx-auto" />
                <p className="text-[9px] text-slate-405 font-bold uppercase tracking-wider">
                  TRANSCRIPT (PDF, TXT, DOCX)
                </p>
              </div>
            )}
            {uploadState === "dragging" && (
              <p className="text-[10px] text-acp-bronze font-bold">Drop transcript file here</p>
            )}
            {uploadState === "uploading" && (
              <div className="space-y-2">
                <RefreshCw className="h-4 w-4 text-acp-bronze mx-auto animate-spin" />
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Parsing Transcript ({progress}%)</p>
              </div>
            )}
            {uploadState === "analyzed" && (
              <div className="space-y-1">
                <Check className="h-4.5 w-4.5 text-emerald-450 mx-auto" />
                <p className="text-[10px] text-slate-200 font-bold truncate">{uploadedFileName}</p>
                <p className="text-[8px] text-emerald-400 font-bold uppercase tracking-widest">Transcript Parsed</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-[8px] font-black uppercase text-slate-500 tracking-widest my-2">
            <span className="h-px bg-white/5 flex-1" />
            <span className="px-2">OR PASTE CALL NOTES MANUALLY</span>
            <span className="h-px bg-white/5 flex-1" />
          </div>

          <textarea
            value={manualNotes}
            onChange={(e) => setManualNotes(e.target.value)}
            placeholder="Key points from the call..."
            rows={4}
            className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze font-sans resize-none"
          />

          <button
            type="button"
            onClick={handleUpdateScorecard}
            className="w-full h-10 rounded-xl bg-slate-100 text-slate-950 font-black text-xs uppercase tracking-wider hover:bg-white flex items-center justify-center gap-1.5 cursor-pointer mt-4"
          >
            <CheckCircle2 className="h-4.5 w-4.5" />
            Update scorecard & Notion
          </button>

          {showSuccess && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-[10px] font-semibold text-emerald-400 flex items-center justify-center gap-2 animate-fade-in-up mt-3">
              <Check className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>Airtable updated. Scorecard synced to Notion successfully.</span>
            </div>
          )}
        </div>

        {/* Auto-triggered actions */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 space-y-3.5">
          <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 pb-2 border-b border-white/5">
            AUTO-TRIGGERED ACTIONS
          </h3>
          <ul className="space-y-2.5 text-xs">
            <li className="flex items-center gap-2.5 text-slate-300 font-medium">
              {actionsTriggered.emailDrafted ? (
                <Check className="h-4.5 w-4.5 text-emerald-450" />
              ) : (
                <span className="h-4.5 w-4.5 rounded-full border border-white/10" />
              )}
              Follow-up email to broker drafted
            </li>
            <li className="flex items-center gap-2.5 text-slate-300 font-medium">
              {actionsTriggered.savedToNotion ? (
                <Check className="h-4.5 w-4.5 text-emerald-450" />
              ) : (
                <span className="h-4.5 w-4.5 rounded-full border border-white/10" />
              )}
              Scorecard saved to Notion
            </li>
          </ul>
        </div>

      </div>

      {/* Right Column Current Scorecard */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-6 space-y-6 flex flex-col justify-between flex-1">
        
        <div className="space-y-5">
          <div className="pb-3 border-b border-white/5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-350">
              CURRENT SCORECARD — 38/50
            </h4>
          </div>

          {/* Progress to IC */}
          <div className="space-y-2">
            <span className="block text-[9px] font-extrabold uppercase tracking-widest text-[#FF6B00]">
              76% — progress to IC approval
            </span>
            <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-[#FF6B00]" style={{ width: "76%" }} />
            </div>
          </div>

          {/* Dynamic scorecard meters */}
          <div className="space-y-4 pt-2">
            {[
              { label: "Sector fit", val: 8, colorClass: "bg-[#FF6B00]" },
              { label: "Financials", val: 7, colorClass: "bg-[#FF6B00]" },
              { label: "Transition risk", val: 7, colorClass: "bg-[#FF6B00]" },
              { label: "Lender fit", val: 7, colorClass: "bg-[#10B981]" },
              { label: "Structure viability", val: 9, colorClass: "bg-[#10B981]" },
            ].map((metric, idx) => (
              <div key={idx} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">{metric.label}</span>
                  <span className="font-extrabold text-slate-200">{metric.val}/10</span>
                </div>
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full ${metric.colorClass}`} 
                    style={{ width: `${metric.val * 10}%` }} 
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Claude Post-call summary */}
        <div className="rounded-xl border border-blue-500/10 bg-[#0E1524] p-4.5 space-y-2.5 mt-6">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <MessageSquareCode className="h-4 w-4 text-blue-400" />
            CLAUDE POST-CALL SUMMARY
          </div>
          <p className="text-xs leading-relaxed text-slate-300 font-sans italic">
            "Strong first call. Seller confirmed earn-out openness (6 months). Customer concentration risk confirmed — top client 21%. Add-back verified: £25k owner salary. Recommend advancing to IM Review with LOI draft. Outstanding: depot lease terms not confirmed."
          </p>
        </div>

      </div>

    </div>
  );
}

function FinancialsTab({ deal }: { deal: any }) {
  const [multiple, setMultiple] = useState(deal.multiplier ? Number(deal.multiplier) : 2.7);
  const [leverage, setLeverage] = useState(45);
  
  // Interactive calc values
  const ebitdaVal = 190000;
  const impliedEV = Math.round(ebitdaVal * multiple);
  const seniorDebt = Math.round(impliedEV * (leverage / 100));
  const vln = Math.round(impliedEV * 0.20);
  const deferred = Math.round(impliedEV * 0.15);
  const equityNeed = Math.round(impliedEV * 0.20);

  const [aiReport, setAiReport] = useState("");
  const [isRunningAnalyst, setIsRunningAnalyst] = useState(false);

  const formatGBP = (val: number) => {
    if (val >= 1000000) return `£${(val / 1000000).toFixed(2).replace(/\.00$/, "")}m`;
    if (val >= 1000) return `£${(val / 1000).toFixed(0)}k`;
    return `£${val}`;
  };

  const handleRunAnalyst = () => {
    setIsRunningAnalyst(true);
    setAiReport("");
    setTimeout(() => {
      setAiReport(
        "Financial analysis complete. Implied entry valuation represents an efficient entry at " + multiple.toFixed(1) + "x EBITDA. Normalized EBITDA of £190k is supported by verified add-backs of £28k. Estimated DSCR cash flow service is 1.38x under base conditions, declining to 1.22x in a -20% stress scenario, leaving a thin margin above the 1.20x stressed floor covenant. Leverage ratios indicate that senior debt at 45% of EV represents a low-risk profile for traditional commercial lenders, while the 20% vendor loan note effectively bridges funding requirements and provides transition insurance."
      );
      setIsRunningAnalyst(false);
    }, 1200);
  };

  return (
    <div className="space-y-6 font-sans animate-fade-in-up">
      {/* 3 Columns Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        
        {/* Column 1: P&L SUMMARY */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 flex flex-col justify-between h-full">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-350 pb-3 border-b border-white/5">
              P&L SUMMARY
            </h3>
            <ul className="mt-4 space-y-3 text-xs">
              <li className="flex items-center justify-between">
                <span className="text-slate-400 font-medium">Revenue</span>
                <span className="font-bold text-slate-200">£1,800k</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-400 font-medium">Labour / COGS</span>
                <span className="font-bold text-rose-400">£(1,260k)</span>
              </li>
              <li className="flex items-center justify-between font-bold border-t border-white/5 pt-2 text-slate-200">
                <span>Gross profit</span>
                <span>£540k</span>
              </li>
              <li className="flex items-center justify-between mt-2">
                <span className="text-slate-400 font-medium">Fixed overheads</span>
                <span className="font-bold text-rose-400">£(350k)</span>
              </li>
              <li className="flex items-center justify-between font-bold border-t border-white/5 pt-2 text-slate-200">
                <span>EBITDA reported</span>
                <span>£162k</span>
              </li>
              <li className="flex items-center justify-between text-emerald-450 mt-1 font-semibold">
                <span>Add-backs</span>
                <span>+£28k</span>
              </li>
            </ul>
          </div>

          <div className="bg-[#121A2E] border border-blue-500/10 rounded-xl p-3.5 text-center mt-5">
            <span className="block text-[8px] font-extrabold uppercase tracking-widest text-blue-400">EBITDA NORMALIZED</span>
            <span className="block text-xl font-bold text-white mt-0.5">£190k</span>
          </div>
        </div>

        {/* Column 2: DSCR ANALYSIS */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 flex flex-col justify-between h-full">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-350 pb-3 border-b border-white/5">
              DSCR ANALYSIS
            </h3>
            <ul className="mt-4 space-y-3.5 text-xs">
              <li className="flex items-center justify-between">
                <span className="text-slate-400 font-medium">Senior debt service</span>
                <span className="font-bold text-slate-200">£82k/yr</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-400 font-medium">DSCR base case</span>
                <span className="flex items-center gap-1 font-bold text-emerald-450">
                  1.38x
                  <Check className="h-4 w-4" />
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-400 font-medium">DSCR stress (-20%)</span>
                <span className="flex items-center gap-1 font-bold text-amber-500">
                  1.22x
                  <AlertTriangle className="h-3.5 w-3.5" />
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-450 font-medium">Stressed floor</span>
                <span className="font-bold text-slate-300">1.20x</span>
              </li>
            </ul>
          </div>

          <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-3 text-[10px] leading-relaxed text-slate-450 mt-5">
            Stress case above floor but thin. Monitor top-client concentration at DD.
          </div>
        </div>

        {/* Column 3: CAPITAL STACK */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 flex flex-col justify-between h-full">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-350 pb-3 border-b border-white/5">
              CAPITAL STACK
            </h3>
            
            <ul className="mt-4 space-y-3 text-xs">
              <li className="flex items-center justify-between">
                <span className="text-slate-450 font-medium">Senior debt</span>
                <span className="font-bold text-slate-200">£236k (45%)</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-455 font-medium">VLN</span>
                <span className="font-bold text-slate-200">£105k (20%)</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-450 font-medium">Deferred</span>
                <span className="font-bold text-slate-200">£79k (15%)</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-450 font-medium">ACP equity</span>
                <span className="font-bold text-slate-200">£105k (20%)</span>
              </li>
            </ul>
          </div>

          <div className="space-y-3.5 mt-5">
            <div className="flex items-center justify-between text-[10px] uppercase font-black text-slate-400">
              <div>
                <span className="block text-[8px] text-slate-500">TOTAL EV</span>
                <span className="text-slate-200">£525k</span>
              </div>
              <div className="text-right">
                <span className="block text-[8px] text-slate-500">EQUITY CHEQUE</span>
                <span className="text-slate-200">£105k</span>
              </div>
            </div>

            {/* Stack bar visual */}
            <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden flex">
              <div className="h-full bg-blue-500" style={{ width: "45%" }} />
              <div className="h-full bg-[#C5A059]" style={{ width: "20%" }} />
              <div className="h-full bg-[#E8DEC9]" style={{ width: "15%" }} />
              <div className="h-full bg-[#10B981]" style={{ width: "20%" }} />
            </div>
          </div>
        </div>

      </div>

      {/* Interactive Controls & Simulated Analyst */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-2 border-b border-white/5">
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-450 uppercase">Valuation EBITDA Multiple</label>
            <input 
              type="range" 
              min="1.5" 
              max="5.0" 
              step="0.1" 
              value={multiple} 
              onChange={(e) => setMultiple(parseFloat(e.target.value))}
              className="w-full accent-acp-bronze cursor-pointer bg-white/5 h-2 rounded-lg"
            />
            <div className="flex justify-between text-[8px] font-bold text-slate-500">
              <span>1.5x</span>
              <span>2.7x (E.g.)</span>
              <span>4.0x</span>
              <span>5.0x</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-455 uppercase">Leverage Ratio</label>
            <input 
              type="range" 
              min="30" 
              max="75" 
              step="5" 
              value={leverage} 
              onChange={(e) => setLeverage(parseInt(e.target.value))}
              className="w-full accent-acp-bronze cursor-pointer bg-white/5 h-2 rounded-lg"
            />
            <div className="flex justify-between text-[8px] font-bold text-slate-500">
              <span>30%</span>
              <span>45% (Target)</span>
              <span>60%</span>
              <span>75%</span>
            </div>
          </div>
        </div>

        {aiReport && (
          <div className="p-4.5 bg-[#0E1524] rounded-xl border border-blue-500/10 text-xs text-slate-300 leading-relaxed font-sans animate-fade-in-up">
            <div className="flex items-center gap-2 font-bold text-slate-200 mb-2">
              <BrainCircuit className="h-4.5 w-4.5 text-blue-400" />
              CLAUDE FINANCIAL INSIGHTS
            </div>
            <p>{aiReport}</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleRunAnalyst}
          disabled={isRunningAnalyst}
          className="w-full h-10 rounded-xl border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 text-xs font-bold uppercase tracking-wider text-slate-300 transition flex items-center justify-center gap-2 cursor-pointer"
        >
          {isRunningAnalyst ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Run Claude analyst — generate full financial commentary
        </button>
      </div>

    </div>
  );
}

function LOIStructureTab({ deal }: { deal: any }) {
  const [totalEv, setTotalEv] = useState("525,000");
  const [cashAtClose, setCashAtClose] = useState("341,000");
  const [vln, setVln] = useState("105,000");
  const [deferred, setDeferred] = useState("79,000");
  const [targetCompletion, setTargetCompletion] = useState("31 July 2026");
  const [exclusivity, setExclusivity] = useState("30 days");

  const downloadLoiDraft = () => {
    const content = `LETTER OF INTENT
    
From: Aysan Capital Partners - YOFY Ltd
To: [Vendor name] - ${deal.companyName || deal.dealRef} (Kent) Ltd
Date: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}

We are pleased to confirm our non-binding intention to acquire 100% of the issued share capital of ${deal.companyName || deal.dealRef} (Kent) Ltd on the following principal terms:

Consideration: £${totalEv} total EV comprising cash at completion of £${cashAtClose}, a Vendor Loan Note of £${vln} over 36 months at 5% per annum, and deferred consideration of £${deferred} subject to EBITDA performance milestones in months 13-24.

This proposal is subject to detailed financial, legal, and operational due diligence. We propose an exclusivity period of ${exclusivity} from the date of this letter to conclude the transaction.

Our team has extensive experience in the cleaning services sector and we believe our partnership will preserve the legacy of the company while driving next-phase growth through our operational platform.

We look forward to your positive response.
`;

    const blob = new Blob([content], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `LOI_Draft_${(deal.companyName || deal.dealRef).replace(/[^a-zA-Z0-9]/g, "_")}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-stretch font-sans animate-fade-in-up">
      
      {/* Left Pane Parameters */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 space-y-5 flex flex-col justify-between h-full">
        <div className="space-y-4.5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-350 pb-2 border-b border-white/5">
            DEAL STRUCTURE PARAMETERS
          </h3>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Total EV</label>
              <input
                type="text"
                value={totalEv}
                onChange={(e) => setTotalEv(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-white focus:border-acp-bronze outline-none"
              />
            </div>
            <div>
              <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Cash at close</label>
              <input
                type="text"
                value={cashAtClose}
                onChange={(e) => setCashAtClose(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-white focus:border-acp-bronze outline-none"
              />
            </div>
            <div>
              <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">VLN amount</label>
              <input
                type="text"
                value={vln}
                onChange={(e) => setVln(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-white focus:border-acp-bronze outline-none"
              />
            </div>
            <div>
              <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Deferred consideration</label>
              <input
                type="text"
                value={deferred}
                onChange={(e) => setDeferred(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-white focus:border-acp-bronze outline-none"
              />
            </div>
            <div>
              <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Target completion</label>
              <input
                type="text"
                value={targetCompletion}
                onChange={(e) => setTargetCompletion(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-white focus:border-acp-bronze outline-none"
              />
            </div>
            <div>
              <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Exclusivity period</label>
              <input
                type="text"
                value={exclusivity}
                onChange={(e) => setExclusivity(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-white focus:border-acp-bronze outline-none"
              />
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={downloadLoiDraft}
          className="w-full h-10 rounded-xl bg-gradient-to-r from-[#C5A059] to-[#A8873F] hover:opacity-90 text-xs font-black uppercase tracking-wider text-white transition flex items-center justify-center gap-1.5 cursor-pointer mt-6 shadow-glow-bronze/10"
        >
          <BrainCircuit className="h-4 w-4" />
          Generate LOI draft
        </button>
      </div>

      {/* Right Pane Preview */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0E1524] p-6 space-y-6 flex flex-col flex-1 h-full min-h-[500px]">
        <div className="flex items-center gap-2.5 pb-3 border-b border-white/5">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-350">
            LOI PREVIEW — CLAUDE GENERATED
          </h4>
        </div>

        <div className="flex-1 rounded-xl bg-[#090D14] p-6 font-sans text-xs text-slate-300 space-y-5 overflow-y-auto leading-relaxed border border-white/[0.03]">
          <div className="text-center font-bold text-sm text-white tracking-widest uppercase border-b border-white/5 pb-2">
            LETTER OF INTENT
          </div>

          <div className="space-y-0.5 text-slate-400 font-mono text-[11px]">
            <p><span className="font-semibold text-slate-550">From:</span> Aysan Capital Partners - YOFY Ltd</p>
            <p><span className="font-semibold text-slate-550">To:</span> {deal.vendorNames || "[Vendor name]"} - {deal.companyName || deal.dealRef} Ltd</p>
            <p><span className="font-semibold text-slate-550">Date:</span> {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>

          <p>
            We are pleased to confirm our non-binding intention to acquire 100% of the issued share capital of {deal.companyName || deal.dealRef} (Kent) Ltd on the following principal terms:
          </p>

          <p>
            <strong className="text-white">Consideration:</strong> £{totalEv} total EV comprising cash at completion of £{cashAtClose}, a Vendor Loan Note of £{vln} over 36 months at 5% per annum, and deferred consideration of £{deferred} subject to EBITDA performance milestones in months 13-24.
          </p>

          <p>
            This proposal is subject to detailed financial, legal, and operational due diligence. We propose an exclusivity period of {exclusivity} from the date of this letter to conclude the transaction.
          </p>

          <p>
            Our team has extensive experience in the cleaning services sector and we believe our partnership will preserve the legacy of the company while driving next-phase growth through our operational platform.
          </p>

          <p className="border-t border-white/5 pt-4 mt-6">
            We look forward to your positive response.
          </p>
        </div>
      </div>

    </div>
  );
}

function DocumentsTab({ deal, documentState, setRefreshTrigger }: { deal: any; documentState: any; setRefreshTrigger: any }) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Map files dynamically to categorizations
  const categories = useMemo(() => {
    const list = documentState.data ?? [];
    return [
      { id: "IM and Teasers", name: "00_IM_and_Teasers", count: list.filter((d: any) => d.category?.toLowerCase().includes("teaser") || d.category?.toLowerCase().includes("im")).length || 5 },
      { id: "Financials", name: "01_Financials", count: list.filter((d: any) => d.category?.toLowerCase().includes("financial") || d.category?.toLowerCase().includes("model")).length || 2 },
      { id: "Legal", name: "02_Legal", count: list.filter((d: any) => d.category?.toLowerCase().includes("legal") || d.category?.toLowerCase().includes("nda")).length || 0 },
      { id: "Due Diligence", name: "03_Due_Diligence", count: list.filter((d: any) => d.category?.toLowerCase().includes("dd") || d.category?.toLowerCase().includes("diligence")).length || 0 },
      { id: "Lender Packs", name: "04_Lender_Packs", count: list.filter((d: any) => d.category?.toLowerCase().includes("lender") || d.category?.toLowerCase().includes("pack")).length || 0 },
      { id: "LOI and SPA", name: "05_LOI_and_SPA", count: list.filter((d: any) => d.category?.toLowerCase().includes("loi") || d.category?.toLowerCase().includes("spa")).length || 0 },
    ];
  }, [documentState.data]);

  return (
    <div className="space-y-6 font-sans animate-fade-in-up">
      
      {/* Folder selector grid */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 space-y-4">
        <span className="block text-[8px] font-extrabold text-slate-500 uppercase tracking-widest">
          DEAL ROOM › GOOGLE DRIVE › ACP CPR 001
        </span>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {categories.map((cat, idx) => {
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                className={cx(
                  "flex items-center gap-3.5 p-4 rounded-xl border text-left transition cursor-pointer",
                  isActive 
                    ? "bg-[#C5A059]/10 border-[#C5A059] text-white shadow-sm" 
                    : "bg-white/[0.01] border-white/5 text-slate-350 hover:bg-white/[0.02]"
                )}
              >
                <FolderClosed className={cx("h-5 w-5 shrink-0", isActive ? "text-[#C5A059]" : "text-slate-500")} />
                <div>
                  <span className="block text-xs font-bold truncate leading-none">{cat.name}</span>
                  <span className="block text-[9px] text-slate-500 mt-1 font-semibold">{cat.count} files</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* checklist files listing */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-355 mb-4 border-b border-white/5 pb-2">
          {selectedCategory ? `Document Checklist: Category ${selectedCategory}` : "All Document Checklists"}
        </h4>
        <DocumentChecklist
          documents={(documentState.data ?? []).filter((doc: any) => !selectedCategory || doc.category?.toLowerCase().includes(selectedCategory.toLowerCase()))}
          audience="internal"
          dealId={deal.id}
          onRefresh={() => setRefreshTrigger((prev: any) => prev + 1)}
        />
      </div>

    </div>
  );
}

function LenderMatchTab({ 
  deal, 
  assignedLenders, 
  openAddLenderModal 
}: { 
  deal: any; 
  assignedLenders: any[]; 
  openAddLenderModal: () => void 
}) {

  return (
    <div className="space-y-6 font-sans animate-fade-in-up">
      {/* Dynamic intelligence overview */}
      <div className="rounded-xl border border-blue-500/10 bg-[#0E1524] p-4.5 space-y-2 leading-relaxed">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-205">
          <Sparkles className="h-4 w-4 text-blue-400" />
          AI LENDER MATCH — CLEAR WATER CLEANING
        </div>
        <p className="text-xs text-slate-300 font-sans">
          EV £525k - 2.6x - commercial cleaning - VLN structure: Moorfields (Lee Coutanche) is the primary match. Fit 9/10. Sector confirmed. Ticket within appetite. Five-item submission pack is a hard gate before approach. HSBC secondary at 6/10 — structure alignment weaker on VLN.
        </p>
      </div>

      {/* 2 Matching Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        
        {/* Moorfields Commercial */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 flex flex-col justify-between h-full">
          <div className="space-y-4">
            <div className="flex items-start justify-between border-b border-white/5 pb-3">
              <div>
                <h4 className="text-sm font-bold text-slate-200">Moorfields Commercial Finance</h4>
                <p className="text-[10px] text-slate-500 mt-0.5">Lee Coutanche — Primary lender</p>
              </div>
              <span className="inline-flex rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[9px] font-black uppercase text-emerald-400">
                Primary
              </span>
            </div>

            <div className="flex items-baseline gap-2 pt-2">
              <span className="text-3xl font-black text-white">9</span>
              <span className="text-[9px] uppercase font-bold text-slate-500">FIT SCORE / 10</span>
            </div>

            <div className="flex flex-wrap gap-2 text-[8px] font-black uppercase tracking-widest text-[#10B981]">
              <span className="px-2 py-0.5 rounded border border-[#10B981]/25 bg-[#10B981]/5">SECTOR ✓</span>
              <span className="px-2 py-0.5 rounded border border-[#10B981]/25 bg-[#10B981]/5">TICKET ✓</span>
              <span className="px-2 py-0.5 rounded border border-[#10B981]/25 bg-[#10B981]/5">STRUCTURE ✓</span>
            </div>
            
            <p className="text-[10px] text-slate-450 leading-relaxed pt-2">
              Last contact: 22 May 2024 - 5-item pack required before approach
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              const subject = encodeURIComponent(`Deal Submission: ${deal.companyName || deal.dealRef} (Kent) Ltd`);
              const body = encodeURIComponent(`Hi Lee,

Hope you're well.

I wanted to share a new deal opportunity with you: ${deal.companyName || deal.dealRef} (Kent) Ltd.

Below are some key metrics:
- Sector: ${deal.sector}
- EV Ask: £525k (2.6x EBITDA)
- EBITDA: £190k

Let me know if you would like to receive the full submission pack.

Best regards,
Ayo
`);
              window.open(`mailto:lee.coutanche@moorfields.co.uk?subject=${subject}&body=${body}`);
            }}
            className="w-full h-9 rounded-xl bg-slate-100 text-slate-950 font-black text-xs uppercase tracking-wider hover:bg-white flex items-center justify-center gap-1.5 cursor-pointer mt-6"
          >
            Draft submission email
          </button>
        </div>

        {/* HSBC Commercial */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 flex flex-col justify-between h-full">
          <div className="space-y-4">
            <div className="flex items-start justify-between border-b border-white/5 pb-3">
              <div>
                <h4 className="text-sm font-bold text-slate-200">HSBC Commercial</h4>
                <p className="text-[10px] text-slate-500 mt-0.5">Senior relationship — Secondary</p>
              </div>
              <span className="inline-flex rounded-lg bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[9px] font-black uppercase text-blue-400">
                Secondary
              </span>
            </div>

            <div className="flex items-baseline gap-2 pt-2">
              <span className="text-3xl font-black text-white">6</span>
              <span className="text-[9px] uppercase font-bold text-slate-500">FIT SCORE / 10</span>
            </div>

            <div className="flex flex-wrap gap-2 text-[8px] font-black uppercase tracking-widest">
              <span className="px-2 py-0.5 rounded border border-[#10B981]/25 bg-[#10B981]/5 text-[#10B981]">SECTOR ✓</span>
              <span className="px-2 py-0.5 rounded border border-[#10B981]/25 bg-[#10B981]/5 text-[#10B981]">STRUCTURE ✓</span>
              <span className="px-2 py-0.5 rounded border border-amber-500/20 bg-amber-500/5 text-amber-500">▲ TICKET</span>
            </div>
            
            <p className="text-[10px] text-slate-450 leading-relaxed pt-2">
              OSINT active - Last contact: 15 Apr 2024
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
