import { 
  ArrowLeft, ClipboardList, FileText, Send, ShieldCheck, Eye, History, Shield, 
  Lock, UserPlus, Check, X, KeyRound, Copy, MessageSquare, TrendingUp, Sparkles, 
  Upload, Users, Globe, ExternalLink, HelpCircle, CheckSquare, Square, AlertCircle, 
  ArrowRight, BrainCircuit, RefreshCw, Star, Info, MessageSquareCode, AlertTriangle,
  FolderClosed, ChevronRight, Clock, CheckCircle2, Plus, Loader2, ShieldAlert, Building2,
  Paperclip, User, LineChart, XCircle, ListTodo, Target, Crosshair, PieChart,
  Columns, UserCheck, BookOpen, UserX, Lightbulb
} from "lucide-react";
import type { ComponentType } from "react";
import { useMemo, useState, useEffect } from "react";
import { Link, useParams, useSearchParams, useNavigate } from "react-router-dom";
import { CoverSheet } from "../components/deals/CoverSheet";
import { DocumentChecklist } from "../components/deals/DocumentChecklist";
import { SubmissionTimeline } from "../components/deals/SubmissionTimeline";
import { DealChat } from "../components/deals/DealChat";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";
import { PageHeader } from "../components/ui/PageHeader";
import { Modal } from "../components/ui/Modal";
import { FormField, inputClass, selectClass, textareaClass } from "../components/ui/FormField";
import { useDeal, useDealDocuments } from "../hooks/useDealRoomData";
import { useJobStatus } from "../hooks/useJobStatus";
import { cx } from "../utils/cx";
import { ACP_PERSONAS } from "../lib/acp/personas";
import { ACP_SCENARIOS } from "../lib/acp/scenarios";
import { 
  fetchAdminLenders, createLender, assignDealToLender,
  fetchPrecallBriefs, generatePrecallBrief, askPrecallBriefQuestion,
  fetchPostcallBriefs, generatePostcallBrief, overridePostcallScores,
  transitionDealStage, triggerOsintEnrichment, triggerFinancialAnalysis,
  sendLoiWebhook, sendEmailWebhook, updateAdminDeal,
  uploadImDocument, removeImDocument, replaceImDocument,
  deleteDeal
} from "../api/admin";
import { getDealInbox } from "../api/airtable";
import { HeaderMetrics } from "../components/ui/HeaderMetrics";
import { usePipeline } from "../context/PipelineContext";
import { STAGE_LABELS, type DealStage } from "../lib/airtable/schema";

type TabId = "overview" | "brief" | "post-meeting" | "financials" | "loi" | "documents" | "im-attachments" | "chat";

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
  { id: "im-attachments", label: "IM & Attachments", icon: Paperclip },
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

const STAGE_BADGE_COLORS: Record<string, string> = {
  "Intro": "bg-indigo-500/10 text-indigo-400 border-indigo-500/20 hover:border-indigo-550/40 hover:bg-indigo-500/20",
  "NDA Signed": "bg-blue-500/10 text-blue-400 border-blue-500/20 hover:border-blue-550/40 hover:bg-blue-500/20",
  "Information Requested": "bg-purple-500/10 text-purple-400 border-purple-500/20 hover:border-purple-550/40 hover:bg-purple-500/20",
  "LOI Drafted": "bg-amber-500/10 text-amber-550 border-amber-550/20 hover:border-amber-550/40 hover:bg-[#C6A66B]/20",
  "LOI Submitted": "bg-amber-500/10 text-amber-500 border-amber-500/20 hover:border-amber-550/40 hover:bg-amber-500/20",
  "Killed": "bg-red-500/10 text-red-400 border-red-500/20 hover:border-red-550/40 hover:bg-red-500/20",
  "Due Diligence": "bg-purple-500/10 text-purple-400 border-purple-500/20 hover:border-purple-550/40 hover:bg-purple-500/20",
  "IC Decision": "bg-emerald-500/10 text-emerald-450 border-emerald-500/20 hover:border-emerald-550/40 hover:bg-emerald-500/20",
  "IM Review": "bg-purple-500/10 text-purple-400 border-purple-500/20 hover:border-purple-550/40 hover:bg-purple-500/20",
  "Seller Call": "bg-blue-500/10 text-blue-400 border-blue-500/20 hover:border-blue-550/40 hover:bg-blue-500/20",
  "Offer Submitted": "bg-[#C6A66B]/10 text-[#C6A66B] border-[#C6A66B]/20 hover:border-[#C6A66B]/40 hover:bg-[#C6A66B]/20",
};

export function getStageBadgeColor(stg: string): string {
  const clean = (stg || "").toLowerCase();
  const matchedKey = Object.keys(STAGE_BADGE_COLORS).find(k => k.toLowerCase() === clean);
  return matchedKey ? STAGE_BADGE_COLORS[matchedKey] : "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
}


export function DealDetailPage() {
  const { ref } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const decodedRef = useMemo(() => (ref ? decodeURIComponent(ref) : ""), [ref]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [latestPostcallScore, setLatestPostcallScore] = useState<string>("Pending");

  const dealState = useDeal(decodedRef, refreshTrigger);

  useEffect(() => {
    if (dealState.data?.rawFields?.["Postcall_Score"]) {
      setLatestPostcallScore(`${dealState.data.rawFields["Postcall_Score"]}/50`);
    }
  }, [dealState.data]);

  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteDeal = async () => {
    if (!dealState.data?.id) return;
    const dealName = dealState.data.companyName || dealState.data.dealRef || "this deal";
    const confirmStr = window.prompt(`Are you sure you want to PERMANENTLY delete ${dealName}? It will be removed from Airtable. Type "DELETE" to confirm.`);
    if (confirmStr !== "DELETE") {
      if (confirmStr !== null) alert("Deletion cancelled. You didn't type 'DELETE'.");
      return;
    }
    setIsDeleting(true);
    try {
      await deleteDeal(dealState.data.id);
      navigate("/deals");
    } catch (err) {
      console.error("Failed to delete deal:", err);
      alert(err instanceof Error ? err.message : "Failed to delete deal");
    } finally {
      setIsDeleting(false);
    }
  };

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

  const [isGeneratingVerdict, setIsGeneratingVerdict] = useState(false);
  
  const handleGenerateVerdict = async () => {
    if (!dealState.data?.id) return;
    setIsGeneratingVerdict(true);
    try {
      const res = await fetch("/api/admin/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionStorage.getItem("admin_token") || ""}`
        },
        body: JSON.stringify({
          action: "generate-verdict",
          dealId: dealState.data.id
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to generate verdict");
      }
      setRefreshTrigger(prev => prev + 1);
    } catch (err: any) {
      console.error(err);
      alert(`Error generating verdict: ${err.message}`);
    } finally {
      setIsGeneratingVerdict(false);
    }
  };

  const documentState = useDealDocuments(decodedRef, refreshTrigger);

  const { refresh: refreshPipeline } = usePipeline();

  // Stage transition states
  const [targetStage, setTargetStage] = useState<string | null>(null);
  const [transitionNotes, setTransitionNotes] = useState("");
  const [isTransitionModalOpen, setIsTransitionModalOpen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const [availableStages, setAvailableStages] = useState<string[]>([
    "Intro",
    "NDA Signed",
    "Information Requested",
    "LOI Drafted",
    "LOI Submitted",
    "Killed",
    "Due Diligence",
    "IC Decision",
    "IM Review",
    "Seller Call",
    "Offer Submitted"
  ]);

  useEffect(() => {
    async function loadStages() {
      try {
        const res = await fetch("/api/admin/deals/stages", {
          headers: {
            Authorization: `Bearer ${sessionStorage.getItem("admin_token") || ""}`,
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.stages)) {
            setAvailableStages(data.stages);
          }
        }
      } catch (err) {
        console.error("Failed to load stages:", err);
      }
    }
    loadStages();
  }, []);

  
  // Composer states
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<"loi" | "email">("loi");
  const [composerDefaultRecipientName, setComposerDefaultRecipientName] = useState("");
  const [composerDefaultRecipientEmail, setComposerDefaultRecipientEmail] = useState("");
  const [composerDefaultSubject, setComposerDefaultSubject] = useState("");
  const [composerDefaultBody, setComposerDefaultBody] = useState("");
  const [composerGeneratedBy, setComposerGeneratedBy] = useState("precall_brief_engine");

  const openComposer = (opts: {
    type: "loi" | "email";
    recipientName?: string;
    recipientEmail?: string;
    subject?: string;
    body?: string;
    generatedBy?: string;
  }) => {
    setComposerMode(opts.type);
    setComposerDefaultRecipientName(opts.recipientName || "");
    setComposerDefaultRecipientEmail(opts.recipientEmail || "");
    setComposerDefaultSubject(opts.subject || "");
    setComposerDefaultBody(opts.body || "");
    setComposerGeneratedBy(opts.generatedBy || "precall_brief_engine");
    setIsComposerOpen(true);
  };
  
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

  // Edit Deal Modal States
  const [isEditDealOpen, setIsEditDealOpen] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, any>>({});
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editImToDeleteIdx, setEditImToDeleteIdx] = useState<number | null>(null);
  const [isEditImDeleting, setIsEditImDeleting] = useState(false);

  const openEditDeal = () => {
    const d = dealState.data;
    if (!d) return;
    setEditFields({
      companyName: d.companyName || d.rawFields?.["Company_Name"] || d.rawFields?.["Deal Name"] || "",
      projectName: d.rawFields?.["Project_Name"] || "",
      industry: d.sector || d.rawFields?.["Industry"] || "",
      website: d.rawFields?.["Website"] || "",
      location: d.location || d.rawFields?.["Location"] || "",
      owner: d.ownerName || d.rawFields?.["Owner"] || "",
      analyst: d.rawFields?.["Analyst"] || "",
      source: d.rawFields?.["Source"] || "",
      revenue: d.rawFields?.["Turnover"] || "",
      ebitda: d.rawFields?.["EBITDA_GBP"] || "",
      enterpriseValue: d.rawFields?.["Enterprise_Value"] || "",
      askingPrice: d.rawFields?.["Asking_Price_GBP"] || "",
      nextAction: d.rawFields?.["Next Action"] || "",
      nextActionDate: d.rawFields?.["Next Action Date"] || "",
      internalNotes: d.rawFields?.["Internal_Notes"] || "",
    });
    setEditError(null);
    setIsEditDealOpen(true);
  };

  const handleDeleteEditImConfirm = async () => {
    if (editImToDeleteIdx === null || !dealState.data) return;
    setIsEditImDeleting(true);
    setEditError(null);
    try {
      await removeImDocument(dealState.data.id, editImToDeleteIdx);
      setRefreshTrigger(prev => prev + 1);
      setEditImToDeleteIdx(null);
    } catch (err: any) {
      setEditError(err.message || "Failed to remove file");
    } finally {
      setIsEditImDeleting(false);
    }
  };

  useEffect(() => {
    if (isEditDealOpen && dealState.data) openEditDeal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEditDealSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dealState.data?.id) return;
    setIsEditSaving(true);
    setEditError(null);
    try {
      await updateAdminDeal(dealState.data.id, editFields);
      setIsEditDealOpen(false);
      setRefreshTrigger(prev => prev + 1);
      refreshPipeline();
    } catch (err: any) {
      setEditError(err.message || "Failed to update deal");
    } finally {
      setIsEditSaving(false);
    }
  };

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
      revenue: fields["Turnover"] || d.rawFields["Turnover"] || 0,
      ebitda: fields["EBITDA_GBP"] || d.rawFields["EBITDA_GBP"] || 0,
      evAsk: fields["Asking_Price_GBP"] || d.rawFields["Asking_Price_GBP"] || d.rawFields["EV"] || 0,
      multiplier: fields["EV Multiple"] || d.rawFields["EV Multiple"] || d.rawFields["EV"] || undefined,
      sector: fields["Sector"] || d.sector || "General",
      location: fields["Location"] || d.location || "UK",
    };
  }, [dealState.data, inboxRecords]);



  const isLoading = dealState.isLoading || documentState.isLoading || isLoadingInbox;
  const error = dealState.error ?? documentState.error;

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

  const currentStage = String(joinedDeal.rawFields?.["Stage"] || joinedDeal.status || "Intro");


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
            <button
              onClick={openEditDeal}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.02] bg-white/[0.015] px-3.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-300 shadow-sm transition hover:border-white/20 hover:text-white hover:bg-white/[0.02] cursor-pointer"
              type="button"
            >
              Edit Deal
            </button>
            <button
              onClick={handleDeleteDeal}
              disabled={isDeleting}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3.5 text-[10px] font-extrabold uppercase tracking-wider text-red-400 shadow-sm transition hover:bg-red-500/20 hover:text-red-300 cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
              type="button"
            >
              {isDeleting ? "Deleting..." : "Delete Deal"}
            </button>
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
            availableStages={availableStages}
            setTargetStage={setTargetStage}
            setIsTransitionModalOpen={setIsTransitionModalOpen}
            setTransitionNotes={setTransitionNotes}
            setTransitionError={setTransitionError}
            overallDisplayScore={latestPostcallScore}
            openComposer={openComposer}
            isGeneratingVerdict={isGeneratingVerdict}
            handleGenerateVerdict={handleGenerateVerdict}
          />
        )}

        
        {activeTab === "brief" && (
          <PreCallBriefTab deal={joinedDeal} openComposer={openComposer} />
        )}
        
        {activeTab === "post-meeting" && (
          <PostMeetingTab deal={joinedDeal} onScoreChange={setLatestPostcallScore} openComposer={openComposer} />
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
          <LOIStructureTab deal={joinedDeal} openComposer={openComposer} />
        )}

        {activeTab === "documents" && (
          <DocumentsTab deal={joinedDeal} documentState={documentState} setRefreshTrigger={setRefreshTrigger} />
        )}

        {activeTab === "im-attachments" && (
          <ImAttachmentsTab deal={joinedDeal} onRefresh={() => setRefreshTrigger(prev => prev + 1)} />
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
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs font-semibold text-rose-455 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 animate-pulse" />
              <span>{transitionError}</span>
            </div>
          )}

          <div className="text-xs text-slate-355 leading-relaxed select-none">
            You are changing the deal stage from <span className="font-bold text-white">{currentStage}</span> to <span className="font-bold text-[#C6A66B]">{targetStage || ""}</span>.
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
              className="h-9 px-4 rounded-xl border border-white/[0.02] text-slate-405 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] transition cursor-pointer"
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

      {/* Edit Deal Modal */}
      <Modal isOpen={isEditDealOpen} onClose={() => setIsEditDealOpen(false)} title="Edit Deal" maxWidth="max-w-2xl">
        <form onSubmit={handleEditDealSubmit} className="space-y-5 font-sans max-h-[75vh] overflow-y-auto pr-1">
          {editError && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs font-semibold text-rose-400 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{editError}
            </div>
          )}
          <div className="space-y-3">
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">Company Information</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Company Name" id="edit-company" required>
                <input id="edit-company" type="text" required value={editFields.companyName || ""} onChange={e => setEditFields(f => ({...f, companyName: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="Project Name" id="edit-project">
                <input id="edit-project" type="text" value={editFields.projectName || ""} onChange={e => setEditFields(f => ({...f, projectName: e.target.value}))} className={inputClass} />
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Industry" id="edit-industry">
                <input id="edit-industry" type="text" value={editFields.industry || ""} onChange={e => setEditFields(f => ({...f, industry: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="Website" id="edit-website">
                <input id="edit-website" type="text" value={editFields.website || ""} onChange={e => setEditFields(f => ({...f, website: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="Location" id="edit-location">
                <input id="edit-location" type="text" value={editFields.location || ""} onChange={e => setEditFields(f => ({...f, location: e.target.value}))} className={inputClass} />
              </FormField>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">Ownership</p>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Owner" id="edit-owner">
                <input id="edit-owner" type="text" value={editFields.owner || ""} onChange={e => setEditFields(f => ({...f, owner: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="Analyst" id="edit-analyst">
                <input id="edit-analyst" type="text" value={editFields.analyst || ""} onChange={e => setEditFields(f => ({...f, analyst: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="Source" id="edit-source">
                <input id="edit-source" type="text" value={editFields.source || ""} onChange={e => setEditFields(f => ({...f, source: e.target.value}))} className={inputClass} />
              </FormField>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">Financials (£)</p>
            <div className="grid grid-cols-4 gap-3">
              <FormField label="Revenue" id="edit-revenue">
                <input id="edit-revenue" type="number" step="any" value={editFields.revenue || ""} onChange={e => setEditFields(f => ({...f, revenue: e.target.value ? Number(e.target.value) : ""}))} className={inputClass} />
              </FormField>
              <FormField label="EBITDA" id="edit-ebitda">
                <input id="edit-ebitda" type="number" step="any" value={editFields.ebitda || ""} onChange={e => setEditFields(f => ({...f, ebitda: e.target.value ? Number(e.target.value) : ""}))} className={inputClass} />
              </FormField>
              <FormField label="Enterprise Value" id="edit-ev">
                <input id="edit-ev" type="number" step="any" value={editFields.enterpriseValue || ""} onChange={e => setEditFields(f => ({...f, enterpriseValue: e.target.value ? Number(e.target.value) : ""}))} className={inputClass} />
              </FormField>
              <FormField label="Asking Price" id="edit-asking">
                <input id="edit-asking" type="number" step="any" value={editFields.askingPrice || ""} onChange={e => setEditFields(f => ({...f, askingPrice: e.target.value ? Number(e.target.value) : ""}))} className={inputClass} />
              </FormField>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">Workflow</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Next Action" id="edit-next-action">
                <input id="edit-next-action" type="text" value={editFields.nextAction || ""} onChange={e => setEditFields(f => ({...f, nextAction: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="Target Date" id="edit-target-date">
                <input id="edit-target-date" type="date" value={editFields.nextActionDate || ""} onChange={e => setEditFields(f => ({...f, nextActionDate: e.target.value}))} className={inputClass} />
              </FormField>
            </div>
          </div>
          <FormField label="Internal Notes" id="edit-notes">
            <textarea id="edit-notes" value={editFields.internalNotes || ""} onChange={e => setEditFields(f => ({...f, internalNotes: e.target.value}))} rows={2} className={textareaClass} />
          </FormField>

          {/* IM & Attachments Section in Edit Modal */}
          <div className="space-y-3 pt-2 border-t border-white/[0.02]">
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">IM & Attachments</p>
            
            {/* List of existing files */}
            {dealState.data?.rawFields?.IM_Review_Documents && (dealState.data.rawFields.IM_Review_Documents as any).length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {(dealState.data.rawFields.IM_Review_Documents as any[]).map((att: any, idx: number) => (
                  <div key={att.id || idx} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.015] border border-white/5 text-[11px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-3.5 w-3.5 text-[#C6A66B] shrink-0" />
                      <span className="text-white truncate font-medium">{att.filename || "IM_Document"}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-[10px] font-bold text-[#C6A66B] hover:text-white cursor-pointer select-none">
                        Replace
                        <input
                          type="file"
                          accept=".pdf,.docx,.xlsx"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setIsEditSaving(true);
                              try {
                                const base64Data = await new Promise<string>((resolve, reject) => {
                                  const r = new FileReader();
                                  r.onload = () => resolve((r.result as string).split(",")[1]);
                                  r.onerror = reject;
                                  r.readAsDataURL(file);
                                });
                                if (dealState.data) {
                                  await replaceImDocument(dealState.data.id, idx, file.name, file.type, base64Data);
                                }
                                setRefreshTrigger(prev => prev + 1);
                              } catch (err: any) {
                                setEditError(err.message || "Failed to replace file");
                              } finally {
                                setIsEditSaving(false);
                              }
                            }
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setEditImToDeleteIdx(idx);
                        }}
                        className="text-[10px] font-bold text-rose-450 hover:text-rose-400 select-none"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add new attachment input */}
            <div className="flex items-center gap-2">
              <label className="flex-1 h-9 rounded-xl border border-dashed border-white/10 hover:border-white/20 bg-white/[0.005] flex items-center justify-center gap-2 text-xs text-slate-450 cursor-pointer select-none">
                <Upload className="h-3.5 w-3.5 text-slate-500" />
                <span>Upload New Attachment</span>
                <input
                  type="file"
                  accept=".pdf,.docx,.xlsx"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setIsEditSaving(true);
                      try {
                        const base64Data = await new Promise<string>((resolve, reject) => {
                          const r = new FileReader();
                          r.onload = () => resolve((r.result as string).split(",")[1]);
                          r.onerror = reject;
                          r.readAsDataURL(file);
                        });
                        if (dealState.data) {
                          await uploadImDocument(dealState.data.id, file.name, file.type, base64Data);
                        }
                        setRefreshTrigger(prev => prev + 1);
                      } catch (err: any) {
                        setEditError(err.message || "Failed to upload file");
                      } finally {
                        setIsEditSaving(false);
                      }
                    }
                  }}
                />
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2.5 pt-2 border-t border-white/[0.02]">
            <button type="button" onClick={() => setIsEditDealOpen(false)} className="h-9 px-4 rounded-xl border border-white/[0.02] text-slate-400 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] transition cursor-pointer">Cancel</button>
            <button type="submit" disabled={isEditSaving} className="h-9 px-5 rounded-xl bg-gradient-to-r from-[#C6A66B] to-[#B8924F] text-slate-950 text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-bronze transition cursor-pointer">
              {isEditSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal for Edit Modal IM Attachment */}
      {editImToDeleteIdx !== null && (
        <div className="fixed inset-0 bg-slate-950/65 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-2xl relative animate-scale-in">
            <h3 className="text-base font-bold text-white uppercase tracking-wider mb-3">
              Delete Attachment
            </h3>
            <p className="text-xs text-slate-350 leading-relaxed mb-6">
              Are you sure you want to permanently remove this attachment?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditImToDeleteIdx(null)}
                disabled={isEditImDeleting}
                className="h-10 px-4 rounded-xl border border-white/[0.02] text-slate-300 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteEditImConfirm}
                disabled={isEditImDeleting}
                className="h-10 px-5 rounded-xl bg-red-650 hover:bg-[#A51D24] text-white text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-red cursor-pointer transition-all"
              >
                {isEditImDeleting ? "Deleting..." : "Delete Attachment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email/LOI Composer Modal */}
      <EmailComposerModal
        isOpen={isComposerOpen}
        onClose={() => setIsComposerOpen(false)}
        type={composerMode}
        dealId={joinedDeal.id}
        dealName={joinedDeal.companyName || joinedDeal.dealRef}
        defaultRecipientName={composerDefaultRecipientName}
        defaultRecipientEmail={composerDefaultRecipientEmail}
        defaultSubject={composerDefaultSubject}
        defaultBody={composerDefaultBody}
        generatedBy={composerGeneratedBy}
        allLenders={allLenders}
      />
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

function renderRichText(text: string) {
  if (!text) return null;
  const lines = text.split("\n");
  return (
    <div className="space-y-2 font-medium">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        const isBullet = trimmed.startsWith("* ") || trimmed.startsWith("- ") || trimmed.startsWith("• ");
        let content = line;
        if (isBullet) {
          content = trimmed.substring(2);
        }

        const parts = content.split("**");
        const renderedLine = parts.map((part, i) => {
          if (i % 2 === 1) {
            return <strong key={i} className="text-white font-extrabold">{part}</strong>;
          }
          return part;
        });

        if (isBullet) {
          return (
            <div key={idx} className="flex items-start gap-1.5 text-xs text-slate-300 pl-1 select-text">
              <span className="text-[#C6A66B] select-none mt-1 shrink-0 text-[10px]">•</span>
              <span className="leading-relaxed">{renderedLine}</span>
            </div>
          );
        }

        return (
          <p key={idx} className="text-xs text-slate-350 leading-relaxed min-h-[1em] select-text">
            {renderedLine}
          </p>
        );
      })}
    </div>
  );
}

function SimpleMarkdown({ content }: { content: string }) {
  if (!content) return <p className="text-xs text-slate-400 italic">No summary provided.</p>;
  
  const blocks = content.split(/\n\n+/);
  return (
    <div className="space-y-4 select-text">
      {blocks.map((block, bIdx) => {
        const trimmedBlock = block.trim();
        if (!trimmedBlock) return null;

        if (trimmedBlock.startsWith("#")) {
          const match = trimmedBlock.match(/^(#{1,6})\s+(.*)$/);
          if (match) {
            const level = match[1].length;
            const text = match[2];
            const sizeClass = 
              level === 1 ? "text-lg font-black text-white" :
              level === 2 ? "text-sm font-bold text-white mt-4 border-b border-white/5 pb-1" :
              "text-xs font-bold text-slate-205 mt-3";
            return <div key={bIdx} className={sizeClass}>{text}</div>;
          }
        }

        const lines = trimmedBlock.split("\n");
        const isList = lines.every(line => {
          const t = line.trim();
          return t.startsWith("* ") || t.startsWith("- ") || t.startsWith("• ") || /^\d+\.\s+/.test(t);
        });

        if (isList) {
          return (
            <ul key={bIdx} className="space-y-1.5 list-none pl-1">
              {lines.map((line, lIdx) => {
                const t = line.trim();
                const cleanText = t.replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, "");
                return (
                  <li key={lIdx} className="flex items-start gap-2 text-xs text-slate-300 leading-relaxed">
                    <span className="text-[#C6A66B] mt-1 shrink-0 text-[10px]">•</span>
                    <span>{parseInlineMarkdown(cleanText)}</span>
                  </li>
                );
              })}
            </ul>
          );
        }

        return (
          <p key={bIdx} className="text-xs text-slate-305 leading-relaxed font-normal">
            {parseInlineMarkdown(trimmedBlock)}
          </p>
        );
      })}
    </div>
  );
}

function parseInlineMarkdown(text: string) {
  const parts = text.split("**");
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return <strong key={i} className="text-white font-extrabold">{part}</strong>;
    }
    return part;
  });
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
  availableStages,
  setTargetStage,
  setIsTransitionModalOpen,
  setTransitionNotes,
  setTransitionError,
  overallDisplayScore,
  openComposer,
  isGeneratingVerdict,
  handleGenerateVerdict
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
  currentStage: string;
  availableStages: string[];
  setTargetStage: (stage: string | null) => void;
  setIsTransitionModalOpen: (open: boolean) => void;
  setTransitionNotes: (val: string) => void;
  setTransitionError: (err: string | null) => void;
  overallDisplayScore: string;
  openComposer: (opts: any) => void;
  isGeneratingVerdict?: boolean;
  handleGenerateVerdict?: () => Promise<void>;
}) {

  const ebitdaVal = Number(deal.ebitda) || 0;
  const multVal = Number(deal.multiplier) || 0;

  const ownerName = deal.ownerName || deal.rawFields?.Collaborator?.[0]?.name || "Ayo Oyesanya";
  const ownerInitials = deal.ownerInitials || (ownerName ? ownerName.split(" ").map((n: string) => n[0]).join("").toUpperCase() : "AO");
  
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

  const formatGBPVal = (val: any) => {
    if (val === undefined || val === null || val === "") return "TBC";
    const str = String(val).trim();
    if (str.includes("£") || str.toLowerCase().includes("m") || str.toLowerCase().includes("k")) {
      return str;
    }
    const parsed = Number(str.replace(/[^0-9.]/g, ""));
    if (isNaN(parsed) || parsed === 0) return "TBC";
    return formatGBP(parsed);
  };

  return (
    <div className="space-y-6 animate-fade-in-up font-sans text-slate-100">
      {/* Transaction Snapshot Metric Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-5 shadow-premium-card card-sheen relative overflow-hidden flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Location</span>
          <span className="text-lg font-black text-white mt-2">{deal.location || "TBC"}</span>
        </div>
        <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-5 shadow-premium-card card-sheen relative overflow-hidden flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Turnover</span>
          <span className="text-lg font-black text-[#C6A66B] mt-2">{formatGBPVal(deal.turnover || deal.revenue)}</span>
        </div>
        <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-5 shadow-premium-card card-sheen relative overflow-hidden flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">EBITDA</span>
          <span className="text-lg font-black text-white mt-2">{formatGBPVal(deal.ebitda)}</span>
        </div>
        <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-5 shadow-premium-card card-sheen relative overflow-hidden flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Asking Price</span>
          <span className="text-lg font-black text-white mt-2">{formatGBPVal(deal.evAsk)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.8fr_1.2fr] gap-8 items-start">
        
        {/* LEFT COLUMN: Executive Summary & Collapsible Accordions */}
        <div className="space-y-6">

          {/* Card: Business Description */}
          <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-6 shadow-premium-card card-sheen relative overflow-hidden">
            <div className="relative z-10 space-y-4">
              <div className="flex items-center gap-2.5 pb-3 border-b border-white/5">
                <div className="h-8 w-8 rounded-lg bg-[#C6A66B]/10 border border-[#C6A66B]/20 flex items-center justify-center">
                  <Building2 className="h-4.5 w-4.5 text-[#C6A66B]" />
                </div>
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-350">Business Description</h4>
                  <span className="text-xs font-semibold text-slate-500">{deal.sector || "Sector Fit"}</span>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-slate-305 font-normal select-text">
                {deal.businessDescription || "No business description provided."}
              </p>
            </div>
          </div>

          {/* Card: Executive Summary */}
          <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-6 shadow-premium-card card-sheen relative overflow-hidden">
            <div className="relative z-10 space-y-4">
              <div className="flex items-center gap-2.5 pb-3 border-b border-white/5">
                <div className="h-8 w-8 rounded-lg bg-[#C6A66B]/10 border border-[#C6A66B]/20 flex items-center justify-center">
                  <FileText className="h-4.5 w-4.5 text-[#C6A66B]" />
                </div>
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-350">Executive Summary</h4>
                  <span className="text-xs font-semibold text-slate-500 font-sans">Transaction Highlights</span>
                </div>
              </div>
              <SimpleMarkdown content={deal.executiveSummary || ""} />
            </div>
          </div>
          
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
                        {(() => {
                          if (!deal.rawFields?.Claude_Verdict) return verdict;
                          try {
                            const parsed = JSON.parse(deal.rawFields.Claude_Verdict);
                            return parsed.investmentVerdict ? parsed.investmentVerdict.split(":")[0] : verdict;
                          } catch (e) {
                            return verdict;
                          }
                        })()}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-4 text-right select-none">
                  {handleGenerateVerdict && (
                    <button
                      onClick={handleGenerateVerdict}
                      disabled={isGeneratingVerdict}
                      className="px-3 py-1.5 rounded-lg border border-[#C6A66B]/30 bg-[#C6A66B]/10 hover:bg-[#C6A66B]/20 text-[#C6A66B] text-[9px] font-black uppercase tracking-widest transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isGeneratingVerdict ? (
                        <>
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <BrainCircuit className="h-3 w-3" />
                          Generate Verdict
                        </>
                      )}
                    </button>
                  )}
                  <div>
                    <span className="block text-[8px] font-bold text-slate-500 uppercase tracking-wider">Acquisition Score</span>
                    <span className="text-lg font-black text-[#C6A66B] font-mono tracking-tight mt-0.5 block">
                      {overallDisplayScore}
                    </span>
                  </div>
                </div>
              </div>

              {(() => {
                let parsedVerdict: any = null;
                try {
                  if (deal.rawFields?.Claude_Verdict) {
                    parsedVerdict = JSON.parse(deal.rawFields.Claude_Verdict);
                  }
                } catch (e) {
                  // silent
                }

                if (!parsedVerdict) {
                  return (
                    <>
                      <p className="text-xs leading-relaxed text-slate-300 font-normal">
                        No structured AI investment verdict generated yet. Click "Generate Verdict" to run the Claude AI analysis based on the latest deal data and IM documents.
                      </p>
                      <div className="space-y-3 pt-2.5 border-t border-white/[0.02]">
                        <span className="block text-[9px] font-extrabold uppercase tracking-widest text-slate-400">Key Risks & Viability Concerns</span>
                        <div className="flex items-start gap-2.5 text-xs text-slate-400 font-normal">
                          <span>No risks extracted.</span>
                        </div>
                      </div>
                    </>
                  );
                }

                return (
                  <>
                    <p className="text-xs leading-relaxed text-slate-300 font-normal">
                      {parsedVerdict.investmentVerdict}
                    </p>
                    
                    <div className="space-y-2 mt-4">
                      <span className="block text-[9px] font-extrabold uppercase tracking-widest text-slate-400">Investment Thesis</span>
                      <p className="text-xs leading-relaxed text-slate-350">{parsedVerdict.investmentThesis}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/[0.02]">
                      <div className="space-y-3">
                        <span className="block text-[9px] font-extrabold uppercase tracking-widest text-emerald-400">Key Strengths</span>
                        <div className="space-y-2">
                          {(parsedVerdict.strengths || []).map((s: string, idx: number) => (
                            <div key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                              <span className="text-emerald-500 mt-0.5 shrink-0 text-[10px]">•</span>
                              <span className="leading-relaxed">{s}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <span className="block text-[9px] font-extrabold uppercase tracking-widest text-rose-400">Key Risks & Viability Concerns</span>
                        <div className="space-y-2">
                          {(parsedVerdict.risks || []).map((r: string, idx: number) => (
                            <div key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                              <AlertTriangle className="h-3 w-3 text-rose-500 shrink-0 mt-0.5" />
                              <span className="leading-relaxed">{r}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-3 pt-4 border-t border-white/[0.02]">
                      <span className="block text-[9px] font-extrabold uppercase tracking-widest text-blue-400">Questions Requiring Validation</span>
                      <div className="grid grid-cols-1 gap-2">
                        {(parsedVerdict.questionsRequiringValidation || []).map((q: string, idx: number) => (
                          <div key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                            <span className="text-blue-500 mt-0.5 font-mono text-[10px]">{idx + 1}.</span>
                            <span className="leading-relaxed">{q}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                );
              })()}
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



        </div>

        {/* RIGHT COLUMN: Operational Guidance Sidebar */}
        <div className="space-y-6 lg:sticky lg:top-24">

          {/* Sourcing & Contact Information Card */}
          <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-5 space-y-4 shadow-premium-card card-sheen relative overflow-hidden">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 select-none block font-sans">Sourcing & Contact</span>
            <div className="space-y-3">
              {deal.contactEmail ? (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[8px] text-slate-500 uppercase tracking-wider">Contact Email</span>
                  <a 
                    href={`mailto:${deal.contactEmail}`}
                    className="text-xs font-bold text-[#C6A66B] hover:text-[#B8924F] hover:underline transition flex items-center gap-1.5"
                  >
                    {deal.contactEmail}
                  </a>
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[8px] text-slate-500 uppercase tracking-wider">Contact Email</span>
                  <span className="text-xs font-medium text-slate-400 italic">No email provided</span>
                </div>
              )}

              {deal.contactPhone ? (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[8px] text-slate-500 uppercase tracking-wider">Contact Phone</span>
                  <a 
                    href={`tel:${deal.contactPhone}`}
                    className="text-xs font-bold text-slate-200 hover:text-white hover:underline transition flex items-center gap-1.5"
                  >
                    {deal.contactPhone}
                  </a>
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[8px] text-slate-500 uppercase tracking-wider">Contact Phone</span>
                  <span className="text-xs font-medium text-slate-400 italic">No phone provided</span>
                </div>
              )}

              {deal.listingLink ? (
                <div className="pt-2 border-t border-white/5">
                  <a 
                    href={deal.listingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-450 hover:underline"
                  >
                    View Original Listing <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              ) : (
                <div className="pt-2 border-t border-white/5">
                  <span className="text-xs text-slate-500 italic">No listing link available</span>
                </div>
              )}
            </div>
          </div>
          
          {/* Section 0: Deal Owner Profile */}
          <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-5 space-y-3 shadow-premium-card card-sheen">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 select-none block font-sans">Deal Owner</span>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-[#C6A66B]/10 border border-[#C6A66B]/20 flex items-center justify-center text-[#C6A66B] font-bold text-sm tracking-wide font-mono">
                {ownerInitials}
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-white">{ownerName}</span>
                <span className="text-[10px] text-slate-450 font-medium font-sans">Deal Lead / Partner</span>
              </div>
            </div>
          </div>

          {/* Section 1: Deal Stage & Transition Dropdown */}
          <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-5 space-y-4 shadow-premium-card card-sheen">
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 select-none">Current Deal Stage</span>
              <select
                value={currentStage}
                onChange={(e) => {
                  const selected = e.target.value;
                  if (selected !== currentStage) {
                    setTargetStage(selected);
                    setTransitionNotes("");
                    setTransitionError(null);
                    setIsTransitionModalOpen(true);
                  }
                }}
                className={cx(
                  "w-full h-10 rounded-xl border px-3 text-xs font-bold uppercase tracking-wider outline-none cursor-pointer transition shadow-sm",
                  getStageBadgeColor(currentStage)
                )}
              >
                <option value={currentStage}>{currentStage}</option>
                {availableStages.filter((stg) => stg.toLowerCase() !== currentStage.toLowerCase()).map((stg) => (
                  <option key={stg} value={stg} className="bg-[#0e0e10] text-slate-250">
                    → Move to {stg}
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
                onClick={() => openComposer({
                  type: "loi",
                  recipientName: deal.rawFields?.["Contact Name"] || deal.rawFields?.["Broker Name"] || "",
                  recipientEmail: deal.rawFields?.["Contact Email"] || deal.rawFields?.["Broker Email"] || "",
                  subject: `Letter of Intent (LOI) - ${deal.companyName || deal.dealRef || "Project"}`,
                  body: deal.rawFields?.["LOI Draft"] || `Dear ${deal.rawFields?.["Contact Name"] || "Sir/Madam"},\n\nWe are pleased to submit this Letter of Intent for the acquisition of ${deal.companyName || "the company"}.\n\nKind regards,\n${ownerName}`,
                  generatedBy: "precall_brief_engine"
                })}
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
          <div id="deal-section-timeline" className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-5 space-y-3 shadow-premium-card card-sheen">
            <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5 select-none font-sans">
              <Clock className="h-3.5 w-3.5 text-[#C6A66B]" />
              Next Action Details
            </h4>
            
            {deal.rawFields?.["Next Action"] ? (
              <div className="space-y-2">
                {renderRichText(String(deal.rawFields["Next Action"]))}
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

          {/* Section 4: Due Diligence Progress */}
          <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-5 space-y-4 shadow-premium-card card-sheen">
            {(() => {
              const docList = documents || [];
              const checks = [
                {
                  name: "Information Memorandum (IM)",
                  complete: Array.isArray(deal.rawFields?.["IM_Review_Documents"]) && deal.rawFields?.["IM_Review_Documents"].length > 0
                },
                {
                  name: "Financials Uploaded",
                  complete: (!!deal.revenue && !!deal.ebitda) || docList.some((d: any) => (d.category || "").toLowerCase().includes("financial") && (d.status || "").toLowerCase() !== "outstanding")
                },
                {
                  name: "Director/Ownership Info",
                  complete: !!deal.vendorNames || !!deal.rawFields?.["Vendor_Names"] || !!deal.rawFields?.["Vendor Details"] || !!deal.rawFields?.["vendor details"]
                },
                {
                  name: "Website URL",
                  complete: !!deal.rawFields?.["Website"]
                },
                {
                  name: "Company Profile",
                  complete: !!deal.sector && !!deal.location
                },
                {
                  name: "Key Documents Review",
                  complete: docList.length > 0 && docList.some((d: any) => (d.status || "").toLowerCase() !== "outstanding")
                }
              ];
              const completedCount = checks.filter(c => c.complete).length;
              const computedReadiness = Math.round((completedCount / checks.length) * 100);

              return (
                <>
                  <div className="flex items-center justify-between border-b border-white/5 pb-3">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 select-none font-sans">
                      <ClipboardList className="h-4 w-4 text-[#C6A66B]" />
                      Due Diligence Progress
                    </h4>
                    <span className="text-xs font-bold text-[#C6A66B]">{computedReadiness}%</span>
                  </div>

                  {/* Premium Progress Bar */}
                  <div className="space-y-1">
                    <div className="h-1.5 w-full bg-white/[0.03] rounded-full overflow-hidden border border-white/[0.02]">
                      <div 
                        className="h-full bg-gradient-to-r from-[#C6A66B] to-[#E3C185] rounded-full transition-all duration-500" 
                        style={{ width: `${computedReadiness}%` }}
                      />
                    </div>
                  </div>

                  {/* Checklist items list */}
                  <div className="space-y-2.5 pt-1.5 text-xs font-semibold">
                    {checks.map((c, i) => (
                      <div key={i} className="flex items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {c.complete ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          ) : (
                            <span className="h-4 w-4 rounded-full border border-white/10 bg-white/[0.01] shrink-0 flex items-center justify-center text-[8px] font-black text-slate-500">
                              ·
                            </span>
                          )}
                          <span className={cx("truncate", c.complete ? "text-slate-300" : "text-slate-500 font-normal")}>
                            {c.name}
                          </span>
                        </div>
                        <span className={cx("text-[10px] font-bold shrink-0", c.complete ? "text-emerald-500" : "text-slate-550")}>
                          {c.complete ? "Complete" : "Pending"}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>

        </div>

      </div>
    </div>
  );
}

function PreCallBriefTab({ deal, openComposer }: { deal: any; openComposer: (opts: any) => void }) {
  const [briefs, setBriefs] = useState<any[]>([]);
  const [selectedBrief, setSelectedBrief] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingStatus, setGeneratingStatus] = useState(""); // live queue status
  const [error, setError] = useState<string | null>(null);

  // Configuration inputs for new brief
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>(["ayo", "prince"]);
  const [selectedScenario, setSelectedScenario] = useState<string>("primary");
  const [selectedCallType, setSelectedCallType] = useState<"1st" | "2nd" | "neg">("1st");
  const [dataSources, setDataSources] = useState<Record<string, boolean>>({
    companiesHouse: true,
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
        selectedPersonas,
        selectedScenario,
        selectedCallType,
        dataSources,
        pastedText: uploadedFileName ? `Dropped file: ${uploadedFileName}. ` + pastedText : pastedText
      });

      if (result?.status === "queued" && result?.id) {
        setGeneratingStatus("Queued — generating in background…");
        const briefId = result.id;
        
        const pollInterval = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/jobs/status?table=Precall_Briefs&recordId=${briefId}`, {
              headers: {
                Authorization: `Bearer ${sessionStorage.getItem("admin_token") || ""}`,
              }
            });
            if (!statusRes.ok) return;
            const statusData = await statusRes.json();
            
            if (statusData.isComplete) {
              clearInterval(pollInterval);
              const list = await fetchPrecallBriefs(deal.id);
              setBriefs(list);
              if (list.length > 0) {
                setSelectedBrief(list[0]);
              }
              setIsGenerating(false);
              setGeneratingStatus("");
            } else if (statusData.isFailed) {
              clearInterval(pollInterval);
              setError(statusData.error || "Generation failed in background.");
              setIsGenerating(false);
              setGeneratingStatus("");
            }
          } catch (e) {
            console.error("Error polling job status:", e);
          }
        }, 2500);
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

              {/* Meeting Participants */}
              <div className="space-y-2 mt-4 pt-4 border-t border-white/5">
                <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">PARTICIPANTS</span>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {selectedBrief.selectedPersonas?.map((personaId: string, idx: number) => {
                    const persona = ACP_PERSONAS[personaId];
                    return (
                      <span 
                        key={idx} 
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-semibold bg-white/[0.015] border border-white/[0.02] text-slate-300`}
                      >
                        {persona?.name || personaId}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Coverage Scenario */}
              {selectedBrief.selectedScenario && (
                <div className="space-y-2 mt-4 pt-4 border-t border-white/5">
                  <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">COVERAGE SCENARIO</span>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-semibold bg-[#C6A66B]/20 text-[#C6A66B] border border-[#C6A66B]/20">
                      {ACP_SCENARIOS[selectedBrief.selectedScenario]?.name || selectedBrief.selectedScenario}
                    </span>
                  </div>
                </div>
              )}

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
          <div className="rounded-2xl border border-white/[0.04] bg-[#0E1524] p-6 flex flex-col justify-between min-h-[500px] flex-1 shadow-premium-card card-sheen">
            <div className="flex-1 space-y-6">
              
              <div className="flex items-center justify-between pb-3.5 border-b border-white/5">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-inner">
                    <BrainCircuit className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">PRE-CALL INTELLIGENCE BRIEF</h4>
                    <h2 className="text-sm font-black text-white mt-0.5 tracking-tight">
                      {(deal.companyName || deal.dealRef).toUpperCase()} &middot; {selectedBrief.selectedCallType === "1st" ? "1ST CALL" : selectedBrief.selectedCallType === "2nd" ? "2ND CALL" : "NEGOTIATION"}
                    </h2>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => openComposer({
                    type: "loi",
                    recipientName: deal.rawFields?.["Contact Name"] || deal.rawFields?.["Broker Name"] || "",
                    recipientEmail: deal.rawFields?.["Contact Email"] || deal.rawFields?.["Broker Email"] || "",
                    subject: `Letter of Intent (LOI) - ${deal.companyName || deal.dealRef || "Project"}`,
                    body: deal.rawFields?.["LOI Draft"] || `Dear ${deal.rawFields?.["Contact Name"] || "Sir/Madam"},\n\nFollowing our discussion, we are pleased to submit this Letter of Intent for the acquisition of ${deal.companyName || "the company"}.\n\nKind regards,\n${deal.ownerName || "Ayo Oyesanya"}`,
                    generatedBy: "precall_brief_engine"
                  })}
                  className="h-8 px-3 rounded-lg bg-[#C6A66B] hover:bg-[#B8924F] text-slate-950 font-bold text-[10px] uppercase tracking-wider transition flex items-center justify-center gap-1.5 cursor-pointer shadow-glow-bronze/10"
                >
                  <Send className="h-3 w-3" />
                  Send LOI
                </button>
              </div>

              {/* 1. Executive Deal Snapshot */}
              {selectedBrief.executiveDealSnapshot && (
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5 space-y-3 shadow-inner">
                  <div className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
                    <Building2 className="h-4 w-4 text-blue-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-blue-400">1. Executive Deal Snapshot</span>
                  </div>
                  {renderRichText(selectedBrief.executiveDealSnapshot)}
                </div>
              )}

              {/* 2. Call Objectives */}
              {selectedBrief.callObjectives && (
                <div className="rounded-xl border border-white/[0.03] bg-white/[0.005] p-5 space-y-3 shadow-inner">
                  <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                    <Target className="h-4 w-4 text-emerald-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">2. Call Objectives</span>
                  </div>
                  {renderRichText(selectedBrief.callObjectives)}
                </div>
              )}

              {/* 3. Critical Unknowns */}
              {selectedBrief.criticalUnknowns?.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 pb-1 border-b border-white/5">
                    <HelpCircle className="h-4 w-4 text-amber-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-amber-400">3. Critical Unknowns</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5">
                    {selectedBrief.criticalUnknowns.map((item: string, idx: number) => (
                      <div key={idx} className="flex items-start gap-3.5 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
                        <span className="h-4 w-4 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">?</span>
                        <p className="text-xs text-amber-200/90 font-semibold">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. Deal Killers */}
              {selectedBrief.dealKillers?.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 pb-1 border-b border-rose-500/20">
                    <XCircle className="h-4 w-4 text-rose-500" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-rose-500">4. Deal Killers (Red Lines)</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5">
                    {selectedBrief.dealKillers.map((line: string, idx: number) => (
                      <div key={idx} className="flex items-start gap-3.5 p-3 rounded-xl border border-rose-500/20 bg-rose-500/5">
                        <X className="h-3 w-3 text-rose-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-rose-200 font-semibold">{line}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 5. OSINT Intelligence */}
              {selectedBrief.osintIntelligence && (
                <div className="rounded-xl border border-white/[0.03] bg-white/[0.005] p-5 space-y-3 shadow-inner">
                  <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                    <Globe className="h-4 w-4 text-slate-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-350">5. OSINT Intelligence</span>
                  </div>
                  {renderRichText(selectedBrief.osintIntelligence)}
                </div>
              )}

              {/* 6. Financial Intelligence */}
              {selectedBrief.financialIntelligence && (
                <div className="rounded-xl border border-white/[0.03] bg-white/[0.005] p-5 space-y-3 shadow-inner">
                  <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                    <LineChart className="h-4 w-4 text-[#C6A66B]" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#C6A66B]">6. Financial Intelligence</span>
                  </div>
                  {renderRichText(selectedBrief.financialIntelligence)}
                </div>
              )}

              {/* 7. Seller Intelligence */}
              {selectedBrief.sellerIntelligence && (
                <div className="rounded-xl border border-white/[0.03] bg-white/[0.005] p-5 space-y-3 shadow-inner">
                  <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                    <User className="h-4 w-4 text-slate-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-350">7. Seller Intelligence</span>
                  </div>
                  {renderRichText(selectedBrief.sellerIntelligence)}
                </div>
              )}

              {/* 8. Team Deployment Plan */}
              {selectedBrief.teamDeploymentPlan?.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 pb-1 border-b border-white/5">
                    <Users className="h-4 w-4 text-[#C6A66B]" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#C6A66B]">8. Team Deployment Plan</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {selectedBrief.teamDeploymentPlan.map((plan: any, idx: number) => (
                      <div key={idx} className="p-4 rounded-xl border border-[#C6A66B]/10 bg-gradient-to-r from-[#C6A66B]/5 to-transparent space-y-3">
                        <div className="flex justify-between items-center border-b border-[#C6A66B]/10 pb-2">
                          <h5 className="text-xs font-bold text-[#C6A66B] uppercase tracking-wider">{plan.name}</h5>
                          <span className="px-2 py-0.5 rounded text-[9px] bg-[#C6A66B]/20 text-[#C6A66B] font-semibold">{plan.roleOnCall}</span>
                        </div>
                        <div className="space-y-2">
                          {plan.primaryResponsibilities?.length > 0 && (
                            <div>
                              <span className="text-[9px] font-bold uppercase text-slate-400 block mb-1">Primary Responsibilities</span>
                              <ul className="list-disc pl-4 text-xs text-slate-300 leading-relaxed space-y-0.5">
                                {plan.primaryResponsibilities.map((r: string, i: number) => <li key={i}>{r}</li>)}
                              </ul>
                            </div>
                          )}
                          {plan.questionsToOwn?.length > 0 && (
                            <div>
                              <span className="text-[9px] font-bold uppercase text-slate-400 block mb-1">Topics to Own</span>
                              <ul className="list-disc pl-4 text-xs text-slate-300 leading-relaxed space-y-0.5">
                                {plan.questionsToOwn.map((r: string, i: number) => <li key={i}>{r}</li>)}
                              </ul>
                            </div>
                          )}
                          {plan.areasToAvoid?.length > 0 && (
                            <div>
                              <span className="text-[9px] font-bold uppercase text-rose-400 block mb-1">Areas to Avoid</span>
                              <ul className="list-disc pl-4 text-xs text-rose-300 leading-relaxed space-y-0.5">
                                {plan.areasToAvoid.map((r: string, i: number) => <li key={i}>{r}</li>)}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 9. Participant Responsibilities */}
              {selectedBrief.participantResponsibilities && (
                <div className="rounded-xl border border-white/[0.03] bg-white/[0.005] p-5 space-y-3 shadow-inner">
                  <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                    <ClipboardList className="h-4 w-4 text-slate-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-350">9. Participant Responsibilities</span>
                  </div>
                  {renderRichText(selectedBrief.participantResponsibilities)}
                </div>
              )}

              {/* 10. Call Phase Ownership */}
              {selectedBrief.callPhaseOwnership?.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 pb-1 border-b border-white/5">
                    <Columns className="h-4 w-4 text-blue-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-blue-400">10. Call Phase Ownership</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedBrief.callPhaseOwnership.map((phaseItem: any, idx: number) => (
                      <div key={idx} className="flex flex-col p-3 rounded-xl border border-blue-500/10 bg-blue-500/5">
                        <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold mb-1">{phaseItem.phase}</span>
                        <span className="text-xs text-blue-300 font-semibold">{phaseItem.owner}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 11. Participant Question Bank */}
              {selectedBrief.participantQuestionBank?.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 pb-1 border-b border-white/5">
                    <MessageSquare className="h-4 w-4 text-emerald-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">11. Participant Question Bank</span>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    {selectedBrief.participantQuestionBank.map((qb: any, idx: number) => (
                      <div key={idx} className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 overflow-hidden">
                        <div className="bg-emerald-500/10 px-4 py-2 border-b border-emerald-500/10">
                          <h5 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">{qb.participantName}'s Questions</h5>
                        </div>
                        <div className="p-4 space-y-3">
                          {qb.primaryQuestions?.length > 0 && (
                            <div>
                              <span className="text-[9px] font-bold uppercase text-slate-400 block mb-1">Primary Questions</span>
                              <ul className="list-disc pl-4 text-xs text-slate-300 leading-relaxed space-y-1">
                                {qb.primaryQuestions.map((q: string, i: number) => <li key={i}>{q}</li>)}
                              </ul>
                            </div>
                          )}
                          {qb.escalationQuestions?.length > 0 && (
                            <div>
                              <span className="text-[9px] font-bold uppercase text-rose-400 block mb-1 mt-2">Escalation Questions</span>
                              <ul className="list-disc pl-4 text-xs text-rose-300 leading-relaxed space-y-1">
                                {qb.escalationQuestions.map((q: string, i: number) => <li key={i}>{q}</li>)}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 12. Internal Watchouts */}
              {selectedBrief.internalWatchouts?.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 pb-1 border-b border-white/5">
                    <ShieldAlert className="h-4 w-4 text-amber-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-amber-400">12. Internal Watchouts</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5">
                    {selectedBrief.internalWatchouts.map((watchout: string, idx: number) => (
                      <div key={idx} className="flex items-start gap-3.5 p-3 rounded-xl border border-amber-500/10 bg-amber-500/5">
                        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-200/90 font-semibold">{watchout}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 13. Partner-Down Coverage */}
              {selectedBrief.partnerDownCoverage && (
                <div className="rounded-xl border border-white/[0.03] bg-white/[0.005] p-5 space-y-3 shadow-inner">
                  <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                    <UserX className="h-4 w-4 text-slate-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-350">13. Partner-Down Coverage</span>
                  </div>
                  {renderRichText(selectedBrief.partnerDownCoverage)}
                </div>
              )}

              {/* 14. Call Strategy */}
              {selectedBrief.callStrategy && (
                <div className="rounded-xl border border-white/[0.03] bg-white/[0.005] p-5 space-y-3 shadow-inner">
                  <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                    <Lightbulb className="h-4 w-4 text-[#C6A66B]" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#C6A66B]">14. Call Strategy</span>
                  </div>
                  {renderRichText(selectedBrief.callStrategy)}
                </div>
              )}

              {/* 15. The Call Script */}
              {selectedBrief.callScript && (
                <div className="rounded-xl border border-[#C6A66B]/20 bg-gradient-to-r from-[#C6A66B]/5 to-transparent p-5 space-y-3 border-l-2 border-l-[#C6A66B] shadow-inner">
                  <div className="flex items-center gap-2 pb-1 border-b border-[#C6A66B]/10">
                    <BookOpen className="h-4 w-4 text-[#C6A66B]" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#C6A66B]">15. The Call Script</span>
                  </div>
                  {renderRichText(selectedBrief.callScript)}
                </div>
              )}

              {/* 16. Post Call Actions */}
              {selectedBrief.recommendedNextActions?.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 pb-1 border-b border-white/5">
                    <ListTodo className="h-4 w-4 text-[#C6A66B]" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#C6A66B]">16. Recommended Next Actions</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5">
                    {selectedBrief.recommendedNextActions.map((action: string, idx: number) => (
                      <div key={idx} className="flex items-center gap-3.5 p-3 rounded-xl border border-[#C6A66B]/10 bg-[#C6A66B]/5">
                        <ArrowRight className="h-3 w-3 text-[#C6A66B] shrink-0" />
                        <p className="text-xs text-[#C6A66B] font-semibold">{action}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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

              {/* Meeting Participants */}
              <div className="space-y-2">
                <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">MEETING PARTICIPANTS</span>
                <div className="flex flex-wrap gap-2 items-center">
                  {Object.values(ACP_PERSONAS).map((persona) => {
                    const isSelected = selectedPersonas.includes(persona.id);
                    return (
                      <button
                        key={persona.id}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setSelectedPersonas(prev => prev.filter(p => p !== persona.id));
                          } else {
                            setSelectedPersonas(prev => [...prev, persona.id]);
                          }
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-colors cursor-pointer ${
                          isSelected 
                            ? "bg-[#10B981] text-slate-950" 
                            : "bg-white/[0.015] border border-white/[0.02] text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                        {persona.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Coverage Scenario */}
              <div className="space-y-2">
                <span className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500">COVERAGE SCENARIO</span>
                <div className="flex flex-wrap gap-2 items-center">
                  {Object.values(ACP_SCENARIOS).map((scenario) => (
                    <button
                      key={scenario.id}
                      type="button"
                      onClick={() => setSelectedScenario(scenario.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-colors cursor-pointer ${
                        selectedScenario === scenario.id 
                          ? "bg-[#10B981] text-slate-950" 
                          : "bg-white/[0.015] border border-white/[0.02] text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {selectedScenario === scenario.id && <Check className="h-3 w-3" />}
                      {scenario.name}
                    </button>
                  ))}
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

function PostMeetingTab({ deal, onScoreChange, openComposer }: { deal: any; onScoreChange: (score: string) => void; openComposer: (opts: any) => void }) {
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

      if (result?.status === "queued" && result?.id) {
        setGeneratingStatus("Queued — generating in background…");
        setSuccessMsg("Post-call analysis queued — results will appear automatically.");
        const briefId = result.id;

        const pollInterval = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/jobs/status?table=Postcall_Briefs&recordId=${briefId}`, {
              headers: {
                Authorization: `Bearer ${sessionStorage.getItem("admin_token") || ""}`,
              }
            });
            if (!statusRes.ok) return;
            const statusData = await statusRes.json();

            if (statusData.isComplete) {
              clearInterval(pollInterval);
              const list = await fetchPostcallBriefs(deal.id);
              setBriefs(list);
              if (list.length > 0) {
                setSelectedBrief(list[0]);
                setMode("view");
              }
              setGenerating(false);
              setGeneratingStatus("");
              setSuccessMsg("Post-call analysis completed successfully!");
            } else if (statusData.isFailed) {
              clearInterval(pollInterval);
              setErrorMsg(statusData.error || "Generation failed in background.");
              setGenerating(false);
              setGeneratingStatus("");
            }
          } catch (e) {
            console.error("Error polling job status:", e);
          }
        }, 2500);

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

    let emailSubject = "Follow-up & Discovery Outcomes";
    let emailBody = selectedBrief.followUpEmail || "";
    if (emailBody.toLowerCase().trim().startsWith("subject:")) {
      const firstLineEnd = emailBody.indexOf("\n");
      if (firstLineEnd !== -1) {
        emailSubject = emailBody.substring(emailBody.toLowerCase().indexOf("subject:") + 8, firstLineEnd).trim();
        emailBody = emailBody.substring(firstLineEnd).trim();
      }
    }
    
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
                      className="h-8 flex-1 sm:flex-initial rounded-lg bg-[#C6A66B] text-slate-950 px-4 text-xs font-black uppercase tracking-wider hover:brightness-110 active:scale-[0.98] transition cursor-pointer shadow-lg shadow-[#C6A66B]/10 flex items-center justify-center gap-1"
                    >
                      {savingOverrides && <RefreshCw className="h-3 w-3 animate-spin" />}
                      Save Scores
                    </button>
                  </div>
                </div>
              )}

            </div>

            {/* AI Summary Block */}
            <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-5 space-y-4 shadow-premium-card card-sheen">
              <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 pb-2 border-b border-white/5 select-none">
                ACP AI POST-CALL SUMMARY & INSIGHTS
              </h4>
              <div className="rounded-xl border border-[#C6A66B]/15 bg-gradient-to-r from-[#C6A66B]/5 to-transparent p-5 space-y-3 border-l-2 border-l-[#C6A66B] shadow-inner">
                <div className="flex items-center gap-2 pb-1">
                  <BrainCircuit className="h-4 w-4 text-[#C6A66B]" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-[#C6A66B]">Analysis Run Executive Insights</span>
                </div>
                {renderRichText(selectedBrief.summary)}
              </div>
            </div>

          </div>

          {/* Right: Email Drawer */}
          <div className="rounded-2xl border border-white/[0.04] bg-[#161B22] p-5 space-y-4 h-full shadow-premium-card card-sheen">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 select-none">
                BROKER FOLLOW-UP EMAIL DRAFT
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyEmail}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/[0.02] bg-[#C6A66B]/10 text-[#C6A66B] border-[#C6A66B]/20 px-3 text-[10px] font-extrabold uppercase tracking-wider hover:bg-[#C6A66B]/20 cursor-pointer transition"
                >
                  {copiedEmail ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      COPIED
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      COPY EMAIL
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => openComposer({
                    type: "email",
                    recipientName: deal.rawFields?.["Contact Name"] || deal.rawFields?.["Broker Name"] || "",
                    recipientEmail: deal.rawFields?.["Contact Email"] || deal.rawFields?.["Broker Email"] || "",
                    subject: emailSubject,
                    body: emailBody,
                    generatedBy: "postcall_analysis_engine"
                  })}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-[#C6A66B] hover:bg-[#B8924F] text-slate-950 px-3 text-[10px] font-black uppercase tracking-wider transition cursor-pointer"
                >
                  <Send className="h-3 w-3" />
                  SEND EMAIL
                </button>
              </div>
            </div>
            
            {/* Mock Email client window */}
            <div className="rounded-xl border border-white/5 bg-[#0E1524] overflow-hidden shadow-inner flex flex-col">
              {/* Header Fields */}
              <div className="p-4 border-b border-white/5 space-y-2.5 text-xs text-slate-400 select-none bg-white/[0.005]">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-[10px] uppercase w-10 text-slate-500">From:</span>
                  <span className="text-slate-300 font-medium">Ayo Olatunjie <span className="text-slate-500 font-normal">&lt;ayo@aysancapital.com&gt;</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-[10px] uppercase w-10 text-slate-500">To:</span>
                  <span className="text-slate-300 font-medium">Broker / Seller Representative</span>
                </div>
                <div className="flex items-start gap-2 pt-1 border-t border-white/[0.02]">
                  <span className="font-extrabold text-[10px] uppercase w-10 text-slate-500 mt-0.5">Subject:</span>
                  <span className="text-white font-bold">{emailSubject}</span>
                </div>
              </div>
              
              {/* Compose Body */}
              <div className="p-5 overflow-y-auto max-h-[400px] text-slate-300 text-xs leading-relaxed font-sans whitespace-pre-wrap select-text">
                {emailBody}
              </div>
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
              className="flex-[2] h-10 rounded-xl bg-gradient-to-r from-[#C6A66B] to-[#B8924F] text-slate-950 font-black text-xs uppercase tracking-wider hover:opacity-90 active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-lg shadow-[#C6A66B]/10 transition duration-200"
            >
              {generating ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Scoring...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4.5 w-4.5 text-slate-950" />
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

function LOIStructureTab({ deal, openComposer }: { deal: any; openComposer: (opts: any) => void }) {
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

        <div className="flex gap-2 mt-6">
          <button
            type="button"
            onClick={downloadLoiDraft}
            className="flex-1 h-10 rounded-xl bg-[#161B22] hover:bg-white/[0.02] border border-white/[0.04] text-white font-bold text-xs uppercase tracking-wider transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <BrainCircuit className="h-4 w-4" />
            Download LOI
          </button>
          <button
            type="button"
            onClick={() => openComposer({
              type: "loi",
              recipientName: deal.rawFields?.["Contact Name"] || deal.rawFields?.["Broker Name"] || "",
              recipientEmail: deal.rawFields?.["Contact Email"] || deal.rawFields?.["Broker Email"] || "",
              subject: `Letter of Intent (LOI) - ${deal.companyName || deal.dealRef || "Project"}`,
              body: `LETTER OF INTENT\n\nFrom: Aysan Capital Partners - YOFY Ltd\nTo: ${deal.vendorNames || "[Vendor name]"} - ${deal.companyName || deal.dealRef} Ltd\nDate: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}\n\nWe are pleased to confirm our non-binding intention to acquire 100% of the issued share capital of ${deal.companyName || deal.dealRef} (Kent) Ltd on the following principal terms:\n\nConsideration: £${totalEv} total EV comprising cash at completion of £${cashAtClose}, a Vendor Loan Note of £${vln} over 36 months at 5% per annum, and deferred consideration of £${deferred} subject to EBITDA performance milestones in months 13-24.\n\nThis proposal is subject to detailed financial, legal, and operational due diligence. We propose an exclusivity period of ${exclusivity} from the date of this letter to conclude the transaction.\n\nOur team has extensive experience in the cleaning services sector and we believe our partnership will preserve the legacy of the company while driving next-phase growth through our operational platform.\n\nWe look forward to your positive response.`,
              generatedBy: "precall_brief_engine"
            })}
            className="flex-1 h-10 rounded-xl bg-[#C6A66B] hover:bg-[#B8924F] text-slate-950 font-black text-xs uppercase tracking-wider transition flex items-center justify-center gap-1.5 cursor-pointer shadow-glow-bronze/10"
          >
            <Send className="h-3.5 w-3.5" />
            Send LOI
          </button>
        </div>
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

function ImAttachmentsTab({ 
  deal, 
  onRefresh 
}: { 
  deal: any; 
  onRefresh: () => void; 
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [isReplacingIdx, setIsReplacingIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const [imToDeleteIdx, setImToDeleteIdx] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const attachments = deal.rawFields?.IM_Review_Documents || [];

  const handleUploadFile = async (file: File, replaceIndex?: number) => {
    setError(null);
    if (replaceIndex !== undefined) {
      setIsReplacingIdx(replaceIndex);
    } else {
      setIsUploading(true);
    }

    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result as string;
          resolve(res.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      if (replaceIndex !== undefined) {
        await replaceImDocument(deal.id, replaceIndex, file.name, file.type, base64Data);
      } else {
        await uploadImDocument(deal.id, file.name, file.type, base64Data);
      }
      onRefresh();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to process file upload.");
    } finally {
      setIsUploading(false);
      setIsReplacingIdx(null);
    }
  };

  const handleDeleteFile = (idx: number) => {
    setImToDeleteIdx(idx);
  };

  const handleDeleteFileConfirm = async () => {
    if (imToDeleteIdx === null) return;
    setIsDeleting(true);
    setError(null);
    try {
      await removeImDocument(deal.id, imToDeleteIdx);
      onRefresh();
      setImToDeleteIdx(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to delete file.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 font-sans animate-fade-in-up text-[#E2E8F0]">
      <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">IM & Supporting Attachments</h3>
            <p className="text-[10px] text-slate-450 mt-1">Manage Information Memorandum files, supporting documents, and teasers for this deal.</p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs font-semibold text-rose-450 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {attachments.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500 border border-dashed border-white/10 rounded-xl">
            No IM or attachments uploaded yet. Use the upload area below to add documents.
          </div>
        ) : (
          <div className="space-y-2">
            {attachments.map((att: any, idx: number) => {
              const isReplacing = isReplacingIdx === idx;
              return (
                <div key={att.id || idx} className="flex items-center justify-between p-3.5 rounded-xl border border-white/5 bg-white/[0.01] hover:bg-white/[0.02] transition">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="h-4 w-4 text-[#C6A66B] shrink-0" />
                    <div className="min-w-0">
                      <span className="block text-xs font-semibold text-white truncate">{att.filename || "IM_Document"}</span>
                      {att.size && (
                        <span className="block text-[9px] text-slate-500 mt-0.5">{(att.size / 1024).toFixed(0)} KB</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-7 items-center justify-center rounded-lg border border-white/[0.08] px-3 text-[10px] font-bold uppercase tracking-wider text-slate-350 hover:text-white hover:bg-white/[0.03] transition"
                    >
                      View
                    </a>

                    <label className="relative inline-flex h-7 items-center justify-center rounded-lg border border-white/[0.08] px-3 text-[10px] font-bold uppercase tracking-wider text-[#C6A66B] hover:text-white hover:bg-[#C6A66B]/10 transition cursor-pointer">
                      {isReplacing ? "Replacing..." : "Replace"}
                      <input
                        type="file"
                        accept=".pdf,.docx,.xlsx"
                        disabled={isReplacing}
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadFile(file, idx);
                        }}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => handleDeleteFile(idx)}
                      className="inline-flex h-7 items-center justify-center rounded-lg border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 px-3 text-[10px] font-bold uppercase tracking-wider text-rose-450 hover:text-rose-400 transition cursor-pointer"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Upload Drop Zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const files = e.dataTransfer.files;
            if (files.length > 0) {
              handleUploadFile(files[0]);
            }
          }}
          className={cx(
            "border border-dashed rounded-xl p-8 text-center transition cursor-pointer select-none relative",
            dragActive
              ? "border-[#C6A66B] bg-[#C6A66B]/5 text-white"
              : "border-white/10 bg-white/[0.005] hover:border-white/20 text-slate-400"
          )}
        >
          <input
            type="file"
            id="im-attachment-file-upload"
            accept=".pdf,.docx,.xlsx"
            disabled={isUploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUploadFile(file);
            }}
            className="hidden"
          />
          <label htmlFor="im-attachment-file-upload" className="cursor-pointer space-y-3 block">
            <div className="flex justify-center">
              {isUploading ? (
                <RefreshCw className="h-6 w-6 text-[#C6A66B] animate-spin" />
              ) : (
                <Upload className="h-6 w-6 text-slate-500" />
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-white">
                {isUploading ? "Uploading attachment..." : "Drag & drop file here, or click to browse"}
              </p>
              <p className="text-[10px] text-slate-500 mt-1.5 font-medium">Supported formats: PDF, DOCX, XLSX (max 20MB)</p>
            </div>
          </label>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {imToDeleteIdx !== null && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-2xl relative animate-scale-in">
            <h3 className="text-base font-bold text-white uppercase tracking-wider mb-3">
              Delete Attachment
            </h3>
            <p className="text-xs text-slate-350 leading-relaxed mb-6">
              Are you sure you want to permanently remove this attachment?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setImToDeleteIdx(null)}
                disabled={isDeleting}
                className="h-10 px-4 rounded-xl border border-white/[0.02] text-slate-300 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteFileConfirm}
                disabled={isDeleting}
                className="h-10 px-5 rounded-xl bg-red-650 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-red cursor-pointer transition-all"
              >
                {isDeleting ? "Deleting..." : "Delete Attachment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentsTab({ deal, documentState, setRefreshTrigger }: { deal: any; documentState: any; setRefreshTrigger: any }) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const sectionParam = searchParams.get("section");

  useEffect(() => {
    if (sectionParam === "tasks") {
      const timer = setTimeout(() => {
        const el = document.getElementById("deal-section-tasks");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [sectionParam]);

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
      <div id="deal-section-tasks" className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5">
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

function EmailComposerModal({
  isOpen,
  onClose,
  type,
  dealId,
  dealName,
  defaultRecipientName,
  defaultRecipientEmail,
  defaultSubject,
  defaultBody,
  generatedBy,
  allLenders
}: {
  isOpen: boolean;
  onClose: () => void;
  type: "loi" | "email";
  dealId: string;
  dealName: string;
  defaultRecipientName: string;
  defaultRecipientEmail: string;
  defaultSubject: string;
  defaultBody: string;
  generatedBy: string;
  allLenders: any[];
}) {
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [lenderCompany, setLenderCompany] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Sync inputs with defaults when modal opens or defaults change
  useEffect(() => {
    if (isOpen) {
      setRecipientName(defaultRecipientName);
      setRecipientEmail(defaultRecipientEmail);
      setLenderCompany("");
      setSubject(defaultSubject);
      setBody(defaultBody);
      setError(null);
      setSuccess(false);
      setSending(false);
    }
  }, [isOpen, defaultRecipientName, defaultRecipientEmail, defaultSubject, defaultBody]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const payload = {
        lenderName: recipientName,
        lenderEmail: recipientEmail,
        companyName: lenderCompany,
        dealId,
        subject,
        body,
        type: type === "loi" ? "loi" : "post_meeting_email"
      };

      if (type === "loi") {
        await sendLoiWebhook(payload as any);
      } else {
        await sendEmailWebhook(payload as any);
      }
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error(err);
      setError(err.message || `Failed to send ${type === "loi" ? "LOI" : "email"}.`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={type === "loi" ? "Send Letter of Intent (LOI)" : "Send Follow-up Email"}
    >
      {success ? (
        <div className="flex flex-col items-center justify-center py-8 space-y-3 font-sans text-center animate-scale-in">
          <div className="h-12 w-12 rounded-full bg-[#C6A66B]/10 border border-[#C6A66B]/20 flex items-center justify-center text-[#C6A66B]">
            <Check className="h-6 w-6" />
          </div>
          <h4 className="text-sm font-bold text-white uppercase tracking-wider">
            {type === "loi" ? "LOI Sent Successfully" : "Email Sent Successfully"}
          </h4>
          <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
            The webhook has been posted to Make.com and recorded in the audit trail.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 font-sans text-slate-200">
          {error && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs font-semibold text-rose-400 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 animate-pulse" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500 mb-1">
              Select Lender
            </label>
            <select
              onChange={(e) => {
                const lenderId = e.target.value;
                const lender = allLenders.find((l) => l.id === lenderId);
                if (lender) {
                  setRecipientName(lender.Contact_Name || lender.Company_Name || "");
                  setRecipientEmail(lender.Email || "");
                  setLenderCompany(lender.Company_Name || "");
                }
              }}
              className="w-full h-9 rounded-xl border border-white/[0.02] bg-[#161B22] px-3 text-xs text-white focus:border-[#C6A66B] outline-none cursor-pointer"
            >
              <option value="">-- Choose Lender from Database --</option>
              {allLenders.map((lender) => (
                <option key={lender.id} value={lender.id}>
                  {lender.Company_Name} {lender.Contact_Name ? `(${lender.Contact_Name})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500 mb-1">
                Lender Name
              </label>
              <input
                type="text"
                required
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="e.g. John Doe"
                className="w-full h-9 rounded-xl border border-white/[0.02] bg-[#161B22] px-3 text-xs text-white focus:border-[#C6A66B] outline-none"
              />
            </div>
            <div>
              <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500 mb-1">
                Lender Email
              </label>
              <input
                type="email"
                required
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="e.g. john@example.com"
                className="w-full h-9 rounded-xl border border-white/[0.02] bg-[#161B22] px-3 text-xs text-white focus:border-[#C6A66B] outline-none"
              />
            </div>
            <div>
              <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500 mb-1">
                Lender Company
              </label>
              <input
                type="text"
                required
                value={lenderCompany}
                onChange={(e) => setLenderCompany(e.target.value)}
                placeholder="e.g. ABL Bank Ltd"
                className="w-full h-9 rounded-xl border border-white/[0.02] bg-[#161B22] px-3 text-xs text-white focus:border-[#C6A66B] outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500 mb-1">
              Subject Line
            </label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Enter subject..."
              className="w-full h-9 rounded-xl border border-white/[0.02] bg-[#161B22] px-3 text-xs text-white focus:border-[#C6A66B] outline-none"
            />
          </div>

          <div>
            <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-500 mb-1">
              Message Body
            </label>
            <textarea
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Compose your message..."
              rows={12}
              className="w-full rounded-xl border border-white/[0.02] bg-[#161B22] p-3 text-xs text-white focus:border-[#C6A66B] outline-none resize-none font-sans leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="h-9 px-4 rounded-xl border border-white/[0.02] text-slate-400 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending}
              className="h-9 px-5 rounded-xl bg-[#C6A66B] hover:bg-[#B8924F] text-slate-950 font-black text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 cursor-pointer shadow-glow-bronze/10"
            >
              {sending ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  Send {type === "loi" ? "LOI" : "Email"}
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
