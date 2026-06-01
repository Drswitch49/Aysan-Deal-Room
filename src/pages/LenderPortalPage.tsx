import { useState, useEffect, useMemo } from "react";
import { useParams, Navigate, useSearchParams } from "react-router-dom";
import { 
  Building2, Database, ShieldCheck, LockKeyhole, Landmark, 
  LogOut, Files, History, Menu, X, MessageSquare
} from "lucide-react";
import { 
  loginLender, fetchLenderDeals, fetchLenderDocuments, fetchLenderSubmissions 
} from "../api/lender";
import { CoverSheet } from "../components/deals/CoverSheet";
import { DocumentChecklist } from "../components/deals/DocumentChecklist";
import { SubmissionTimeline } from "../components/deals/SubmissionTimeline";
import { DealChat } from "../components/deals/DealChat";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { EmptyState } from "../components/ui/EmptyState";
import { ChatNotificationWatcher } from "../components/ui/ChatNotificationWatcher";
import type { PipelineDeal, DealDocument, SubmissionLogEntry } from "../types/deal";
import { cx } from "../utils/cx";

type LenderTabId = "overview" | "chat";

const lenderTabs: Array<{ id: LenderTabId; label: string; icon: any }> = [
  { id: "overview", label: "Deal Room Overview", icon: Files },
  { id: "chat", label: "Message Admin", icon: MessageSquare }
];

export function LenderPortalPage() {
  const { portalSlug } = useParams<{ portalSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  // Loaded data
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [documents, setDocuments] = useState<DealDocument[]>([]);
  const [logs, setLogs] = useState<SubmissionLogEntry[]>([]);
  const [selectedDeal, setSelectedDeal] = useState<PipelineDeal | null>(null);
  const [lenderProfile, setLenderProfile] = useState<any>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<LenderTabId>("overview");

  // Effect to select active deal and tab from URL query params (e.g. notifications deep link)
  useEffect(() => {
    const dealIdParam = searchParams.get("dealId");
    const tabParam = searchParams.get("tab") as LenderTabId | null;
    if (dealIdParam && deals.length > 0) {
      const match = deals.find(d => d.id === dealIdParam || d.dealRef === dealIdParam);
      if (match) {
        setSelectedDeal(match);
      }
    }
    if (tabParam && ["overview", "chat"].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams, deals]);

  useEffect(() => {
    if (!portalSlug) return;
    const sessionStr = sessionStorage.getItem(`lender_session_${portalSlug}`);
    if (sessionStr) {
      try {
        const session = JSON.parse(sessionStr);
        setLenderProfile(session.profile);
        setIsAuthorized(true);
      } catch {
        sessionStorage.removeItem(`lender_session_${portalSlug}`);
      }
    }
  }, [portalSlug]);

  useEffect(() => {
    if (isAuthorized && portalSlug) {
      loadPortalData();
    }
  }, [isAuthorized, portalSlug]);

  async function loadPortalData() {
    if (!portalSlug) return;
    setLoadingData(true);
    setError("");
    try {
      const [assignedDeals, approvedDocs, activityLogs] = await Promise.all([
        fetchLenderDeals(portalSlug),
        fetchLenderDocuments(portalSlug),
        fetchLenderSubmissions(portalSlug)
      ]);
      setDeals(assignedDeals);
      setDocuments(approvedDocs);
      setLogs(activityLogs);
      
      if (assignedDeals.length > 0) {
        setSelectedDeal(assignedDeals[0]);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load portal documents.");
    } finally {
      setLoadingData(false);
    }
  }

  // Handle Login submission
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!portalSlug || !passcode) return;
    setLoggingIn(true);
    setError("");
    try {
      const data = await loginLender(portalSlug, passcode);
      setLenderProfile(data.lender);
      setIsAuthorized(true);
    } catch (err: any) {
      setError(err.message || "Incorrect passcode.");
    } finally {
      setLoggingIn(false);
    }
  }

  // Handle Logout
  function handleLogout() {
    if (!portalSlug) return;
    sessionStorage.removeItem(`lender_session_${portalSlug}`);
    setIsAuthorized(false);
    setLenderProfile(null);
    setDeals([]);
    setSelectedDeal(null);
  }

  // Filter documents and timeline for active deal
  const activeDocs = useMemo(() => {
    if (!selectedDeal) return [];
    return documents.filter(doc => doc.dealRef.toLowerCase() === selectedDeal.id.toLowerCase());
  }, [selectedDeal, documents]);

  const activeLogs = useMemo(() => {
    if (!selectedDeal) return [];
    return logs.filter(log => log.dealRef.toLowerCase() === selectedDeal.id.toLowerCase());
  }, [selectedDeal, logs]);

  if (!portalSlug) {
    return <Navigate to="/deals" replace />;
  }

  // Login Gate View
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center p-4 relative overflow-hidden">
        {/* Decorative ambient glows */}
        <div className="absolute -left-20 -top-20 h-80 w-80 rounded-full bg-acp-bronze/5 blur-[100px] pointer-events-none" />
        <div className="absolute -right-20 -bottom-20 h-80 w-80 rounded-full bg-acp-bronze/5 blur-[100px] pointer-events-none" />

        <form
          onSubmit={handleLogin}
          className="w-full max-w-md relative z-10 rounded-2xl border border-white/10 bg-[#0D0D0E] backdrop-blur-xl p-8 shadow-2xl card-sheen"
        >
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-6 flex items-center justify-center h-20 w-20">
              <svg
                className="absolute inset-0 h-full w-full text-acp-bronze/20 animate-[spin_30s_linear_infinite]"
                viewBox="0 0 100 100"
                style={{ transform: `rotate(${passcode.length * 12}deg)`, transition: "transform 0.4s ease-out" }}
              >
                <circle cx="50" cy="50" r="45" stroke="currentColor" strokeWidth="1" strokeDasharray="6 4" fill="none" />
              </svg>
              <div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-acp-bronze to-acp-bronze-dark text-white shadow-lg border border-white/10">
                <LockKeyhole className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>

            <h2 className="font-display text-2xl text-white font-normal italic tracking-wide">
              Aysan Capital Partners
            </h2>
            <p className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.2em] text-acp-bronze">
              Secure Lender Portal
            </p>
          </div>

          <div className="mt-8 space-y-5">
            <div className="rounded-xl border border-white/5 bg-white/[0.01] p-4 text-center">
              <p className="text-[11px] leading-relaxed text-slate-400">
                This environment contains approved lender materials. Please enter the passcode provided by your ACP Deal Manager to enter the portal.
              </p>
            </div>

            <div>
              <label className="block text-[9px] font-extrabold uppercase tracking-[0.18em] text-slate-555" htmlFor="passcode">
                Portal Passcode
              </label>
              <input
                id="passcode"
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="••••••••"
                className="mt-2.5 h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder-slate-650 outline-none transition-all duration-300 focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze"
                autoComplete="current-password"
              />
            </div>

            {error ? (
              <p className="text-center text-xs font-semibold text-rose-400 animate-pulse">{error}</p>
            ) : null}

            <button
              type="submit"
              disabled={loggingIn || !passcode}
              className="w-full inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark px-4 text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-bronze disabled:opacity-40"
            >
              {loggingIn ? "Verifying..." : "Access Portal"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // Dashboard View
  return (
    <div className="min-h-screen text-slate-100 lg:grid lg:grid-cols-[284px_minmax(0,1fr)] bg-acp-ink">
      {/* Lender Portal Sidebar */}
      <aside className="hidden min-h-screen border-r border-white/[0.06] bg-[#0D0D0E] text-white lg:block relative overflow-hidden">
        <div className="absolute -left-12 -top-12 h-48 w-48 rounded-full bg-acp-bronze/5 blur-3xl pointer-events-none" />
        <div className="absolute -right-20 bottom-10 h-64 w-64 rounded-full bg-acp-bronze/5 blur-3xl pointer-events-none" />

        <div className="sticky top-0 flex h-screen flex-col px-6 py-7 z-10">
          {/* Logo */}
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex shrink-0 h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#C5A059]/20 to-[#C5A059]/20 text-white shadow-md border border-[#C5A059]/30">
              <Building2 className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-heading text-base font-black tracking-tight text-white uppercase">
                Aysan Capital
              </p>
              <p className="truncate text-[10px] font-extrabold uppercase tracking-[0.18em] text-acp-bronze">
                Investor Relations
              </p>
            </div>
          </div>

          {/* Profile Card */}
          {lenderProfile && (
            <div className="mt-10 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 shadow-sm backdrop-blur-md">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-acp-bronze/10 text-acp-bronze text-xs font-bold border border-acp-bronze/20">
                  {lenderProfile.Company_Name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-white leading-none">{lenderProfile.Company_Name}</p>
                  <p className="truncate text-[9px] font-semibold text-slate-450 mt-1 uppercase">Lender Portal Node</p>
                </div>
              </div>
              <div className="mt-4 pt-3.5 border-t border-white/[0.04] space-y-2 text-[10px] text-slate-400 font-medium leading-relaxed">
                {lenderProfile.Contact_Name && <div>Contact: {lenderProfile.Contact_Name}</div>}
                {lenderProfile.Email && <div>Email: {lenderProfile.Email}</div>}
              </div>
            </div>
          )}

          {/* Status Box */}
          <div className="mt-6 space-y-3.5">
            <div className="flex items-center gap-3 text-xs font-semibold text-slate-350">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.03] border border-white/5 text-acp-bronze/80">
                <Database className="h-3.5 w-3.5" />
              </span>
              <span>Secure Session Active</span>
            </div>
          </div>

          {/* Logout Button */}
          <button
            onClick={handleLogout}
            className="mt-auto inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-xs font-bold uppercase tracking-wider text-slate-300 hover:bg-white/10 transition"
          >
            <LogOut className="h-4 w-4" />
            Exit Portal
          </button>
        </div>
      </aside>

      {/* Mobile Drawer Navigation */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity duration-300"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          
          {/* Drawer Sidebar */}
          <aside className="relative flex w-[284px] max-w-[85vw] flex-col border-r border-white/[0.06] bg-[#0D0D0E] text-white h-full px-6 py-7 shadow-2xl animate-slide-in-left overflow-hidden">
            {/* Ambient glows matching styling */}
            <div className="absolute -left-12 -top-12 h-48 w-48 rounded-full bg-acp-bronze/5 blur-3xl pointer-events-none" />
            <div className="absolute -right-20 bottom-10 h-64 w-64 rounded-full bg-acp-bronze/5 blur-3xl pointer-events-none" />

            <div className="flex h-full flex-col z-10">
              {/* Header inside drawer */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex shrink-0 h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#C5A059]/20 to-[#C5A059]/20 text-white shadow-md border border-[#C5A059]/30">
                    <Building2 className="h-5 w-5 text-white" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-heading text-sm font-black tracking-tight text-white uppercase">
                      Aysan Capital
                    </p>
                    <p className="truncate text-[9px] font-extrabold uppercase tracking-[0.18em] text-acp-bronze">
                      Investor Relations
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-white transition cursor-pointer"
                  aria-label="Close menu"
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Profile Card */}
              {lenderProfile && (
                <div className="mt-10 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 shadow-sm backdrop-blur-md">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-acp-bronze/10 text-acp-bronze text-xs font-bold border border-acp-bronze/20">
                      {lenderProfile.Company_Name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-white leading-none">{lenderProfile.Company_Name}</p>
                      <p className="truncate text-[9px] font-semibold text-slate-450 mt-1 uppercase">Lender Portal Node</p>
                    </div>
                  </div>
                  <div className="mt-4 pt-3.5 border-t border-white/[0.04] space-y-2 text-[10px] text-slate-400 font-medium leading-relaxed">
                    {lenderProfile.Contact_Name && <div>Contact: {lenderProfile.Contact_Name}</div>}
                    {lenderProfile.Email && <div>Email: {lenderProfile.Email}</div>}
                  </div>
                </div>
              )}

              {/* Status Box */}
              <div className="mt-6 space-y-3.5">
                <div className="flex items-center gap-3 text-xs font-semibold text-slate-350">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.03] border border-white/5 text-acp-bronze/80">
                    <Database className="h-3.5 w-3.5" />
                  </span>
                  <span>Secure Session Active</span>
                </div>
              </div>

              {/* Logout Button */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleLogout();
                }}
                className="mt-auto inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-xs font-bold uppercase tracking-wider text-slate-300 hover:bg-white/10 transition"
              >
                <LogOut className="h-4 w-4" />
                Exit Portal
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="min-w-0 flex flex-col min-h-screen relative z-10">
        <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#0A0A0B]/45 backdrop-blur-md shadow-soft">
          <div className="flex items-center justify-between gap-4 px-6 py-4 sm:px-8">
            <div className="lg:hidden flex shrink-0 items-center gap-2 min-w-0">
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                className="h-9 w-9 flex shrink-0 items-center justify-center rounded-xl bg-white/10 border border-white/15 text-white hover:bg-white/20 transition cursor-pointer mr-1"
                title="Open menu"
                type="button"
              >
                <Menu className="h-5 w-5 text-white" />
              </button>
              <div className="h-8 w-8 flex items-center justify-center rounded bg-gradient-to-br from-acp-bronze/20 to-acp-bronze/20 border border-acp-bronze/35 text-white shrink-0">
                <Building2 className="h-4 w-4" />
              </div>
              <p className="font-heading text-xs font-black uppercase text-white tracking-wider truncate">Lender Portal</p>
            </div>

            <div className="hidden min-w-0 lg:block">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">Secure Investor Relations</p>
              <p className="mt-1 text-xs font-bold text-slate-300 tracking-wide uppercase">Lender Portal Microsite Node</p>
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden md:inline-flex h-8 items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3.5 text-xs font-bold text-slate-300">
                <ShieldCheck className="h-3.5 w-3.5 text-acp-emerald" />
                Lender-Safe Sandbox
              </span>
              <button
                onClick={handleLogout}
                className="lg:hidden h-8 w-8 flex items-center justify-center rounded bg-white/5 border border-white/10 text-slate-400 hover:text-white"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto max-w-[1280px] space-y-8 animate-fade-in-up">
            
            {loadingData ? <LoadingState /> : null}

            {error ? <ErrorState error={new Error(error)} /> : null}

            {!loadingData && !error && deals.length === 0 ? (
              <EmptyState 
                title="No Deals Assigned" 
                message="You do not have review access to any deals at this time. Please contact your ACP Deal Manager."
              />
            ) : null}

            {!loadingData && !error && deals.length > 0 && selectedDeal ? (
              <div className="space-y-8">
                {/* Deal Selection Banner */}
                <div className="rounded-2xl border border-white/[0.08] bg-[#0D0D0E] p-6 shadow-premium-card card-sheen flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-acp-bronze">Deal Room Review</span>
                    <h1 className="text-xl font-bold text-white mt-1 leading-none">
                      {selectedDeal.companyName || selectedDeal.dealRef}
                    </h1>
                  </div>

                  <div className="flex items-center gap-3 self-start md:self-auto">
                    <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 select-none" htmlFor="deal-select">
                      Select Deal Room:
                    </label>
                    <select
                      id="deal-select"
                      value={selectedDeal.id}
                      onChange={(e) => {
                        const target = deals.find(d => d.id === e.target.value);
                        if (target) setSelectedDeal(target);
                      }}
                      className="h-10 rounded-xl border border-white/10 bg-[#0A0A0B] px-4 text-xs font-bold text-white outline-none focus:border-acp-bronze cursor-pointer shadow-sm"
                    >
                      {deals.map(deal => (
                        <option key={deal.id} value={deal.id}>
                          {deal.dealRef} — {deal.companyName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Confidential Investor Header Banner */}
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-6 py-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <Landmark className="h-5 w-5 text-acp-bronze mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold text-amber-200 uppercase tracking-wider">Confidential Investor Material</h4>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                        The contents of this portal are strictly private and subject to non-disclosure compliance guidelines. Unauthorized distribution or sharing is restricted.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Tab Switcher */}
                <div className="flex gap-1.5 overflow-x-auto rounded-xl border border-white/[0.06] bg-[#0D0D0E] p-1.5 shadow-inner backdrop-blur-md">
                  {lenderTabs.map((tab) => (
                    <button
                      key={tab.id}
                      className={cx(
                        "inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-xs font-extrabold uppercase tracking-wider transition-all duration-300 flex-1 sm:flex-initial cursor-pointer",
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

                {activeTab === "overview" ? (
                  <div className="space-y-8">
                    {/* Deal Cover Sheet (Lender Redacted view!) */}
                    <CoverSheet deal={selectedDeal} audience="lender" />

                    {/* Approved Documents Checklist */}
                    <section className="space-y-4">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-acp-bronze shadow-sm">
                          <Files className="h-5 w-5" />
                        </span>
                        <h2 className="text-sm font-bold uppercase tracking-wider text-white">Approved Documents</h2>
                      </div>
                      
                      {selectedDeal.ndaApproved ? (
                        <DocumentChecklist documents={activeDocs} audience="lender" />
                      ) : (
                        <div className="rounded-2xl border border-white/[0.06] bg-[#0D0D0E] p-8 text-center relative overflow-hidden shadow-premium-card card-sheen max-w-2xl mx-auto my-4 animate-scale-in">
                          <div className="absolute -left-12 -top-12 h-32 w-32 rounded-full bg-amber-500/5 blur-2xl pointer-events-none" />
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 mx-auto mb-4 animate-pulse">
                            <LockKeyhole className="h-6 w-6" />
                          </div>
                          <h3 className="text-sm font-black uppercase tracking-wider text-white">NDA Approval Required</h3>
                          <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
                            Access to the secure document checklist for this acquisition is restricted until the Non-Disclosure Agreement (NDA) is executed and approved.
                          </p>
                          <div className="mt-6 flex flex-col sm:flex-row justify-center gap-3">
                            <button
                              onClick={() => setActiveTab("chat")}
                              className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark px-4 text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-bronze transition cursor-pointer"
                              type="button"
                            >
                              <MessageSquare className="h-4 w-4" />
                              Contact Deal Manager
                            </button>
                          </div>
                        </div>
                      )}
                    </section>

                    {/* Timeline History */}
                    {selectedDeal.ndaApproved && (
                      <section className="space-y-4 animate-fade-in">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-acp-bronze shadow-sm">
                            <History className="h-5 w-5" />
                          </span>
                          <h2 className="text-sm font-bold uppercase tracking-wider text-white">Submission Timeline</h2>
                        </div>
                        <SubmissionTimeline entries={activeLogs} />
                      </section>
                    )}
                  </div>
                ) : (
                  <div className="w-full">
                    <DealChat
                      mode="lender"
                      dealId={selectedDeal.id}
                      portalSlug={portalSlug}
                    />
                  </div>
                )}

              </div>
            ) : null}

          </div>
        </main>
        {isAuthorized && portalSlug && (
          <ChatNotificationWatcher mode="lender" portalSlug={portalSlug} deals={deals} />
        )}
      </div>
    </div>
  );
}
