import { ArrowLeft, ClipboardList, FileText, Send, ShieldCheck, Eye, History, Shield, Lock, UserPlus, Check, X, KeyRound, Copy, MessageSquare } from "lucide-react";
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

type TabId = "cover" | "documents" | "submissions" | "chat";

const tabs: Array<{ id: TabId; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "cover", label: "Cover Sheet", icon: FileText },
  { id: "documents", label: "Document Checklist", icon: ClipboardList },
  { id: "submissions", label: "Submission Log", icon: Send },
  { id: "chat", label: "Lender Chat", icon: MessageSquare },
];

export function DealDetailPage() {
  const { ref } = useParams();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>("cover");
  const decodedRef = useMemo(() => (ref ? decodeURIComponent(ref) : ""), [ref]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const dealState = useDeal(decodedRef);
  const documentState = useDealDocuments(decodedRef, refreshTrigger);
  const submissionState = useSubmissionLog(decodedRef);
  const isLoading = dealState.isLoading || documentState.isLoading || submissionState.isLoading;
  const error = dealState.error ?? documentState.error ?? submissionState.error;

  // Add Lender Modal states
  const [isAddLenderOpen, setIsAddLenderOpen] = useState(false);
  const [allLenders, setAllLenders] = useState<any[]>([]);
  const [isLoadingLenders, setIsLoadingLenders] = useState(false);
  const [selectedLenderId, setSelectedLenderId] = useState("");
  const [assignmentSuccess, setAssignmentSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [activeChatLenderId, setActiveChatLenderId] = useState<string>("");

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
    if (tabParam && ["cover", "documents", "submissions", "chat"].includes(tabParam)) {
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

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  if (!dealState.data) {
    return (
      <div className="animate-fade-in-up">
        <BackLink />
        <PageHeader title="Deal not found" eyebrow={decodedRef} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <BackLink />
        <PageHeader title={dealState.data.companyName || dealState.data.dealRef} eyebrow={`Deal Details / ${dealState.data.dealRef}`}>
          <button
            onClick={openAddLenderModal}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 text-xs font-bold uppercase tracking-wider text-slate-300 shadow-sm transition-all duration-300 hover:border-acp-bronze hover:text-white hover:bg-white/10 hover:shadow-glow-blue transform hover:-translate-y-0.5 cursor-pointer"
          >
            <UserPlus className="h-4 w-4 text-acp-bronze" aria-hidden="true" />
            Add Lender
          </button>
        </PageHeader>
      </div>

      {/* Main Two-Column Layout */}
      <div className={cx(
        "grid gap-6 items-start animate-fade-in-up",
        (activeTab === "documents" || activeTab === "chat") ? "grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_360px]"
      )}>
        {/* Workspace Column */}
        <div className="space-y-5 w-full min-w-0">
          <div className="flex gap-1.5 overflow-x-auto rounded-xl border border-white/[0.06] bg-[#0D0D0E] p-1.5 shadow-inner backdrop-blur-md">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={cx(
                  "inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-xs font-extrabold uppercase tracking-wider transition-all duration-300 flex-1 sm:flex-initial",
                  activeTab === tab.id
                    ? "bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-white shadow-md shadow-glow-purple-card"
                    : "text-slate-400 hover:bg-white/5 hover:text-white",
                )}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <tab.icon className="h-3.5 w-3.5" aria-hidden="true" />
                {tab.label}
              </button>
            ))}
          </div>

          <div className="pt-2">
            {activeTab === "cover" ? <CoverSheet deal={dealState.data} audience="internal" /> : null}
            {activeTab === "documents" ? (
              <DocumentChecklist
                documents={documentState.data ?? []}
                audience="internal"
                dealId={dealState.data.id}
                onRefresh={() => setRefreshTrigger((prev) => prev + 1)}
              />
            ) : null}
            {activeTab === "submissions" ? <SubmissionTimeline entries={submissionState.data ?? []} /> : null}
            {activeTab === "chat" ? (
              <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6 items-start">
                {/* Lenders List */}
                <div className="rounded-2xl border border-white/[0.06] bg-[#0D0D0E] p-4 space-y-4">
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
                                ? "bg-acp-bronze/10 border-acp-bronze text-white shadow-glow-bronze/5"
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
                      dealId={dealState.data.id}
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
            ) : null}
          </div>
        </div>

        {/* VDR Audit Activity Column */}
        {(activeTab !== "documents" && activeTab !== "chat") && (
          <aside className="rounded-2xl border border-white/[0.06] bg-[#0D0D0E] backdrop-blur-md p-6 shadow-premium-card space-y-6 card-sheen">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-350 select-none">
                <History className="h-4 w-4 text-acp-bronze" />
                Recent Activity Log
              </div>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            </div>

            {/* Room stats */}
            <div className="grid grid-cols-2 gap-3 bg-white/5 border border-white/[0.06] rounded-xl p-3 text-center">
              <div>
                <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Files</span>
                <span className="block text-lg font-display italic text-white font-normal mt-0.5">
                  {documentState.data?.length ?? 0}
                </span>
              </div>
              <div>
                <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Total Views</span>
                <span className="block text-lg font-display italic text-white font-normal mt-0.5">142</span>
              </div>
            </div>

            {/* Access Logs */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400">Recent Activity</h4>
              <div className="space-y-3.5">
                <ActivityItem 
                  icon={<Eye className="h-3.5 w-3.5 text-acp-bronze" />}
                  action="Financial model viewed"
                  time="3 hours ago"
                  user="External Reviewer"
                />
                <ActivityItem 
                  icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />}
                  action="Room unlocked"
                  time="6 hours ago"
                  user="Lender Agent"
                />
                <ActivityItem 
                  icon={<Lock className="h-3.5 w-3.5 text-acp-bronze" />}
                  action="Security check completed"
                  time="1 day ago"
                  user="System"
                />
                <ActivityItem 
                  icon={<FileText className="h-3.5 w-3.5 text-indigo-400" />}
                  action="3 documents uploaded"
                  time="2 days ago"
                  user="System Sync"
                />
              </div>
            </div>

            {/* Security Compliance Block */}
            <div className="rounded-xl border border-white/8 bg-acp-navy p-4 text-white relative overflow-hidden shadow-inner">
              <div className="absolute -right-8 -bottom-8 h-20 w-20 rounded-full bg-white/[0.02] blur-xl pointer-events-none" />
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-acp-bronze animate-pulse-glow" />
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-white">Security Certified</span>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-400 font-medium">
                Document storage conforms to security guidelines. History logging is active.
              </p>
            </div>
          </aside>
        )}
      </div>

      {/* Add Lender Modal Overlay */}
      {isAddLenderOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0D0D0E] p-6 shadow-2xl relative animate-scale-in">
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
                    className="text-[10px] font-black uppercase tracking-wider text-acp-bronze hover:underline cursor-pointer"
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

function ActivityItem({ icon, action, time, user }: { icon: React.ReactNode; action: string; time: string; user: string }) {
  return (
    <div className="flex items-start gap-3 text-xs">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 border border-white/[0.06] shadow-inner">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-slate-200 leading-snug">{action}</p>
        <p className="text-[10px] text-slate-400 font-medium mt-0.5">{time} • by {user}</p>
      </div>
    </div>
  );
}
