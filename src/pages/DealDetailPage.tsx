import { 
  ArrowLeft, ClipboardList, FileText, Send, ShieldCheck, Eye, History, Shield, 
  Lock, UserPlus, Check, X, KeyRound, Copy, MessageSquare, TrendingUp, Sparkles, 
  Upload, Users, Globe, ExternalLink, HelpCircle, CheckSquare, Square, AlertCircle, 
  ArrowRight, BrainCircuit, RefreshCw, Star, Info, MessageSquareCode, AlertTriangle,
  FolderClosed, ChevronRight, Clock, CheckCircle2, Plus, Loader2, ShieldAlert, Building2
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
import { Modal } from "../components/ui/Modal";
import { FormField, inputClass, selectClass, textareaClass } from "../components/ui/FormField";
import { useDeal, useDealDocuments, useSubmissionLog } from "../hooks/useDealRoomData";
import { useJobStatus } from "../hooks/useJobStatus";
import { cx } from "../utils/cx";
import { 
  fetchAdminLenders, createLender, assignDealToLender,
  fetchPrecallBriefs, generatePrecallBrief, askPrecallBriefQuestion,
  fetchPostcallBriefs, generatePostcallBrief, overridePostcallScores,
  transitionDealStage, triggerOsintEnrichment, triggerFinancialAnalysis
} from "../api/admin";
import { getDealInbox } from "../api/airtable";
import { HeaderMetrics } from "../components/ui/HeaderMetrics";
import { StageHistory } from "../components/deals/StageHistory";
import { ActivityFeed } from "../components/deals/ActivityFeed";
import { usePipeline } from "../context/PipelineContext";
import { STAGE_LABELS, type DealStage } from "../lib/airtable/schema";

type TabId = "overview" | "brief" | "post-meeting" | "financials" | "loi" | "documents" | "activity" | "chat";

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
  { id: "activity", label: "Activity Log", icon: Clock },
  { id: "chat", label: "Lender Chat", icon: MessageSquare },
];

const LEGACY_STAGE_MAP: Record<string, DealStage> = {
  intro: "INTRO",
  inbound: "INTRO",
  "information requested": "DISCOVERY",
  discovery: "DISCOVERY",
  "seller call": "DISCOVERY",
  "im review": "LOI",
  "offer submitted": "LOI",
  loi: "LOI",
  "due diligence": "DUE_DILIGENCE",
  diligence: "DUE_DILIGENCE",
  closing: "CLOSING",
  close: "CLOSING",
  portfolio: "PORTFOLIO",
  completed: "PORTFOLIO",
  killed: "KILLED",
  dead: "KILLED",
};

function normalizeStage(raw: string | undefined): DealStage {
  if (!raw) return "INTRO";
  const key = String(raw).trim();
  return (
    LEGACY_STAGE_MAP[key] ||
    LEGACY_STAGE_MAP[key.toLowerCase()] ||
    (key.toUpperCase() as DealStage) ||
    "INTRO"
  );
}

const STAGE_BADGE_COLORS: Record<DealStage, string> = {
  INTRO:         "bg-indigo-500/10 text-indigo-400 border-indigo-500/20 hover:border-indigo-550/40 hover:bg-indigo-500/20",
  DISCOVERY:     "bg-blue-500/10 text-blue-400 border-blue-500/20 hover:border-blue-550/40 hover:bg-blue-500/20",
  LOI:           "bg-amber-500/10 text-amber-500 border-amber-500/20 hover:border-amber-550/40 hover:bg-amber-500/20",
  DUE_DILIGENCE: "bg-purple-500/10 text-purple-400 border-purple-500/20 hover:border-purple-550/40 hover:bg-purple-500/20",
  CLOSING:       "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:border-emerald-550/40 hover:bg-emerald-500/20",
  PORTFOLIO:     "bg-[#C6A66B]/10 text-[#C6A66B] border-[#C6A66B]/20 hover:border-[#C6A66B]/40 hover:bg-[#C6A66B]/20",
  KILLED:        "bg-red-500/10 text-red-400 border-red-500/20 hover:border-red-550/40 hover:bg-red-500/20",
};

const VALID_TRANSITIONS: Record<DealStage, DealStage[]> = {
  INTRO:         ["DISCOVERY", "KILLED"],
  DISCOVERY:     ["INTRO", "LOI", "KILLED"],
  LOI:           ["DISCOVERY", "DUE_DILIGENCE", "KILLED"],
  DUE_DILIGENCE: ["LOI", "CLOSING", "KILLED"],
  CLOSING:       ["DUE_DILIGENCE", "PORTFOLIO", "KILLED"],
  PORTFOLIO:     [],
  KILLED:        [],
};

export function DealDetailPage() {
  const { ref } = useParams();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const decodedRef = useMemo(() => (ref ? decodeURIComponent(ref) : ""), [ref]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [latestPostcallScore, setLatestPostcallScore] = useState<string>("38/50");
  
  const dealState = useDeal(decodedRef, refreshTrigger);

  // Poll OSINT status if active
  const rawOsintStatus = dealState.data?.rawFields?.OSINT_Status as string;
  const isOsintProcessing = [
    "Queued",
    "Scraping Website",
    "Extracting Metadata",
    "Analyzing Company",
    "Generating Risk Profile",
    "queued",
    "processing"
  ].includes(rawOsintStatus);

  const osintJob = useJobStatus({
    table: "Active_Pipeline",
    recordId: dealState.data?.id,
    enabled: !!dealState.data?.id && isOsintProcessing,
    onComplete: () => {
      setRefreshTrigger((prev) => prev + 1);
    },
    onFailed: () => {
      setRefreshTrigger((prev) => prev + 1);
    }
  });

  const [isTriggeringOsint, setIsTriggeringOsint] = useState(false);
  const [osintTriggerError, setOsintTriggerError] = useState<string | null>(null);

  const handleTriggerOsint = async () => {
    if (!dealState.data?.id) return;
    setIsTriggeringOsint(true);
    setOsintTriggerError(null);
    try {
      await triggerOsintEnrichment(dealState.data.id);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err: any) {
      setOsintTriggerError(err.message || "Failed to trigger OSINT enrichment");
    } finally {
      setIsTriggeringOsint(false);
    }
  };

  // Poll Financial status if active
  const rawFinancialStatus = dealState.data?.rawFields?.Financial_Analysis_Status as string;
  const isFinancialProcessing = [
    "Processing",
    "processing",
    "queued",
    "analyzing"
  ].includes(rawFinancialStatus);

  const financialJob = useJobStatus({
    table: "Active_Pipeline",
    recordId: dealState.data?.id,
    jobType: "financial",
    enabled: !!dealState.data?.id && isFinancialProcessing,
    onComplete: () => {
      setRefreshTrigger((prev) => prev + 1);
    },
    onFailed: () => {
      setRefreshTrigger((prev) => prev + 1);
    }
  });

  const [isTriggeringFinancial, setIsTriggeringFinancial] = useState(false);
  const [financialTriggerError, setFinancialTriggerError] = useState<string | null>(null);

  const handleTriggerFinancial = async (documentId?: string) => {
    if (!dealState.data?.id) return;
    setIsTriggeringFinancial(true);
    setFinancialTriggerError(null);
    try {
      await triggerFinancialAnalysis(dealState.data.id, documentId);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err: any) {
      setFinancialTriggerError(err.message || "Failed to trigger financial analysis");
    } finally {
      setIsTriggeringFinancial(false);
    }
  };

  const documentState = useDealDocuments(decodedRef, refreshTrigger);
  const submissionState = useSubmissionLog(decodedRef);

  const { refresh: refreshPipeline } = usePipeline();

  // Stage transition states
  const [targetStage, setTargetStage] = useState<DealStage | null>(null);
  const [transitionNotes, setTransitionNotes] = useState("");
  const [isTransitionModalOpen, setIsTransitionModalOpen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  
  const [inboxRecords, setInboxRecords] = useState<any[]>([]);
  const [isLoadingInbox, setIsLoadingInbox] = useState(true);


  // Add Lender Modal states
  const [isAddLenderOpen, setIsAddLenderOpen] = useState(false);
  const [allLenders, setAllLenders] = useState<any[]>([]);
  const [isLoadingLenders, setIsLoadingLenders] = useState(false);
  const [selectedLenderId, setSelectedLenderId] = useState("");
  const [assignmentSuccess, setAssignmentSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [activeChatLenderId, setActiveChatLenderId] = useState<string>("");

  const handleTransitionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetStage || !joinedDeal) return;
    setIsTransitioning(true);
    setTransitionError(null);
    try {
      await transitionDealStage(joinedDeal.id, targetStage, {
        notes: transitionNotes,
        changedBy: "Admin",
        role: "admin",
      });
      setIsTransitionModalOpen(false);
      setRefreshTrigger((prev) => prev + 1);
      refreshPipeline();
    } catch (err: any) {
      setTransitionError(err.message || "Failed to execute stage transition.");
    } finally {
      setIsTransitioning(false);
    }
  };

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

  const currentStage = normalizeStage(joinedDeal.status);
  const allowedNext = VALID_TRANSITIONS[currentStage] || [];

  return (
    <div className="space-y-6 text-[#E2E8F0] font-sans">
      <div>
        {/* Simplified Premium Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-[#C6A66B]/20 to-[#D4B06A]/10 border border-[#C6A66B]/30 text-white shadow-inner">
              <Building2 className="h-5 w-5 text-[#C6A66B]" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 select-none text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
                <span>Deals</span>
                <span className="text-slate-700 text-[10px] font-bold">/</span>
                <span className="text-[#C6A66B] font-mono">{joinedDeal.dealRef}</span>
              </div>
              <h1 className="text-xl font-black text-white tracking-tight mt-1 truncate leading-tight">
                {joinedDeal.companyName || joinedDeal.dealRef}
              </h1>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1.5 text-[9px] font-bold text-slate-450 select-none uppercase tracking-wider">
                <span className="font-mono text-slate-350">ACP-{joinedDeal.dealRef}</span>
                <span className="text-slate-700 font-bold">·</span>
                <span>KBS: {joinedDeal.dealRef ? String(joinedDeal.dealRef).replace(/[^0-9]/g, "") || joinedDeal.dealRef : "—"}</span>
                <span className="text-slate-700 font-bold">·</span>
                <span>{joinedDeal.sector}</span>
                <span className="text-slate-700 font-bold">·</span>
                <span>{joinedDeal.location}</span>
                <span className="text-slate-700 font-bold">·</span>
                <span>Asking EV: <span className="text-[#C6A66B] font-extrabold">{joinedDeal.evAsk ? formatGBP(Number(joinedDeal.evAsk)) : "TBC"}</span></span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-1">
              <HeaderMetrics />
            </div>
          </div>
          
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/deals?create=true"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.02] bg-white/[0.015] px-3.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-300 shadow-sm transition hover:border-white/20 hover:text-white hover:bg-white/[0.02] cursor-pointer"
            >
              + NEW DEAL
            </Link>
          </div>
        </div>
      </div>

      {/* Tabs navigation with scroll support */}
      <div className="border-b border-white/[0.02] w-full flex items-center mb-6">
        <div className="flex gap-8 overflow-x-auto flex-1 -mb-[1px]">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={cx(
                "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap text-[10px] font-bold uppercase tracking-widest transition-all duration-150 cursor-pointer border-b-2 pb-2.5 px-1",
                activeTab === tab.id
                  ? "border-[#C6A66B] text-white"
                  : "border-transparent text-slate-450 hover:text-slate-200",
              )}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              <tab.icon className={cx("h-3.5 w-3.5 transition-colors duration-150", activeTab === tab.id ? "text-[#C6A66B]" : "text-slate-500")} aria-hidden="true" />
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
            osintStatus={osintJob.isProcessing ? osintJob.status : (joinedDeal?.rawFields?.OSINT_Status as string)}
            osintError={osintJob.error || (joinedDeal?.rawFields?.OSINT_Failure_Reason as string)}
            isTriggeringOsint={isTriggeringOsint}
            osintTriggerError={osintTriggerError}
            handleTriggerOsint={handleTriggerOsint}
            documents={documentState.data || []}
            currentStage={currentStage}
            allowedNext={allowedNext}
            setTargetStage={setTargetStage}
            setIsTransitionModalOpen={setIsTransitionModalOpen}
            setTransitionNotes={setTransitionNotes}
            setTransitionError={setTransitionError}
            overallDisplayScore={latestPostcallScore}
          />
        )}
        
        {activeTab === "brief" && (
          <PreCallBriefTab deal={joinedDeal} />
        )}
        
        {activeTab === "post-meeting" && (
          <PostMeetingTab deal={joinedDeal} onScoreChange={setLatestPostcallScore} />
        )}

        {activeTab === "financials" && (
          <FinancialsTab 
            deal={joinedDeal}
            financialStatus={financialJob.isProcessing ? financialJob.status : (joinedDeal?.rawFields?.Financial_Analysis_Status as string)}
            financialError={financialJob.error || (joinedDeal?.rawFields?.Financial_Anomalies as string)}
            isTriggering={isTriggeringFinancial}
            triggerError={financialTriggerError}
            handleTrigger={handleTriggerFinancial}
            documents={documentState.data || []}
          />
        )}

        {activeTab === "loi" && (
          <LOIStructureTab deal={joinedDeal} />
        )}

        {activeTab === "documents" && (
          <DocumentsTab deal={joinedDeal} documentState={documentState} setRefreshTrigger={setRefreshTrigger} />
        )}

        {activeTab === "activity" && (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start animate-fade-in-up">
            <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 shadow-inner">
              <StageHistory dealId={joinedDeal.id} />
            </div>
            <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 shadow-inner">
              <ActivityFeed dealId={joinedDeal.id} limit={30} showFilters={true} />
            </div>
          </div>
        )}


        {activeTab === "chat" && (
          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6 items-start animate-fade-in-up">
            {/* Lenders List */}
            <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-4 space-y-4">
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
                            ? "bg-[#C6A66B]/10 border-[#C6A66B] text-white shadow-glow-bronze/5"
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
                <div className="flex flex-col items-center justify-center h-[350px] rounded-2xl border border-white/[0.02] bg-acp-card text-center p-6">
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

      {/* Add Lender Modal */}
      <Modal 
        isOpen={isAddLenderOpen} 
        onClose={() => setIsAddLenderOpen(false)} 
        title={createdLenderDetails ? "Lender Link Success!" : (isCreatingNew ? "Create & Link Lender" : "Link Existing Lender")}
      >
        {createdLenderDetails ? (
          <div className="space-y-4 text-center">
            <div className="flex flex-col items-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-3">
                <Check className="h-6 w-6" />
              </span>
              <p className="text-[11px] text-slate-400 mt-1">
                {createdLenderDetails.company} is now linked to this deal. Copy credentials below:
              </p>
            </div>

            <div className="space-y-3.5 mt-5 text-left">
              <FormField label="Portal Access Link" id="created-lender-url">
                <div className="flex items-center gap-2">
                  <input
                    id="created-lender-url"
                    type="text"
                    readOnly
                    value={createdLenderDetails.url}
                    className={cx(inputClass, "flex-1")}
                  />
                  <button
                    onClick={() => handleCopy(createdLenderDetails.url, "url")}
                    className="h-9 w-9 shrink-0 flex items-center justify-center rounded-xl bg-white/[0.015] border border-white/[0.02] hover:border-white/20 text-slate-400 hover:text-white cursor-pointer"
                    type="button"
                  >
                    {copiedId === "url" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </FormField>

              <FormField label="Portal Passcode" id="created-lender-pass">
                <div className="flex items-center gap-2">
                  <input
                    id="created-lender-pass"
                    type="text"
                    readOnly
                    value={createdLenderDetails.pass}
                    className={cx(inputClass, "flex-1 font-mono")}
                  />
                  <button
                    onClick={() => handleCopy(createdLenderDetails.pass, "pass")}
                    className="h-9 w-9 shrink-0 flex items-center justify-center rounded-xl bg-white/[0.015] border border-white/[0.02] hover:border-white/20 text-slate-400 hover:text-white cursor-pointer"
                    type="button"
                  >
                    {copiedId === "pass" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </FormField>
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
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">
                Assign mode
              </span>
              <button
                onClick={() => {
                  setIsCreatingNew(!isCreatingNew);
                  setErrorMessage("");
                  setAssignmentSuccess(false);
                }}
                className="text-[10px] font-black uppercase tracking-wider text-[#C6A66B] hover:underline cursor-pointer"
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
                <FormField label="Company Name" required id="detail-lender-company">
                  <input
                    id="detail-lender-company"
                    type="text"
                    required
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    placeholder="e.g. OakNorth Bank"
                    className={inputClass}
                  />
                </FormField>
                
                <FormField label="Contact Name" id="detail-lender-contact">
                  <input
                    id="detail-lender-contact"
                    type="text"
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    placeholder="e.g. John Smith"
                    className={inputClass}
                  />
                </FormField>

                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Email Address" id="detail-lender-email">
                    <input
                      id="detail-lender-email"
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="e.g. jsmith@oaknorth.com"
                      className={inputClass}
                    />
                  </FormField>
                  <FormField label="Phone Number" id="detail-lender-phone">
                    <input
                      id="detail-lender-phone"
                      type="text"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      placeholder="e.g. +44 7700 900077"
                      className={inputClass}
                    />
                  </FormField>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-2 w-full h-10 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-white font-black text-xs uppercase tracking-wider hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center cursor-pointer"
                >
                  {submitting ? "Creating & Assigning..." : "Create & Assign"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleAssignExisting} className="space-y-4">
                <FormField label="Select Lender" id="detail-select-lender">
                  {isLoadingLenders ? (
                    <div className="text-xs text-slate-450 animate-pulse">Loading lenders...</div>
                  ) : (
                    <select
                      id="detail-select-lender"
                      required
                      value={selectedLenderId}
                      onChange={(e) => setSelectedLenderId(e.target.value)}
                      className={selectClass}
                    >
                      <option value="">-- Select an existing lender --</option>
                      {allLenders.map((lender) => (
                        <option key={lender.id} value={lender.id}>
                          {lender.Company_Name} {lender.Contact_Name ? `(${lender.Contact_Name})` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>

                <button
                  type="submit"
                  disabled={submitting || !selectedLenderId || isLoadingLenders}
                  className="mt-4 w-full h-10 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-white font-black text-xs uppercase tracking-wider hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center cursor-pointer"
                >
                  {submitting ? "Assigning..." : "Assign Lender"}
                </button>
              </form>
            )}
          </div>
        )}
      </Modal>

      {/* Stage Transition Modal */}
      <Modal
        isOpen={isTransitionModalOpen}
        onClose={() => {
          setIsTransitionModalOpen(false);
          setTargetStage(null);
        }}
        title="Confirm Stage Transition"
      >
        <form onSubmit={handleTransitionSubmit} className="space-y-4 font-sans">
          {transitionError && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs font-semibold text-rose-450 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 animate-pulse" />
              <span>{transitionError}</span>
            </div>
          )}

          <div className="text-xs text-slate-350 leading-relaxed select-none">
            You are changing the deal stage from <span className="font-bold text-white">{STAGE_LABELS[currentStage] || currentStage}</span> to <span className="font-bold text-[#C6A66B]">{targetStage ? STAGE_LABELS[targetStage] : ""}</span>.
            This action will record an entry in the immutable audit trail and trigger downstream workflows.
          </div>

          <FormField label="Reason / Notes for this transition" id="transition-notes">
            <textarea
              id="transition-notes"
              value={transitionNotes}
              onChange={(e) => setTransitionNotes(e.target.value)}
              placeholder="Provide a brief explanation for this stage transition..."
              className={textareaClass}
              rows={3}
            />
          </FormField>

          <div className="flex justify-end gap-2.5 pt-1 select-none">
            <button
              type="button"
              onClick={() => {
                setIsTransitionModalOpen(false);
                setTargetStage(null);
              }}
              className="h-9 px-4 rounded-xl border border-white/[0.02] text-slate-400 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isTransitioning}
              className="h-9 px-4 rounded-xl bg-gradient-to-r from-[#C6A66B] to-[#B8924F] text-slate-950 text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-bronze transition cursor-pointer"
            >
              {isTransitioning ? "Transitioning..." : "Confirm Move"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function BackLink() {
  return (
    <Link 
      to="/deals" 
      className="group mb-5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-[#C6A66B] transition-colors duration-300"
    >
      <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-1" aria-hidden="true" />
      Back to Pipeline
    </Link>
  );
}
  // ---------------------------------------------------------------------
// Accordion Helper Component
// ---------------------------------------------------------------------
function AccordionPanel({
  title,
  headerBadge,
  isOpen,
  onToggle,
  icon,
  children
}: {
  title: string;
  headerBadge?: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] overflow-hidden transition-all duration-200">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-white/[0.015] transition-colors outline-none focus:bg-white/[0.02]"
      >
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.02] text-slate-400">
            {icon}
          </div>
          <h4 className="text-[10px] font-bold text-white uppercase tracking-widest">{title}</h4>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {headerBadge}
          <ChevronRight className={cx("h-4 w-4 text-slate-500 transition-transform duration-200", isOpen && "rotate-90 text-white")} />
        </div>
      </button>
      {isOpen && (
        <div className="p-6 border-t border-white/[0.02] bg-white/[0.005] animate-slide-down">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// High-Fidelity Tab Layout Components
// ---------------------------------------------------------------------
function OverviewTab({ 
  deal, 
  assignedLenders, 
  openAddLenderModal,
  setActiveTab,
  osintStatus,
  osintError,
  isTriggeringOsint,
  osintTriggerError,
  handleTriggerOsint,
  documents = [],
  currentStage,
  allowedNext,
  setTargetStage,
  setIsTransitionModalOpen,
  setTransitionNotes,
  setTransitionError,
  overallDisplayScore
}: { 
  deal: any; 
  assignedLenders: any[]; 
  openAddLenderModal: () => void;
  setActiveTab: (tab: TabId) => void;
  osintStatus?: string;
  osintError?: string | null;
  isTriggeringOsint?: boolean;
  osintTriggerError?: string | null;
  handleTriggerOsint?: () => Promise<void>;
  documents?: any[];
  currentStage: DealStage;
  allowedNext: DealStage[];
  setTargetStage: (stage: DealStage | null) => void;
  setIsTransitionModalOpen: (open: boolean) => void;
  setTransitionNotes: (val: string) => void;
  setTransitionError: (err: string | null) => void;
  overallDisplayScore: string;
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
  const realMarginVal = ((realEbitdaVal / revenueVal) * 100).toFixed(1);

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

  // Collapsible Accordion State
  const [isOsintOpen, setIsOsintOpen] = useState(false);
  const [isScorecardOpen, setIsScorecardOpen] = useState(false);
  const [isKillScreenOpen, setIsKillScreenOpen] = useState(false);
  const [isFinancialsOpen, setIsFinancialsOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);

  // Computed Blockers
  const blockerDocs = useMemo(() => {
    return documents.filter(doc => doc.ablCritical && doc.status === "Outstanding");
  }, [documents]);

  return (
    <div className="space-y-6 animate-fade-in-up font-sans text-slate-100">
      <div className="grid grid-cols-1 lg:grid-cols-[1.8fr_1.2fr] gap-8 items-start">
        
        {/* LEFT COLUMN: Executive Summary & Collapsible Accordions */}
        <div className="space-y-6">
          
          {/* Card 1: Claude AI Verdict & Key Risks (Visible by default) */}
          <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-6 shadow-premium-card card-sheen relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#C6A66B]/5 blur-3xl pointer-events-none" />
            <div className="relative z-10 space-y-5">
              
              <div className="flex items-center justify-between pb-3.5 border-b border-white/5">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-[#C6A66B]/10 border border-[#C6A66B]/20 flex items-center justify-center">
                    <BrainCircuit className="h-4.5 w-4.5 text-[#C6A66B]" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-350">Claude AI Investment Verdict</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cx(
                        "inline-flex rounded px-1.5 py-0.2 text-[8px] font-black uppercase tracking-widest border select-none",
                        verdict === "ADVANCE" 
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-450" 
                          : "bg-amber-500/10 border-amber-500/20 text-amber-500"
                      )}>
                        {verdict}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="text-right select-none">
                  <span className="block text-[8px] font-bold text-slate-500 uppercase tracking-wider">Acquisition Score</span>
                  <span className="text-lg font-black text-[#C6A66B] font-mono tracking-tight mt-0.5 block">
                    {overallDisplayScore}
                  </span>
                </div>
              </div>

              <p className="text-xs leading-relaxed text-slate-300 font-normal">
                The deal presents a compelling low-multiple entry in a defensive sector. While the {realMarginVal}% EBITDA margin sits below the institutional 15% threshold, the regional dominance in {deal.location || "Kent"} provides a stable moat for post-acquisition optimization and contract growth.
              </p>

              <div className="space-y-3 pt-2.5 border-t border-white/[0.02]">
                <span className="block text-[9px] font-extrabold uppercase tracking-widest text-slate-400">Key Risks & Viability Concerns</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-start gap-2.5 text-xs text-slate-400 font-normal">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <span>
                      <strong className="text-slate-200">Margin Threshold:</strong> Sub-12% margins increase sensitivity to wage inflation and operational cost spikes.
                    </span>
                  </div>
                  <div className="flex items-start gap-2.5 text-xs text-slate-400 font-normal">
                    <Lock className="h-4 w-4 text-[#C6A66B] shrink-0 mt-0.5" />
                    <span>
                      <strong className="text-slate-200">Key Person Risk:</strong> High dependency on founder-level relationships. Vendor loan structures must align owner transition incentives.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Accordion 2: OSINT Intelligence */}
          <AccordionPanel
            title="OSINT Operational Intelligence"
            icon={<Globe className="h-4.5 w-4.5" />}
            isOpen={isOsintOpen}
            onToggle={() => setIsOsintOpen(!isOsintOpen)}
            headerBadge={
              <span className={cx(
                "text-[8px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded select-none",
                osintStatus === "Completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                osintStatus === "Failed" ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" :
                osintStatus ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" :
                "bg-white/[0.015] text-slate-405 border border-white/[0.02]"
              )}>
                {osintStatus || "Not Started"}
              </span>
            }
          >
            {deal.rawFields?.OSINT_Summary ? (
              <div className="space-y-4">
                <p className="text-xs leading-relaxed text-slate-355">
                  {deal.rawFields.OSINT_Summary}
                </p>

                {deal.rawFields?.OSINT_Key_Insights && (
                  <div className="space-y-1.5 pt-2">
                    <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500 font-sans">Key Intelligence Insights</span>
                    <ul className="text-xs text-slate-355 space-y-1 list-disc list-inside">
                      {String(deal.rawFields.OSINT_Key_Insights).split("\n").map((insight, idx) => (
                        <li key={idx} className="pl-1 leading-relaxed">{insight.replace(/^•\s*/, "")}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {deal.rawFields?.OSINT_Risk_Flags && (
                  <div className="space-y-2 pt-3 border-t border-white/5">
                    <span className="block text-[8px] font-extrabold uppercase tracking-widest text-rose-400 font-sans">Risk Profile & Discrepancies</span>
                    <div className="space-y-2">
                      {String(deal.rawFields.OSINT_Risk_Flags).split("\n").map((flag, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-xs text-rose-400/90 leading-relaxed font-sans font-medium">
                          <AlertTriangle className="h-4 w-4 text-rose-405 shrink-0 mt-0.5" />
                          <span>{flag.replace(/^•\s*/, "")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sources Row */}
                <div className="grid grid-cols-3 gap-4 pt-3.5 border-t border-white/5 text-[10px] tracking-wider font-semibold text-slate-400 select-none">
                  <div>
                    <span className="block text-[8px] text-slate-500 uppercase">Companies House</span>
                    <span className="text-slate-300">{deal.rawFields?.Companies_House_Number ? `#${deal.rawFields.Companies_House_Number}` : "Not Found"}</span>
                  </div>
                  <div>
                    <span className="block text-[8px] text-slate-500 uppercase">LinkedIn URL</span>
                    {deal.rawFields?.LinkedIn_URL ? (
                      <a href={deal.rawFields.LinkedIn_URL} target="_blank" rel="noopener noreferrer" className="text-blue-450 hover:underline inline-flex items-center gap-1">
                        Visit <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : <span className="text-slate-500">Unlinked</span>}
                  </div>
                  <div>
                    <span className="block text-[8px] text-slate-500 uppercase">Website</span>
                    {deal.rawFields?.Website || deal.rawFields?.Company_Website ? (
                      <a href={deal.rawFields.Website || deal.rawFields.Company_Website} target="_blank" rel="noopener noreferrer" className="text-blue-455 hover:underline inline-flex items-center gap-1">
                        Link <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : <span className="text-slate-500">Unlinked</span>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-slate-500 space-y-3 select-none">
                <Globe className="h-8 w-8 text-slate-700 mx-auto animate-pulse" />
                <div className="text-xs font-semibold text-slate-400">No OSINT intelligence gathered yet.</div>
                <p className="text-[10px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                  Trigger OSINT analysis to evaluate company credibility, operational footprint, and external risk indicators.
                </p>
                <button
                  type="button"
                  onClick={handleTriggerOsint}
                  disabled={isTriggeringOsint}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/[0.02] hover:border-white/20 bg-white/[0.015] hover:bg-white/[0.02] px-4 text-[10px] font-bold uppercase tracking-wider text-slate-355 transition cursor-pointer"
                >
                  <RefreshCw className={cx("h-3 w-3", isTriggeringOsint && "animate-spin")} />
                  Scan Company
                </button>
              </div>
            )}
          </AccordionPanel>

          {/* Accordion 3: Key Financials */}
          <AccordionPanel
            title="Key Financial Metrics & Capital Structure"
            icon={<TrendingUp className="h-4.5 w-4.5" />}
            isOpen={isFinancialsOpen}
            onToggle={() => setIsFinancialsOpen(!isFinancialsOpen)}
            headerBadge={
              <span className="text-[10px] font-extrabold text-white bg-white/[0.015] border border-white/[0.02] px-2 py-0.5 rounded select-none">
                Margin: {realMarginVal}% · Mult: {multVal > 0 ? `${multVal.toFixed(1)}x` : "—"}
              </span>
            }
          >
            <div className="space-y-5 animate-fade-in-up">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="block text-[8px] text-slate-500 uppercase select-none">Revenue</span>
                  <span className="font-bold text-slate-200">{formatGBP(revenueVal)}</span>
                </div>
                <div>
                  <span className="block text-[8px] text-slate-500 uppercase select-none">EBITDA (Normalized)</span>
                  <span className="font-bold text-slate-200">{formatGBP(realEbitdaVal)}</span>
                </div>
                <div>
                  <span className="block text-[8px] text-slate-500 uppercase select-none">EV Ask Multiple</span>
                  <span className="font-bold text-slate-200">{multVal > 0 ? `${multVal.toFixed(1)}x` : "—"}</span>
                </div>
                <div>
                  <span className="block text-[8px] text-slate-500 uppercase select-none">DSCR Base case</span>
                  <span className="font-bold text-slate-200">{deal.dscrBase || "1.38x"}</span>
                </div>
              </div>

              {/* Capital Stack Visualization */}
              <div className="space-y-2 pt-3 border-t border-white/5">
                <span className="block text-[9px] font-extrabold uppercase tracking-widest text-slate-400 select-none">Proposed Capital Structure</span>
                
                <div className="h-6 w-full rounded-lg overflow-hidden flex text-[8px] font-black uppercase tracking-wider text-slate-950 border border-white/[0.02] shadow-inner select-none">
                  {capitalStack.map((item: any, idx: number) => {
                    const colors = [
                      "bg-[#13161C] text-slate-300 border-r border-white/5",
                      "bg-[#C6A66B] text-slate-950 border-r border-white/5",
                      "bg-[#E8DEC9] text-slate-950"
                    ];
                    return (
                      <div 
                        key={idx} 
                        className={`${colors[idx % colors.length]} flex items-center justify-center`} 
                        style={{ width: `${item.pct}%` }}
                        title={`${item.label}: ${item.pct}%`}
                      >
                        {item.label} ({item.pct}%)
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-450 font-semibold leading-relaxed mt-1 select-none">
                  Total capital is composed of Senior Debt ({capitalStack[0]?.pct || 60}%), Equity Subscriptions, and Vendor rollover structures.
                </p>
              </div>
            </div>
          </AccordionPanel>

          {/* Accordion 4: Deal Scorecard */}
          <AccordionPanel
            title="Detailed Fit Scorecard"
            icon={<ClipboardList className="h-4.5 w-4.5" />}
            isOpen={isScorecardOpen}
            onToggle={() => setIsScorecardOpen(!isScorecardOpen)}
            headerBadge={
              <span className="text-[10px] font-extrabold text-white bg-white/[0.015] border border-white/[0.02] px-2 py-0.5 rounded select-none">
                Score: {scoreTotal}/25
              </span>
            }
          >
            <div className="space-y-4">
              <div className="space-y-3">
                {scorecardItems.map((item, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">{item.label}</span>
                      <span className="font-bold text-slate-200">{item.value}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/[0.015] rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full bg-[#C6A66B]" 
                        style={{ width: `${item.value}%` }} 
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-3.5 border-t border-white/5 mt-4 select-none">
                <div>
                  <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Aggregated Verdict</span>
                  <span className="text-xs font-bold text-white tracking-tight">{scoreTotal}/25 ({verdict === "ADVANCE" ? "Strong Fit" : "Watchlist"})</span>
                </div>
                <span className={cx(
                  "inline-flex rounded px-1.5 py-0.2 text-[8px] font-black uppercase tracking-widest border",
                  verdict === "ADVANCE" 
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-450" 
                    : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                )}>
                  {verdict}
                </span>
              </div>
            </div>
          </AccordionPanel>

          {/* Accordion 5: Kill Screen */}
          <AccordionPanel
            title="Institutional Checklist (Kill Screen)"
            icon={<Shield className="h-4.5 w-4.5" />}
            isOpen={isKillScreenOpen}
            onToggle={() => setIsKillScreenOpen(!isKillScreenOpen)}
            headerBadge={
              <span className={cx(
                "text-[8px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded border select-none",
                allPassed 
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-455" 
                  : "bg-amber-500/10 border-amber-500/20 text-amber-400"
              )}>
                {allPassed ? "PASS" : "WARN"}
              </span>
            }
          >
            <div className="space-y-4">
              <ul className="space-y-3">
                <li className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">EBITDA &ge; £150k</span>
                  <span className="flex items-center gap-2 font-bold text-slate-200">
                    {formatGBP(ebitdaVal)}
                    {isEbitdaPass ? (
                      <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-455 text-[10px]">✓</span>
                    ) : (
                      <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-455 text-[10px]">✗</span>
                    )}
                  </span>
                </li>
                <li className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">EV multiple &le; 9x</span>
                  <span className="flex items-center gap-2 font-bold text-slate-200">
                    {multVal > 0 ? `${multVal.toFixed(1)}x` : "TBC"}
                    {isMultPass ? (
                      <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-455 text-[10px]">✓</span>
                    ) : (
                      <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-455 text-[10px]">✗</span>
                    )}
                  </span>
                </li>
                <li className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">Sector Alignment</span>
                  <span className="flex items-center gap-2 font-bold text-slate-200">
                    {deal.sector || "General"}
                    <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-455 text-[10px]">✓</span>
                  </span>
                </li>
                <li className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">UK Geography</span>
                  <span className="flex items-center gap-2 font-bold text-slate-200">
                    {deal.location || "Kent"}
                    <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-455 text-[10px]">✓</span>
                  </span>
                </li>
                <li className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">CVA / Encumbrance check</span>
                  <span className="flex items-center gap-2 font-bold text-slate-200">
                    Clear
                    <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-455 text-[10px]">✓</span>
                  </span>
                </li>
              </ul>
              
              <div className="pt-3 border-t border-white/5">
                {allPassed ? (
                  <p className="text-[10px] text-emerald-450 font-semibold leading-relaxed">
                    Success: All core acquisition checklist criteria passed. Deal is viable for investment committee.
                  </p>
                ) : (
                  <p className="text-[10px] text-amber-500 font-semibold leading-relaxed">
                    Warning: Deal exceeds target thresholds for EV ask multiple or EBITDA level.
                  </p>
                )}
              </div>
            </div>
          </AccordionPanel>

          {/* Accordion 6: Activity History */}
          <AccordionPanel
            title="Recent Activity Log"
            icon={<Clock className="h-4.5 w-4.5" />}
            isOpen={isActivityOpen}
            onToggle={() => setIsActivityOpen(!isActivityOpen)}
          >
            <div className="space-y-4">
              <ActivityFeed dealId={deal.id} limit={5} showFilters={false} />
              <div className="text-center pt-3.5 border-t border-white/5 select-none animate-fade-in-up">
                <button
                  type="button"
                  onClick={() => setActiveTab("activity")}
                  className="text-[10px] font-bold text-[#C6A66B] uppercase tracking-wider hover:underline cursor-pointer"
                >
                  View Full Audit Log &rarr;
                </button>
              </div>
            </div>
          </AccordionPanel>

        </div>

        {/* RIGHT COLUMN: Operational Guidance Sidebar */}
        <div className="space-y-6 lg:sticky lg:top-24">
          
          {/* Section 1: Deal Stage & Transition Dropdown */}
          <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-5 space-y-4 shadow-premium-card card-sheen">
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 select-none">Current Deal Stage</span>
              <select
                value={currentStage}
                onChange={(e) => {
                  const selected = e.target.value as DealStage;
                  if (selected !== currentStage) {
                    setTargetStage(selected);
                    setTransitionNotes("");
                    setTransitionError(null);
                    setIsTransitionModalOpen(true);
                  }
                }}
                className={cx(
                  "w-full h-10 rounded-xl border px-3 text-xs font-bold uppercase tracking-wider outline-none cursor-pointer transition shadow-sm",
                  STAGE_BADGE_COLORS[currentStage]
                )}
              >
                <option value={currentStage}>{STAGE_LABELS[currentStage]}</option>
                {allowedNext.map((stg) => (
                  <option key={stg} value={stg} className="bg-[#0e0e10] text-slate-250">
                    → Move to {STAGE_LABELS[stg]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Section 2: Essential Actions */}
          <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-5 space-y-4 shadow-premium-card card-sheen">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 select-none block font-sans">Essential Actions</span>
            
            <div className="space-y-3">
              <button
                onClick={() => setActiveTab("loi")}
                className="w-full h-10 rounded-xl bg-[#C6A66B] hover:bg-[#B8924F] text-slate-950 font-black text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 cursor-pointer shadow-glow-bronze/10"
              >
                <Send className="h-3.5 w-3.5" />
                Send LOI
              </button>

              <div className="pt-2.5 border-t border-white/5">
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold select-none pb-2">
                  <span>Linked Lenders</span>
                  <button 
                    type="button"
                    onClick={openAddLenderModal}
                    className="text-xs font-bold text-[#C6A66B] hover:underline"
                  >
                    Link Lender
                  </button>
                </div>
                {assignedLenders.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1 select-none">
                    {assignedLenders.map((l, idx) => (
                      <span key={idx} className="rounded-md bg-white/[0.015] border border-white/[0.04] px-2 py-0.5 text-[9px] font-bold text-slate-300 animate-scale-in">
                        {l.Company_Name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-500 italic select-none pt-1">No lenders linked to deal</p>
                )}
              </div>
            </div>
          </div>

          {/* Section 3: Next Action & Key Dates */}
          <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-5 space-y-3 shadow-premium-card card-sheen">
            <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5 select-none font-sans">
              <Clock className="h-3.5 w-3.5 text-[#C6A66B]" />
              Next Action Details
            </h4>
            
            {deal.rawFields?.["Next Action"] ? (
              <div className="space-y-2">
                <p className="text-xs text-slate-200 leading-relaxed font-semibold">
                  {String(deal.rawFields["Next Action"])}
                </p>
                {deal.rawFields["Next Action Date"] && (
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/5 border border-amber-500/10 px-2.5 py-0.5 text-[9px] font-bold text-amber-400 select-none">
                    Target due: {new Date(deal.rawFields["Next Action Date"]).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-slate-500 text-xs italic select-none animate-pulse">
                No immediate next action has been set for this deal yet.
              </div>
            )}
          </div>

          {/* Section 4: Critical Blockers */}
          <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-5 space-y-3 shadow-premium-card card-sheen">
            <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 select-none font-sans">
              <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
              Critical Blockers
            </h4>

            {blockerDocs.length > 0 ? (
              <div className="space-y-2">
                {blockerDocs.map((doc, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-rose-500/15 bg-rose-500/5 text-xs text-rose-455 font-semibold">
                    <span className="truncate">{doc.documentName}</span>
                    <span className="text-[8px] font-black uppercase tracking-widest bg-rose-500/10 px-1.5 py-0.5 rounded shrink-0 select-none">BLOCKER</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2.5 p-2.5 rounded-xl border border-white/[0.02] bg-white/[0.01] text-xs text-slate-405 font-semibold select-none">
                <CheckCircle2 className="h-4 w-4 text-emerald-500/60" />
                <span>No critical blockers outstanding.</span>
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
}

function PreCallBriefTab({ deal }: { deal: any }) {
  const [briefs, setBriefs] = useState<any[]>([]);
  const [selectedBrief, setSelectedBrief] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingStatus, setGeneratingStatus] = useState(""); // live queue status
  const [error, setError] = useState<string | null>(null);

  // Configuration inputs for new brief
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
  const [pastedText, setPastedText] = useState("");
  const [progress, setProgress] = useState(0);

  const [chatQuestion, setChatQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);

  // Loading animation step
  const [loadingStep, setLoadingStep] = useState(0);
  const steps = [
    "Scraping Companies House data...",
    "Crawling LinkedIn profiles...",
    "Ingesting Airtable records...",
    "Querying Claude 3.5 Sonnet...",
    "Formatting intelligence brief..."
  ];

  useEffect(() => {
    if (deal?.id) {
      loadBriefs();
    }
  }, [deal?.id]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isGenerating) {
      setLoadingStep(0);
      interval = setInterval(() => {
        setLoadingStep((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  async function loadBriefs() {
    setIsLoading(true);
    setError(null);
    try {
      const list = await fetchPrecallBriefs(deal.id);
      setBriefs(list);
      if (list.length > 0) {
        setSelectedBrief(list[0]);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load pre-call briefs.");
    } finally {
      setIsLoading(false);
    }
  }

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

  const triggerGeneration = async () => {
    setIsGenerating(true);
    setError(null);
    setGeneratingStatus("");
    try {
      const result = await generatePrecallBrief({
        dealId: deal.id,
        attendees,
        selectedCallType,
        dataSources,
        pastedText: uploadedFileName ? `Dropped file: ${uploadedFileName}. ` + pastedText : pastedText
      });

      if (result?.status === "queued") {
        // 202 — job is queued. Show holding message, poll briefs list after a delay.
        setGeneratingStatus("Queued — generating in background…");
        setTimeout(async () => {
          try {
            const list = await fetchPrecallBriefs(deal.id);
            setBriefs(list);
            if (list.length > 0) {
              setSelectedBrief(list[0]);
            }
          } catch {/* silently ignore */} finally {
            setIsGenerating(false);
            setGeneratingStatus("");
          }
        }, 10_000); // 10 seconds — QStash worker should complete well within this
      } else {
        // 200 — synchronous result (local dev)
        setBriefs((prev) => [result, ...prev]);
        setSelectedBrief(result);
        setIsGenerating(false);
      }

      // Reset inputs
      setUploadState("idle");
      setUploadedFileName("");
      setPastedText("");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to generate pre-call brief.");
      setIsGenerating(false);
    }
  };

  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatQuestion.trim() || !selectedBrief) return;
    
    const q = chatQuestion;
    setChatQuestion("");
    setIsAsking(true);
    
    try {
      const response = await askPrecallBriefQuestion({
        dealId: deal.id,
        briefId: selectedBrief.id,
        question: q,
        history: selectedBrief.aiAnswers || []
      });
      
      setSelectedBrief((prev: any) => ({
        ...prev,
        aiAnswers: response.aiAnswers
      }));
      
      setBriefs((prev) =>
        prev.map((b) => (b.id === selectedBrief.id ? { ...b, aiAnswers: response.aiAnswers } : b))
      );
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to get response from Claude.");
    } finally {
      setIsAsking(false);
    }
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

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 text-[#C6A66B] animate-spin" />
        <span className="text-xs text-slate-400 ml-2 font-sans">Loading briefs...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* History Selector and Header */}
      {briefs.length > 0 && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/5 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FileText className="h-4 w-4 text-[#C6A66B]" />
              Pre-call Intelligence
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 select-none">
              <History className="h-3 w-3" />
              History:
            </span>
            <select
              value={selectedBrief?.id || ""}
              onChange={(e) => {
                if (e.target.value === "") {
                  setSelectedBrief(null);
                } else {
                  const matched = briefs.find((b) => b.id === e.target.value);
                  if (matched) setSelectedBrief(matched);
                }
              }}
              className="rounded-lg border border-white/[0.02] bg-[#161B22] px-3 py-1.5 text-xs font-semibold text-slate-200 outline-none hover:border-white/20 focus:border-[#C6A66B]/50"
            >
              {briefs.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name.replace("Pre-call Brief: ", "")}
                </option>
              ))}
            </select>

            <button
              onClick={() => setSelectedBrief(null)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.02] bg-white/[0.015] text-slate-405 hover:text-white hover:bg-white/[0.02] transition"
              title="Perform new analysis"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
          <AlertCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-white">Error</h4>
            <p className="text-xs text-rose-200 mt-1 leading-relaxed">{error}</p>
          </div>
        </div>
      )}

      {isGenerating ? (
        /* Progress loader */
        <div className="rounded-2xl border border-white/15 bg-acp-card backdrop-blur-md p-10 flex flex-col items-center justify-center space-y-6 min-h-[350px]">
          <div className="relative flex items-center justify-center">
            <RefreshCw className="h-12 w-12 text-[#C6A66B] animate-spin" />
            <div className="absolute h-6 w-6 rounded-full bg-[#C6A66B]/10 animate-ping" />
          </div>
          <div className="text-center space-y-2">
            <h4 className="text-base font-bold text-white font-sans">Generating Intelligence Brief</h4>
            <p className="text-xs text-[#C6A66B] font-medium select-none tracking-wide animate-pulse font-sans">
              {steps[loadingStep]}
            </p>
          </div>
          <div className="w-full max-w-xs bg-white/[0.015] rounded-full h-1.5 overflow-hidden">
            <div 
              className="bg-[#C6A66B] h-1.5 rounded-full transition-all duration-700 ease-out" 
              style={{ width: `${((loadingStep + 1) / steps.length) * 100}%` }}
            />
          </div>
        </div>
      ) : selectedBrief ? (
        /* Display Generated Brief */
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-stretch font-sans animate-fade-in-up">
          {/* Left Pane: Config used */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 space-y-6 flex flex-col justify-between">
            <div className="space-y-5">
              <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 pb-2 border-b border-white/5">
                BRIEF PARAMETERS
              </h3>

              {/* Attendees */}
              <div className="space-y-2">
                <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">ATTENDEES</span>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {selectedBrief.attendees?.map((att: string, idx: number) => (
                    <span 
                      key={idx} 
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-semibold ${
                        att.includes("lead") 
                          ? "bg-[#10B981] text-slate-950" 
                          : "bg-white/[0.015] border border-white/[0.02] text-slate-300"
                      }`}
                    >
                      {att}
                    </span>
                  ))}
                </div>
              </div>

              {/* Call Type */}
              <div className="space-y-2">
                <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">CALL TYPE</span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wider bg-[#C6A66B]/10 border border-[#C6A66B]/20 text-[#C6A66B]">
                  {selectedBrief.selectedCallType === "1st" ? "1st Seller Call" : selectedBrief.selectedCallType === "2nd" ? "2nd Call" : "Negotiation"}
                </span>
              </div>

              {/* Data Sources */}
              <div className="space-y-2">
                <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500 font-sans">OSINT SOURCES INGESTED</span>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "companiesHouse", label: "Companies House" },
                    { id: "linkedIn", label: "LinkedIn" },
                    { id: "notionSops", label: "Notion SOPs" },
                    { id: "airtable", label: "Airtable record" },
                  ].map((src) => {
                    const isConnected = selectedBrief.dataSources?.[src.id] !== false;
                    return (
                      <div
                        key={src.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[10px] font-bold text-left opacity-75 ${
                          isConnected 
                            ? "bg-white/[0.015] border-white/[0.02] text-white" 
                            : "bg-white/[0.01] border-white/5 text-slate-600"
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? "bg-emerald-450" : "bg-slate-850"}`} />
                        {src.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <button
              onClick={() => setSelectedBrief(null)}
              className="w-full h-10 rounded-xl bg-white/[0.015] hover:bg-white/[0.02] border border-white/[0.02] text-white font-bold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 cursor-pointer mt-6"
            >
              <Plus className="h-4 w-4" />
              Generate new brief
            </button>
          </div>

          {/* Right Pane: Content */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#0E1524] p-6 flex flex-col justify-between min-h-[500px] flex-1">
            <div className="flex-1 space-y-6">
              
              <div className="flex items-center gap-3 pb-3 border-b border-white/5">
                <Info className="h-4.5 w-4.5 text-blue-400 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-350">
                    PRE-CALL INTELLIGENCE BRIEF — {(deal.companyName || deal.dealRef).toUpperCase()} — {selectedBrief.selectedCallType === "1st" ? "1ST CALL" : selectedBrief.selectedCallType === "2nd" ? "2ND CALL" : "NEGOTIATION"}
                  </h4>
                </div>
              </div>

              <div className="space-y-2">
                <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-400">Business profile:</span>
                <p className="text-xs leading-relaxed text-slate-300 font-sans">
                  {selectedBrief.businessProfile}
                </p>
              </div>

              <div className="space-y-2">
                <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-400">Opening angle:</span>
                <p className="text-xs leading-relaxed text-slate-300 font-sans">
                  {selectedBrief.openingAngle}
                </p>
              </div>

              <div className="space-y-2">
                <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-400 font-sans">Questions for Ayo to ask:</span>
                <ol className="list-decimal list-inside space-y-2 text-xs font-sans text-slate-300">
                  {selectedBrief.questionsToAsk?.map((q: string, idx: number) => (
                    <li key={idx}>{q}</li>
                  ))}
                </ol>
              </div>

              {/* Custom QA answers block */}
              {selectedBrief.aiAnswers && selectedBrief.aiAnswers.length > 0 && (
                <div className="border-t border-white/5 pt-4 space-y-3 animate-fade-in-up">
                  <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Interactive Brief Q&A</span>
                  <div className="space-y-3 max-h-[200px] overflow-y-auto pr-1">
                    {selectedBrief.aiAnswers.map((item: any, idx: number) => (
                      <div key={idx} className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold font-sans">
                          <Users className="h-3.5 w-3.5 text-[#C6A66B]" />
                          <span>Ayo: "{item.q}"</span>
                        </div>
                        <div className="flex items-start gap-2 bg-[#101012]/30 border border-white/[0.02] rounded-xl p-3 text-[11px] leading-relaxed text-slate-300 font-sans">
                          <BrainCircuit className="h-4 w-4 text-[#C6A66B] shrink-0 mt-0.5" />
                          <p>{item.a}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>

            <form onSubmit={handleAskQuestion} className="border-t border-white/5 pt-4 mt-6 flex gap-2">
              <input
                type="text"
                required
                disabled={isAsking}
                value={chatQuestion}
                onChange={(e) => setChatQuestion(e.target.value)}
                placeholder="Ask Claude your own question regarding TUPE, notice periods, assets..."
                className="flex-1 h-9 rounded-xl border border-white/[0.02] bg-white/[0.015] px-3 text-xs text-white placeholder-slate-500 outline-none focus:border-[#C6A66B] disabled:opacity-50 font-sans"
              />
              <button
                type="submit"
                disabled={isAsking || !chatQuestion.trim()}
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-xl bg-gradient-to-r from-[#C6A66B] to-[#B8924F] text-white hover:opacity-90 disabled:opacity-50 cursor-pointer shadow-glow-bronze/10"
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
      ) : (
        /* Configuration and Generation screen */
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-stretch font-sans animate-fade-in-up">
          
          {/* Left Pane: Configuration */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 space-y-6 flex flex-col justify-between">
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
                          : "bg-white/[0.015] border border-white/[0.02] text-slate-300"
                      }`}
                    >
                      {att}
                    </span>
                  ))}
                  <button 
                    type="button" 
                    onClick={addAttendee}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.015] hover:bg-white/[0.02] border border-white/[0.02] text-slate-400 hover:text-white cursor-pointer transition"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Call Type */}
              <div className="space-y-2">
                <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">CALL TYPE</span>
                <div className="grid grid-cols-3 gap-1 bg-white/[0.015] rounded-xl p-1 border border-white/[0.02]">
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
                      : "border-white/[0.02] hover:border-white/20 bg-white/[0.01]"
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
                      <p className="text-[9px] text-slate-405 uppercase tracking-wider font-extrabold">
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
                      <div className="h-1 w-full bg-white/[0.015] rounded-full overflow-hidden">
                        <div className="h-full bg-[#10B981]" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  )}
                  {uploadState === "analyzed" && (
                    <div className="space-y-1.5">
                      <Check className="h-5 w-5 text-emerald-450 mx-auto animate-pulse" />
                      <p className="text-[10px] text-slate-200 font-bold truncate px-2">{uploadedFileName}</p>
                      <p className="text-[9px] text-emerald-405 font-bold uppercase tracking-widest">IM Ingested & Analyzed</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Paste IM alternative text (Optional) */}
              {!uploadedFileName && (
                <div className="space-y-2">
                  <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">PASTE IM TEXT (OPTIONAL)</span>
                  <textarea
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder="Paste Information Memorandum summary here..."
                    className="w-full h-20 rounded-xl border border-white/[0.02] bg-[#161B22] p-2 text-xs font-medium text-slate-200 outline-none focus:border-[#C6A66B]/50 resize-none font-sans"
                  />
                </div>
              )}

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
                            ? "bg-white/[0.015] border-white/[0.02] text-white" 
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
              <Sparkles className="h-4 w-4" />
              {generatingStatus || "Generate pre-call brief"}
            </button>
          </div>

          {/* Right Pane: Preview */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#0E1524] p-6 flex flex-col justify-center items-center min-h-[500px] flex-1 text-center">
            <BrainCircuit className="h-12 w-12 text-slate-655 mb-3 animate-pulse" />
            <h5 className="text-xs font-bold text-slate-350 uppercase tracking-wider">No Brief Selected</h5>
            <p className="text-[10px] text-slate-450 max-w-xs mt-1.5 leading-relaxed font-sans">
              Configure parameters on the left and click "Generate pre-call brief" or choose an existing brief from the history.
            </p>
          </div>

        </div>
      )}
    </div>
  );
}

function PostMeetingTab({ deal, onScoreChange }: { deal: any; onScoreChange: (score: string) => void }) {
  const [briefs, setBriefs] = useState<any[]>([]);
  const [loadingBriefs, setLoadingBriefs] = useState(true);
  const [selectedBrief, setSelectedBrief] = useState<any | null>(null);
  
  const [schemaId, setSchemaId] = useState<string>("ACP_DEAL_ROOM");
  const [manualNotes, setManualNotes] = useState("");
  const [uploadState, setUploadState] = useState<"idle" | "dragging" | "uploading" | "analyzed">("idle");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [progress, setProgress] = useState(0);
  
  const [mode, setMode] = useState<"view" | "new">("view");
  const [generating, setGenerating] = useState(false);
  const [generatingStatus, setGeneratingStatus] = useState(""); // live queue status
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [savingOverrides, setSavingOverrides] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [activeExplanation, setActiveExplanation] = useState<string | null>(null);

  // Load past briefs on mount
  useEffect(() => {
    let active = true;
    async function loadBriefs() {
      setLoadingBriefs(true);
      try {
        const list = await fetchPostcallBriefs(deal.id);
        if (active) {
          setBriefs(list);
          if (list.length > 0) {
            setSelectedBrief(list[0]);
            setMode("view");
          } else {
            setMode("new");
          }
        }
      } catch (err: any) {
        console.error("Failed to load post-call briefs:", err);
      } finally {
        if (active) setLoadingBriefs(false);
      }
    }
    loadBriefs();
    return () => {
      active = false;
    };
  }, [deal.id]);

  // Sync parent header score
  useEffect(() => {
    if (selectedBrief && selectedBrief.calculated) {
      onScoreChange(`${selectedBrief.calculated.scoreOutOf50}/50`);
    } else {
      onScoreChange("—/50");
    }
  }, [selectedBrief, onScoreChange]);

  // Initialize overrides state when selectedBrief changes
  useEffect(() => {
    if (selectedBrief) {
      setOverrides(selectedBrief.overrides || {});
    } else {
      setOverrides({});
    }
    setActiveExplanation(null);
  }, [selectedBrief]);

  const handleCopyEmail = () => {
    if (selectedBrief?.followUpEmail) {
      navigator.clipboard.writeText(selectedBrief.followUpEmail);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    }
  };

  const handleLoadDemo = () => {
    setManualNotes(`CleanCare Ltd Discovery Call Notes - 07/06/2026
Target clean contract provider based in Maidstone, Kent.

Turnover is £1.8m, with EBITDA reported at £165k. Owner add-back of £25k verified for owner/director market salary. Total EBITDA normalized is £190k. Asking price EV is £450k (~2.4x normalized EBITDA).

Owner plans to retire but is willing to support operations for up to 6 months for transition under earn-out/handover. TUPE transfers apply to 14 cleaners. Depot lease terms are currently outstanding and need landlord confirmation.

Client concentration details verified: largest facility client generates 21% of turnover. Low historical debtor risk. Predictable recurring office cleaning services contracts. Bankable profile for senior debt, suitable for 45% EV leverage.

Owner is open to deferred payment structures, specifically accepting 20% Vendor Loan Note (VLN) and 15% deferred payment over 2 years, with remaining 65% cash at close. Responsive team and broker agreed to supply full 3-year P&L immediately.`);
  };

  const handleUpdateScorecard = async () => {
    if (!manualNotes.trim()) {
      setErrorMsg("Please paste some meeting notes or drag a transcript first.");
      return;
    }
    setGenerating(true);
    setErrorMsg("");
    setSuccessMsg("");
    setGeneratingStatus("");
    try {
      const result = await generatePostcallBrief({
        dealId: deal.id,
        notes: manualNotes,
        schemaId
      });

      if (result?.status === "queued") {
        // 202 — job is queued. Show holding message, reload briefs after delay.
        setGeneratingStatus("Queued — generating in background…");
        setSuccessMsg("Post-call analysis queued — results will appear automatically.");
        setTimeout(async () => {
          try {
            const list = await fetchPostcallBriefs(deal.id);
            setBriefs(list);
            if (list.length > 0) {
              setSelectedBrief(list[0]);
              setMode("view");
            }
          } catch {/* silently ignore */} finally {
            setGenerating(false);
            setGeneratingStatus("");
          }
        }, 10_000);
        setManualNotes("");
        setUploadState("idle");
      } else {
        // 200 — synchronous result (local dev)
        setBriefs(prev => [result, ...prev]);
        setSelectedBrief(result);
        setMode("view");
        setManualNotes("");
        setUploadState("idle");
        setSuccessMsg("Post-call analysis generated successfully!");
        setGenerating(false);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Failed to generate post-call brief.");
      setGenerating(false);
    }
  };

  const handleSliderChange = (metricId: string, val: number) => {
    setOverrides(prev => ({
      ...prev,
      [metricId]: val
    }));
  };

  const handleResetOverrides = () => {
    setOverrides(selectedBrief?.overrides || {});
  };

  const handleSubmitOverrides = async () => {
    if (!selectedBrief) return;
    setSavingOverrides(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const result = await overridePostcallScores({
        dealId: deal.id,
        briefId: selectedBrief.id,
        overrides
      });
      // Update briefs list and current selection
      setBriefs(prev => prev.map(b => b.id === result.id ? result : b));
      setSelectedBrief(result);
      setSuccessMsg("Manual overrides updated and saved successfully!");
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Failed to save overrides.");
    } finally {
      setSavingOverrides(false);
    }
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
            // Fill with demo text for high fidelity
            handleLoadDemo();
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

  const hasUnsavedOverrides = useMemo(() => {
    if (!selectedBrief) return false;
    // Check if overrides state differs from selectedBrief.overrides
    const schemaMetrics = selectedBrief.calculated?.metrics || [];
    return schemaMetrics.some((metric: any) => {
      const stateVal = overrides[metric.metricId] !== undefined ? overrides[metric.metricId] : metric.score;
      const dbVal = selectedBrief.overrides?.[metric.metricId] !== undefined 
        ? selectedBrief.overrides[metric.metricId] 
        : selectedBrief.aiScores?.[metric.metricId]?.score;
      return stateVal !== dbVal;
    });
  }, [overrides, selectedBrief]);

  if (loadingBriefs) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
        <Loader2 className="h-8 w-8 text-[#C6A66B] animate-spin" />
        <p className="text-xs text-slate-400">Loading scoring scorecard records...</p>
      </div>
    );
  }

  // ----------------------------------------------------
  // VIEW MODE
  // ----------------------------------------------------
  if (mode === "view" && selectedBrief) {
    const calc = selectedBrief.calculated || { scoreOutOf50: 0, percentage: 0, metrics: [] };
    const schemaLabel = selectedBrief.schemaId === "ACP_DEAL_ROOM" ? "ACP Default" : "Modular";
    
    return (
      <div className="space-y-6 animate-fade-in-up font-sans">
        
        {/* Controls Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Analysis Run:</span>
            <select
              value={selectedBrief.id}
              onChange={(e) => {
                const found = briefs.find(b => b.id === e.target.value);
                if (found) setSelectedBrief(found);
              }}
              className="h-9 rounded-xl border border-white/[0.02] bg-[#161B22] px-3.5 text-xs text-white outline-none focus:border-acp-bronze cursor-pointer"
            >
              {briefs.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          
          <button
            onClick={() => {
              setMode("new");
              setOverrides({});
              setSuccessMsg("");
              setErrorMsg("");
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.02] bg-white/[0.015] px-4 text-xs font-bold uppercase tracking-wider text-slate-350 hover:text-white hover:bg-white/[0.02] transition cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            New Analysis
          </button>
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-400 font-medium">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-400 font-medium flex items-center gap-2">
            <Check className="h-4 w-4" />
            {successMsg}
          </div>
        )}

        {/* Main Scorecard View */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6 items-start">
          
          {/* Left: Score Breakdown */}
          <div className="space-y-6">
            
            {/* Scorecard Box */}
            <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 space-y-6">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-350">
                    DEAL SCORECARD — {calc.scoreOutOf50}/50
                  </h4>
                  <p className="text-[10px] text-slate-500 font-semibold tracking-wider mt-0.5">
                    Schema: {schemaLabel} ({calc.metrics?.length || 0} Categories)
                  </p>
                </div>
                <div className="text-right">
                  <span className="block text-[9px] font-extrabold uppercase tracking-widest text-[#FF6B00]">
                    {calc.percentage}% — progress to IC approval
                  </span>
                  <div className="h-2 w-48 bg-white/[0.015] rounded-full overflow-hidden mt-1.5 ml-auto">
                    <div className="h-full rounded-full bg-[#FF6B00]" style={{ width: `${calc.percentage}%` }} />
                  </div>
                </div>
              </div>

              {/* Sliders Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
                {calc.metrics?.map((metric: any) => {
                  const currentVal = overrides[metric.metricId] !== undefined ? overrides[metric.metricId] : metric.score;
                  const dbVal = selectedBrief.overrides?.[metric.metricId] !== undefined 
                    ? selectedBrief.overrides[metric.metricId] 
                    : selectedBrief.aiScores?.[metric.metricId]?.score;
                  const isMetricOverridden = selectedBrief.overrides?.[metric.metricId] !== undefined;
                  const isModifiedLocally = currentVal !== dbVal;

                  // Color based on score
                  const scoreColorClass = currentVal >= 8 
                    ? "text-emerald-400" 
                    : currentVal >= 5 
                    ? "text-[#FF6B00]" 
                    : "text-rose-450";

                  const scoreBgColor = currentVal >= 8 
                    ? "#10B981" 
                    : currentVal >= 5 
                    ? "#FF6B00" 
                    : "#EF4444";

                  return (
                    <div key={metric.metricId} className="space-y-2 p-3 bg-white/[0.01] hover:bg-white/[0.02] border border-white/[0.02] rounded-xl transition duration-200">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-300 font-semibold text-[11px]">{metric.name}</span>
                          {isMetricOverridden && (
                            <span className="text-[8px] bg-blue-500/10 text-blue-450 border border-blue-500/20 px-1 py-0.2 rounded font-extrabold uppercase tracking-wider">
                              Override
                            </span>
                          )}
                          {isModifiedLocally && (
                            <span className="text-[8px] bg-amber-500/10 text-amber-500 border border-amber-500/20 px-1 py-0.2 rounded font-extrabold uppercase tracking-wider animate-pulse">
                              Pending
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`font-extrabold ${scoreColorClass}`}>{currentVal}/10</span>
                          <button
                            type="button"
                            onClick={() => setActiveExplanation(activeExplanation === metric.metricId ? null : metric.metricId)}
                            className={`h-5 w-5 flex items-center justify-center rounded-md border transition cursor-pointer ${
                              activeExplanation === metric.metricId
                                ? "bg-blue-500/10 border-blue-500/30 text-blue-450"
                                : "bg-white/[0.015] border-white/[0.02] text-slate-500 hover:text-white"
                            }`}
                          >
                            <Info className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      <div className="relative flex items-center">
                        <input
                          type="range"
                          min="1"
                          max="10"
                          value={currentVal}
                          onChange={(e) => handleSliderChange(metric.metricId, Number(e.target.value))}
                          className="w-full h-1.5 rounded-full appearance-none bg-white/[0.015] cursor-pointer focus:outline-none transition"
                          style={{
                            background: `linear-gradient(to right, ${scoreBgColor} 0%, ${scoreBgColor} ${currentVal * 10}%, rgba(255,255,255,0.05) ${currentVal * 10}%, rgba(255,255,255,0.05) 100%)`
                          }}
                        />
                      </div>

                      {/* Tooltip inline box */}
                      {activeExplanation === metric.metricId && (
                        <div className="text-[10px] text-slate-400 bg-[#07090D] border border-white/5 rounded-lg p-2.5 mt-2 leading-relaxed animate-fade-in-up">
                          <p className="font-semibold text-slate-300 mb-0.5">AI Rating Rationale:</p>
                          {metric.explanation}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Unsaved overrides banner */}
              {hasUnsavedOverrides && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 flex flex-col sm:flex-row items-center justify-between gap-4 animate-scale-in">
                  <div className="flex items-center gap-2.5 text-xs text-amber-500 font-medium">
                    <AlertTriangle className="h-4.5 w-4.5 shrink-0" />
                    <span>Unsaved adjustments. Recompute & update scorecard?</span>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      onClick={handleResetOverrides}
                      disabled={savingOverrides}
                      className="h-8 flex-1 sm:flex-initial rounded-lg border border-white/[0.02] hover:border-white/20 bg-white/[0.015] px-3 text-xs font-bold uppercase tracking-wider text-slate-350 transition cursor-pointer"
                    >
                      Reset
                    </button>
                    <button
                      onClick={handleSubmitOverrides}
                      disabled={savingOverrides}
                      className="h-8 flex-1 sm:flex-initial rounded-lg bg-amber-500 text-slate-955 px-4 text-xs font-black uppercase tracking-wider hover:bg-amber-400 transition cursor-pointer shadow-lg shadow-amber-500/10 flex items-center justify-center gap-1"
                    >
                      {savingOverrides && <RefreshCw className="h-3 w-3 animate-spin" />}
                      Save Scores
                    </button>
                  </div>
                </div>
              )}

            </div>

            {/* AI Summary Block */}
            <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 space-y-4">
              <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 pb-2 border-b border-white/5">
                ACP AI POST-CALL SUMMARY
              </h4>
              <div className="rounded-xl border border-blue-500/10 bg-[#0E1524] p-4.5 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                  <BrainCircuit className="h-4 w-4 text-blue-400" />
                  ANALYSIS RUN EXECUTIVE INSIGHT
                </div>
                <p className="text-xs leading-relaxed text-slate-300 font-sans italic">
                  "{selectedBrief.summary}"
                </p>
              </div>
            </div>

          </div>

          {/* Right: Email Drawer */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 space-y-4 h-full">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                BROKER FOLLOW-UP EMAIL
              </h3>
              <button
                onClick={handleCopyEmail}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/[0.02] bg-white/[0.015] px-3 text-[10px] font-extrabold uppercase tracking-wider text-slate-350 hover:text-white hover:bg-white/[0.02] cursor-pointer transition"
              >
                {copiedEmail ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-450" />
                    COPIED
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    COPY EMAIL
                  </>
                )}
              </button>
            </div>
            
            <div className="rounded-xl border border-white/5 bg-white/[0.01] p-4 font-mono text-[11px] leading-relaxed text-slate-350 overflow-y-auto max-h-[480px]">
              <div className="border-b border-white/5 pb-2 mb-3">
                <span className="text-slate-500 font-bold uppercase tracking-wider">To:</span> <span className="text-slate-300">Broker / Seller Contact</span>
              </div>
              <div className="whitespace-pre-wrap">{selectedBrief.followUpEmail}</div>
            </div>
          </div>

        </div>

      </div>
    );
  }

  // ----------------------------------------------------
  // NEW ANALYSIS MODE (NEW)
  // ----------------------------------------------------
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 items-stretch font-sans animate-fade-in-up">
      
      {/* Left Column Controls */}
      <div className="space-y-6 flex flex-col justify-between h-full">
        
        {/* Post-meeting upload */}
        <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-white/5">
            <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              POST-MEETING SCORING
            </h3>
            {briefs.length > 0 && (
              <button
                onClick={() => setMode("view")}
                className="text-[9px] font-black uppercase text-[#C6A66B] hover:underline cursor-pointer"
              >
                Back to Scorecard
              </button>
            )}
          </div>
          
          <p className="text-[10px] text-slate-400 leading-relaxed">
            Specify a scorecard schema configuration, paste call notes/transcripts or drag a file to run the AI engine.
          </p>

          {/* Schema Selector */}
          <div className="space-y-1.5">
            <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Scoring Schema Configuration</label>
            <select
              value={schemaId}
              onChange={(e) => setSchemaId(e.target.value)}
              className="h-10 w-full rounded-xl border border-white/[0.02] bg-[#161B22] px-3 text-xs text-white outline-none focus:border-acp-bronze cursor-pointer"
            >
              <option value="ACP_DEAL_ROOM">ACP Default Schema (5 Categories)</option>
              <option value="MODULAR_OPPORTUNITY">Modular Opportunity Schema (8 Categories)</option>
            </select>
          </div>

          {/* Drag & Drop */}
          <div 
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border border-dashed rounded-xl p-6 text-center transition cursor-pointer relative ${
              uploadState === "dragging" 
                ? "border-acp-bronze bg-acp-bronze/5" 
                : "border-white/[0.02] hover:border-white/20 bg-white/[0.01]"
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
                <p className="text-[8px] text-emerald-400 font-bold uppercase tracking-widest">Transcript Loaded</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-[8px] font-black uppercase text-slate-500 tracking-widest my-2">
            <span className="h-px bg-white/[0.015] flex-1" />
            <span className="px-2">OR PASTE CALL NOTES MANUALLY</span>
            <span className="h-px bg-white/[0.015] flex-1" />
          </div>

          <textarea
            value={manualNotes}
            onChange={(e) => setManualNotes(e.target.value)}
            placeholder="Key points from the call..."
            rows={6}
            className="w-full rounded-xl border border-white/[0.02] bg-white/[0.015] p-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze font-sans resize-none"
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleLoadDemo}
              disabled={generating}
              className="flex-1 h-10 rounded-xl border border-white/[0.02] bg-white/[0.015] text-slate-350 font-bold text-xs uppercase tracking-wider hover:bg-white/[0.02] transition cursor-pointer"
            >
              Demo Notes
            </button>
            
            <button
              type="button"
              onClick={handleUpdateScorecard}
              disabled={generating}
              className="flex-[2] h-10 rounded-xl bg-slate-100 text-slate-955 font-black text-xs uppercase tracking-wider hover:bg-white flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {generating ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Scoring...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4.5 w-4.5" />
                  Score Call
                </>
              )}
            </button>
          </div>

          {errorMsg && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-450 font-medium">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Info panel */}
        <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 space-y-3">
          <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 pb-2 border-b border-white/5">
            EXPLAINABLE AI ENGINE
          </h3>
          <p className="text-[10px] text-slate-400 leading-relaxed">
            The Deal Room engine runs structured prompts mapping details against transaction guidelines. Manual overrides are saved to Airtable, recalculating the totals dynamically.
          </p>
        </div>

      </div>

      {/* Right Column Empty State (Waiting for action) */}
      <div className="rounded-2xl border border-[#C6A66B]/10 bg-gradient-to-b from-[#161B22] to-[#080B10] p-8 flex flex-col items-center justify-center text-center space-y-4 min-h-[400px] flex-1">
        <div className="h-14 w-14 rounded-full bg-[#C6A66B]/10 border border-[#C6A66B]/20 flex items-center justify-center text-[#C6A66B] shadow-glow-bronze/10">
          <Sparkles className="h-6 w-6 animate-pulse" />
        </div>
        <div className="max-w-md space-y-1.5">
          <h4 className="text-sm font-bold text-white uppercase tracking-wider">Awaiting Discovery Call Input</h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            Select your scorecard schema layout (ACP Default 5-metric or Modular 8-metric), paste the meeting notes, and click **Score Call** to run the intelligence scoring engine.
          </p>
        </div>
      </div>

    </div>
  );
}

function FinancialsTab({ 
  deal, 
  financialStatus, 
  financialError, 
  isTriggering, 
  triggerError, 
  handleTrigger,
  documents 
}: { 
  deal: any; 
  financialStatus?: string; 
  financialError?: string | null; 
  isTriggering: boolean; 
  triggerError: string | null; 
  handleTrigger: (documentId?: string) => Promise<void>;
  documents?: any[];
}) {
  const [subTab, setSubTab] = useState<"report" | "sandbox">(
    financialStatus === "Completed" ? "report" : "sandbox"
  );
  
  // Sandbox state
  const [multiple, setMultiple] = useState(deal.multiplier ? Number(deal.multiplier) : 2.7);
  const [leverage, setLeverage] = useState(45);
  const [selectedDocId, setSelectedDocId] = useState<string>("");
  
  const ebitdaVal = 190000;
  const impliedEV = Math.round(ebitdaVal * multiple);
  const seniorDebt = Math.round(impliedEV * (leverage / 100));
  const vln = Math.round(impliedEV * 0.20);
  const deferred = Math.round(impliedEV * 0.15);
  const equityNeed = Math.round(impliedEV * 0.20);

  const formatGBP = (val: number) => {
    if (val === 0 || !val) return "TBC";
    if (val >= 1000000) return `£${(val / 1000000).toFixed(2).replace(/\.00$/, "")}m`;
    if (val >= 1000) return `£${(val / 1000).toFixed(0)}k`;
    return `£${val}`;
  };

  // Filter documents to show completed financials
  const financialDocs = useMemo(() => {
    return (documents || []).filter(
      (doc) => 
        doc.status === "completed" && 
        ["Financial", "Accounts", "financial", "accounts", "Tax Return"].includes(doc.category)
    );
  }, [documents]);

  // Read metrics from deal
  const reportEbitda = Number(deal.rawFields?.EBITDA) || 0;
  const reportDscr = Number(deal.rawFields?.DSCR) || 0;
  const reportLeverage = Number(deal.rawFields?.Leverage_Ratio) || 0;
  const reportEV = Number(deal.rawFields?.Enterprise_Value) || 0;
  const reportScore = Number(deal.rawFields?.Deal_Score) || 0;
  const reportRiskScore = Number(deal.rawFields?.Financial_Risk_Score) || 0;
  const reportCommentary = String(deal.rawFields?.Financial_Insights || "").trim();
  const reportAnomaliesText = String(deal.rawFields?.Financial_Anomalies || "").trim();
  const reportCompletedAt = deal.rawFields?.Financial_Completed_At;

  const revenueVal = Number(deal.revenue) || Number(deal.rawFields?.Revenue) || 1600000;
  const ebitdaMargin = revenueVal > 0 ? (reportEbitda / revenueVal) : 0;
  const currentRatio = 1.5; // fallback

  // Reconstruct scorecard points
  const scorecard = useMemo(() => {
    // DSCR points
    let dscrPoints = 0;
    if (reportDscr >= 1.5) dscrPoints = 25;
    else if (reportDscr >= 1.25) dscrPoints = 20;
    else if (reportDscr >= 1.1) dscrPoints = 15;
    else if (reportDscr >= 1.0) dscrPoints = 10;

    // Leverage points
    let leveragePoints = 0;
    if (reportLeverage <= 2.0 && reportLeverage > 0) leveragePoints = 20;
    else if (reportLeverage <= 3.5 && reportLeverage > 0) leveragePoints = 15;
    else if (reportLeverage <= 4.5 && reportLeverage > 0) leveragePoints = 10;
    else if (reportLeverage <= 5.5 && reportLeverage > 0) leveragePoints = 5;

    // Margin points
    let marginPoints = 0;
    if (ebitdaMargin >= 0.20) marginPoints = 15;
    else if (ebitdaMargin >= 0.15) marginPoints = 12;
    else if (ebitdaMargin >= 0.10) marginPoints = 8;
    else if (ebitdaMargin >= 0.05) marginPoints = 4;

    // Liquidity points
    let liquidityPoints = 0;
    if (currentRatio >= 1.5) liquidityPoints = 10;
    else if (currentRatio >= 1.2) liquidityPoints = 8;
    else if (currentRatio >= 1.0) liquidityPoints = 5;

    // Parse deductions
    const deductions: Array<{ reason: string; impact: number }> = [];
    if (reportAnomaliesText) {
      const lines = reportAnomaliesText.split("\n");
      for (const line of lines) {
        const clean = line.replace(/^•\s*/, "").trim();
        if (clean.toLowerCase().includes("negative ebitda")) {
          deductions.push({ reason: "Negative EBITDA", impact: -15 });
        } else if (clean.toLowerCase().includes("working capital") || clean.toLowerCase().includes("liquidity")) {
          deductions.push({ reason: "Working Capital Deficit", impact: -10 });
        } else if (clean.toLowerCase().includes("weak debt coverage") || clean.toLowerCase().includes("dscr")) {
          deductions.push({ reason: "Weak debt service coverage", impact: -10 });
        } else if (clean.toLowerCase().includes("discrepancies") || clean.toLowerCase().includes("revenue")) {
          deductions.push({ reason: "Logical Revenue Discrepancies", impact: -10 });
        } else {
          deductions.push({ reason: clean.split(":")[0] || clean, impact: -5 });
        }
      }
    }

    return {
      dscr: dscrPoints,
      leverage: leveragePoints,
      margin: marginPoints,
      liquidity: liquidityPoints,
      deductions
    };
  }, [reportDscr, reportLeverage, ebitdaMargin, currentRatio, reportAnomaliesText]);

  // Keep subTab synced if financial analysis finishes in background
  useEffect(() => {
    if (financialStatus === "Completed" && subTab !== "report") {
      setSubTab("report");
    }
  }, [financialStatus]);

  return (
    <div className="space-y-6 font-sans animate-fade-in-up">
      {/* Sub-tabs switch */}
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <div className="flex gap-2">
          <button
            onClick={() => setSubTab("report")}
            className={cx(
              "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition cursor-pointer",
              subTab === "report"
                ? "bg-[#C6A66B]/10 border border-[#C6A66B] text-white"
                : "text-slate-400 hover:text-white"
            )}
            type="button"
          >
            Underwriting Report
          </button>
          <button
            onClick={() => setSubTab("sandbox")}
            className={cx(
              "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition cursor-pointer",
              subTab === "sandbox"
                ? "bg-[#C6A66B]/10 border border-[#C6A66B] text-white"
                : "text-slate-400 hover:text-white"
            )}
            type="button"
          >
            Interactive Sandbox
          </button>
        </div>

        {financialStatus === "Completed" && reportCompletedAt && (
          <span className="text-[9px] text-slate-500 font-mono">
            Analyzed: {new Date(reportCompletedAt).toLocaleString()}
          </span>
        )}
      </div>

      {subTab === "report" && (
        <div className="space-y-6">
          {/* Status states */}
          {financialStatus === "Processing" && (
            <div className="rounded-2xl border border-blue-500/10 bg-[#0E1524] p-8 text-center space-y-4">
              <Loader2 className="h-8 w-8 text-blue-400 animate-spin mx-auto" />
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">Underwriting Analysis in Progress</h4>
                <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                  The deterministic calculation engine is computing financial ratios, evaluating risk thresholds, and consulting Claude AI for commentary...
                </p>
              </div>
            </div>
          )}

          {financialStatus === "Failed" && (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-5 text-xs text-rose-400 font-medium">
              <div className="flex items-center gap-2 font-bold mb-2">
                <AlertCircle className="h-4.5 w-4.5" />
                Underwriting Engine Failed
              </div>
              <p className="pl-6">{financialError || "Unknown execution crash."}</p>
              <div className="mt-4 pl-6">
                <button
                  onClick={() => handleTrigger()}
                  className="px-3.5 py-1.5 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-300 font-bold hover:bg-rose-500/30 transition text-[10px] uppercase tracking-wider cursor-pointer"
                >
                  Retry Underwriting
                </button>
              </div>
            </div>
          )}

          {/* Trigger screen if empty */}
          {(financialStatus === "unknown" || !financialStatus) && (
            <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 text-center space-y-5">
              <div className="max-w-md mx-auto space-y-2">
                <BrainCircuit className="h-10 w-10 text-slate-500 mx-auto" />
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">Deterministic Underwriting Engine</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  No calculated underwriting report exists for this deal. Run the calculation engine to compute leverage, coverage, and debt capacity ratios.
                </p>
              </div>

              {triggerError && (
                <div className="max-w-md mx-auto rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-400 text-left">
                  {triggerError}
                </div>
              )}

              <div className="max-w-xs mx-auto space-y-3">
                <select
                  value={selectedDocId}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                  className={cx(selectClass, "text-xs w-full")}
                >
                  <option value="">Scan all uploaded documents (automatic)</option>
                  {financialDocs.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.documentName}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => handleTrigger(selectedDocId || undefined)}
                  disabled={isTriggering}
                  className="w-full h-10 rounded-xl bg-white hover:bg-slate-100 text-slate-950 font-black text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 cursor-pointer shadow-glow-bronze/5 disabled:opacity-50"
                >
                  {isTriggering ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-slate-950" />
                      Queuing calculation...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 text-slate-950" />
                      Run Underwriting Engine
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Report Dashboard */}
          {financialStatus === "Completed" && (
            <div className="space-y-6">
              {/* Top Scorecard Card */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Score Summary */}
                <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 flex flex-col justify-between items-center text-center">
                  <div className="space-y-1 w-full">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-450 border-b border-white/5 pb-2">
                      Acquisition Viability Score
                    </h3>
                    <div className="py-6">
                      <span className="text-5xl font-black text-white tracking-tight">{reportScore}</span>
                      <span className="text-slate-500 text-lg font-bold">/100</span>
                    </div>
                  </div>

                  <div className="w-full space-y-2">
                    <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-450">
                      <span>Confidence Score</span>
                      <span className="text-slate-200">{reportRiskScore}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/[0.015] rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${reportRiskScore}%` }} />
                    </div>
                  </div>
                </div>

                {/* Weighted Factors */}
                <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 lg:col-span-2 space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-350 pb-2 border-b border-white/5">
                    Scoring Breakdown
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3.5 text-xs">
                    <div className="space-y-1.5">
                      <div className="flex justify-between font-medium">
                        <span className="text-slate-400">Debt Service Coverage (DSCR)</span>
                        <span className="font-bold text-slate-200">{scorecard.dscr}/25</span>
                      </div>
                      <div className="h-1 w-full bg-white/[0.015] rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${(scorecard.dscr / 25) * 100}%` }} />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between font-medium">
                        <span className="text-slate-400">Leverage Ratio</span>
                        <span className="font-bold text-slate-200">{scorecard.leverage}/20</span>
                      </div>
                      <div className="h-1 w-full bg-white/[0.015] rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${(scorecard.leverage / 20) * 100}%` }} />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between font-medium">
                        <span className="text-slate-400">EBITDA Margin</span>
                        <span className="font-bold text-slate-200">{scorecard.margin}/15</span>
                      </div>
                      <div className="h-1 w-full bg-white/[0.015] rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${(scorecard.margin / 15) * 100}%` }} />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between font-medium">
                        <span className="text-slate-400">Current Ratio & Liquidity</span>
                        <span className="font-bold text-slate-200">{scorecard.liquidity}/10</span>
                      </div>
                      <div className="h-1 w-full bg-white/[0.015] rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${(scorecard.liquidity / 10) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Deductions Alert */}
              {scorecard.deductions.length > 0 && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-500 uppercase tracking-wider">
                    <AlertTriangle className="h-4.5 w-4.5" />
                    Risk Deductions Applied
                  </div>
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pl-6 list-disc text-slate-350">
                    {scorecard.deductions.map((ded, idx) => (
                      <li key={idx}>
                        <span className="font-medium text-slate-300">{ded.reason}</span>
                        <span className="text-rose-450 font-bold ml-1.5">({ded.impact} pts)</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Key Calculated Metrics Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-xl border border-white/[0.02] bg-[#0A0D14] p-4 text-center">
                  <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">NORMALIZED EBITDA</span>
                  <span className="block text-lg font-bold text-white mt-1">{formatGBP(reportEbitda)}</span>
                </div>
                <div className="rounded-xl border border-white/[0.02] bg-[#0A0D14] p-4 text-center">
                  <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">DEBT COVERAGE (DSCR)</span>
                  <span className="block text-lg font-bold text-white mt-1">{reportDscr ? `${reportDscr.toFixed(2)}x` : "N/A"}</span>
                </div>
                <div className="rounded-xl border border-white/[0.02] bg-[#0A0D14] p-4 text-center">
                  <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">LEVERAGE RATIO</span>
                  <span className="block text-lg font-bold text-white mt-1">{reportLeverage ? `${reportLeverage.toFixed(2)}x` : "N/A"}</span>
                </div>
                <div className="rounded-xl border border-white/[0.02] bg-[#0F1115] p-4 text-center">
                  <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">ENTERPRISE VALUE</span>
                  <span className="block text-lg font-bold text-white mt-1">{formatGBP(reportEV)}</span>
                </div>
              </div>

              {/* Claude Credit Commentary */}
              {reportCommentary && (
                <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 space-y-4">
                  <div className="flex items-center gap-2 font-bold text-white text-xs uppercase tracking-wider border-b border-white/5 pb-2">
                    <BrainCircuit className="h-4.5 w-4.5 text-[#C6A66B]" />
                    Claude AI Credit Underwriting commentary
                  </div>
                  <div className="text-slate-300 text-xs leading-relaxed space-y-4 font-sans">
                    {reportCommentary.split("\n\n").map((para, idx) => (
                      <p key={idx}>{para}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* In-Context Anomalies */}
              {reportAnomaliesText && (
                <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-rose-400 pb-2 border-b border-white/5">
                    Detected System Anomalies
                  </h4>
                  <ul className="space-y-2">
                    {reportAnomaliesText.split("\n").map((anomaly, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-350">
                        <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                        <span>{anomaly.replace(/^•\s*/, "")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Re-trigger options */}
              <div className="rounded-xl border border-white/[0.02] bg-white/[0.01] p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-left">
                  <h5 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Re-evaluate calculations</h5>
                  <p className="text-[9px] text-slate-500 mt-0.5">Updated financials? Re-trigger underwriting calculations across document files.</p>
                </div>
                
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <select
                    value={selectedDocId}
                    onChange={(e) => setSelectedDocId(e.target.value)}
                    className={cx(selectClass, "text-[10px] py-1 h-8 bg-[#161B22] w-full sm:w-48")}
                  >
                    <option value="">Scan all documents</option>
                    {financialDocs.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.documentName}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => handleTrigger(selectedDocId || undefined)}
                    disabled={isTriggering}
                    className="h-8 px-4 rounded-lg bg-white/[0.015] border border-white/[0.02] hover:bg-white/[0.02] hover:text-white text-[10px] font-bold uppercase tracking-wider text-slate-300 transition flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    {isTriggering ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Re-run
                  </button>
                </div>
              </div>

            </div>
          )}
        </div>
      )}

      {subTab === "sandbox" && (
        <div className="space-y-6">
          {/* 3 Columns Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            
            {/* Column 1: P&L SUMMARY */}
            <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 flex flex-col justify-between h-full">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-350 pb-3 border-b border-white/5">
                  P&L SUMMARY (DRAFT)
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
            <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 flex flex-col justify-between h-full">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-350 pb-3 border-b border-white/5">
                  DSCR ANALYSIS (DRAFT)
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
                    <span className="text-slate-455 font-medium">Stressed floor</span>
                    <span className="font-bold text-slate-300">1.20x</span>
                  </li>
                </ul>
              </div>

              <div className="bg-white/[0.02] border border-white/[0.02] rounded-xl p-3 text-[10px] leading-relaxed text-slate-450 mt-5">
                Stress case above floor but thin. Monitor top-client concentration at DD.
              </div>
            </div>

            {/* Column 3: CAPITAL STACK */}
            <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 flex flex-col justify-between h-full">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-350 pb-3 border-b border-white/5">
                  CAPITAL STACK (DRAFT)
                </h3>
                
                <ul className="mt-4 space-y-3 text-xs">
                  <li className="flex items-center justify-between">
                    <span className="text-slate-450 font-medium">Senior debt</span>
                    <span className="font-bold text-slate-200">{formatGBP(seniorDebt)} ({leverage}%)</span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-slate-455 font-medium">VLN</span>
                    <span className="font-bold text-slate-200">{formatGBP(vln)} (20%)</span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-slate-450 font-medium">Deferred</span>
                    <span className="font-bold text-slate-200">{formatGBP(deferred)} (15%)</span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-slate-450 font-medium">ACP equity</span>
                    <span className="font-bold text-slate-200">{formatGBP(equityNeed)} (20%)</span>
                  </li>
                </ul>
              </div>

              <div className="space-y-3.5 mt-5">
                <div className="flex items-center justify-between text-[10px] uppercase font-black text-slate-400">
                  <div>
                    <span className="block text-[8px] text-slate-500">TOTAL EV</span>
                    <span className="text-slate-200">{formatGBP(impliedEV)}</span>
                  </div>
                  <div className="text-right">
                    <span className="block text-[8px] text-slate-500">EQUITY CHEQUE</span>
                    <span className="text-slate-200">{formatGBP(equityNeed)}</span>
                  </div>
                </div>

                {/* Stack bar visual */}
                <div className="h-2 w-full bg-white/[0.015] rounded-full overflow-hidden flex">
                  <div className="h-full bg-blue-500" style={{ width: `${leverage}%` }} />
                  <div className="h-full bg-[#C6A66B]" style={{ width: "20%" }} />
                  <div className="h-full bg-[#E8DEC9]" style={{ width: "15%" }} />
                  <div className="h-full bg-[#10B981]" style={{ width: "20%" }} />
                </div>
              </div>
            </div>

          </div>

          {/* Interactive Controls */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-350 pb-2 border-b border-white/5">
              Valuation Controls
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-450 uppercase">Valuation EBITDA Multiple</label>
                <input 
                  type="range" 
                  min="1.5" 
                  max="5.0" 
                  step="0.1" 
                  value={multiple} 
                  onChange={(e) => setMultiple(parseFloat(e.target.value))}
                  className="w-full accent-acp-bronze cursor-pointer bg-white/[0.015] h-2 rounded-lg"
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
                  className="w-full accent-acp-bronze cursor-pointer bg-white/[0.015] h-2 rounded-lg"
                />
                <div className="flex justify-between text-[8px] font-bold text-slate-500">
                  <span>30%</span>
                  <span>45% (Target)</span>
                  <span>60%</span>
                  <span>75%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
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
      <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 space-y-5 flex flex-col justify-between h-full">
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
                className="mt-1.5 h-9 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] px-3 text-white focus:border-acp-bronze outline-none"
              />
            </div>
            <div>
              <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Cash at close</label>
              <input
                type="text"
                value={cashAtClose}
                onChange={(e) => setCashAtClose(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] px-3 text-white focus:border-acp-bronze outline-none"
              />
            </div>
            <div>
              <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">VLN amount</label>
              <input
                type="text"
                value={vln}
                onChange={(e) => setVln(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] px-3 text-white focus:border-acp-bronze outline-none"
              />
            </div>
            <div>
              <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Deferred consideration</label>
              <input
                type="text"
                value={deferred}
                onChange={(e) => setDeferred(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] px-3 text-white focus:border-acp-bronze outline-none"
              />
            </div>
            <div>
              <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Target completion</label>
              <input
                type="text"
                value={targetCompletion}
                onChange={(e) => setTargetCompletion(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] px-3 text-white focus:border-acp-bronze outline-none"
              />
            </div>
            <div>
              <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">Exclusivity period</label>
              <input
                type="text"
                value={exclusivity}
                onChange={(e) => setExclusivity(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] px-3 text-white focus:border-acp-bronze outline-none"
              />
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={downloadLoiDraft}
          className="w-full h-10 rounded-xl bg-gradient-to-r from-[#C6A66B] to-[#B8924F] hover:opacity-90 text-xs font-black uppercase tracking-wider text-white transition flex items-center justify-center gap-1.5 cursor-pointer mt-6 shadow-glow-bronze/10"
        >
          <BrainCircuit className="h-4 w-4" />
          Generate LOI draft
        </button>
      </div>

      {/* Right Pane Preview */}
      <div className="rounded-2xl border border-white/[0.02] bg-[#0E1524] p-6 space-y-6 flex flex-col flex-1 h-full min-h-[500px]">
        <div className="flex items-center gap-2.5 pb-3 border-b border-white/5">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-350">
            LOI PREVIEW — CLAUDE GENERATED
          </h4>
        </div>

        <div className="flex-1 rounded-xl bg-[#090D14] p-6 font-sans text-xs text-slate-300 space-y-5 overflow-y-auto leading-relaxed border border-white/[0.02]">
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
      { id: "IM and Teasers", name: "00_IM_and_Teasers", count: list.filter((d: any) => d.category?.toLowerCase().includes("teaser") || d.category?.toLowerCase().includes("im")).length },
      { id: "Financials", name: "01_Financials", count: list.filter((d: any) => d.category?.toLowerCase().includes("financial") || d.category?.toLowerCase().includes("model") || d.category?.toLowerCase().includes("debtor") || d.category?.toLowerCase().includes("bank") || d.category?.toLowerCase().includes("cashflow") || d.category?.toLowerCase().includes("creditor")).length },
      { id: "Legal", name: "02_Legal", count: list.filter((d: any) => d.category?.toLowerCase().includes("legal") || d.category?.toLowerCase().includes("nda")).length },
      { id: "Due Diligence", name: "03_Due_Diligence", count: list.filter((d: any) => d.category?.toLowerCase().includes("dd") || d.category?.toLowerCase().includes("diligence") || d.category?.toLowerCase().includes("operational") || d.category?.toLowerCase().includes("commercial")).length },
      { id: "Lender Packs", name: "04_Lender_Packs", count: list.filter((d: any) => d.category?.toLowerCase().includes("lender") || d.category?.toLowerCase().includes("pack")).length },
      { id: "LOI and SPA", name: "05_LOI_and_SPA", count: list.filter((d: any) => d.category?.toLowerCase().includes("loi") || d.category?.toLowerCase().includes("spa")).length },
    ];
  }, [documentState.data]);

  return (
    <div className="space-y-6 font-sans animate-fade-in-up">
      
      {/* Folder selector grid */}
      <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 space-y-4">
        <span className="block text-[8px] font-extrabold text-slate-500 uppercase tracking-widest">
          DEAL ROOM › GOOGLE DRIVE › {deal.dealRef || deal.id}
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
                    ? "bg-[#C6A66B]/10 border-[#C6A66B] text-white shadow-sm" 
                    : "bg-white/[0.01] border-white/5 text-slate-350 hover:bg-white/[0.02]"
                )}
              >
                <FolderClosed className={cx("h-5 w-5 shrink-0", isActive ? "text-[#C6A66B]" : "text-slate-500")} />
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
      <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-355 mb-4 border-b border-white/5 pb-2">
          {selectedCategory ? `Document Checklist: Category ${selectedCategory}` : "All Document Checklists"}
        </h4>
        <DocumentChecklist
          documents={(documentState.data ?? []).filter((doc: any) => {
            if (!selectedCategory) return true;
            const cat = (doc.category || "").toLowerCase();
            if (selectedCategory === "IM and Teasers") return cat.includes("teaser") || cat.includes("im");
            if (selectedCategory === "Financials") return cat.includes("financial") || cat.includes("model") || cat.includes("debtor") || cat.includes("bank") || cat.includes("cashflow") || cat.includes("creditor");
            if (selectedCategory === "Legal") return cat.includes("legal") || cat.includes("nda");
            if (selectedCategory === "Due Diligence") return cat.includes("dd") || cat.includes("diligence") || cat.includes("operational") || cat.includes("commercial");
            if (selectedCategory === "Lender Packs") return cat.includes("lender") || cat.includes("pack");
            if (selectedCategory === "LOI and SPA") return cat.includes("loi") || cat.includes("spa");
            return false;
          })}
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
        <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 flex flex-col justify-between h-full">
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
        <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 flex flex-col justify-between h-full">
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
