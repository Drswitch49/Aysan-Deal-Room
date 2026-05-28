import { ArrowLeft, ClipboardList, FileText, Send, ShieldCheck, Eye, History, Shield, Lock } from "lucide-react";
import type { ComponentType } from "react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CoverSheet } from "../components/deals/CoverSheet";
import { DocumentChecklist } from "../components/deals/DocumentChecklist";
import { SubmissionTimeline } from "../components/deals/SubmissionTimeline";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";
import { PageHeader } from "../components/ui/PageHeader";
import { useDeal, useDealDocuments, useSubmissionLog } from "../hooks/useDealRoomData";
import { cx } from "../utils/cx";

type TabId = "cover" | "documents" | "submissions";

const tabs: Array<{ id: TabId; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "cover", label: "Cover Sheet", icon: FileText },
  { id: "documents", label: "Document Checklist", icon: ClipboardList },
  { id: "submissions", label: "Submission Log", icon: Send },
];

export function DealDetailPage() {
  const { ref } = useParams();
  const [activeTab, setActiveTab] = useState<TabId>("cover");
  const decodedRef = useMemo(() => (ref ? decodeURIComponent(ref) : ""), [ref]);
  const dealState = useDeal(decodedRef);
  const documentState = useDealDocuments(decodedRef);
  const submissionState = useSubmissionLog(decodedRef);
  const isLoading = dealState.isLoading || documentState.isLoading || submissionState.isLoading;
  const error = dealState.error ?? documentState.error ?? submissionState.error;

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
        <PageHeader title={dealState.data.companyName || dealState.data.dealRef} eyebrow={`Deal Room / ${dealState.data.dealRef}`}>
          <Link
            to={`/lender/${encodeURIComponent(dealState.data.dealRef)}`}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 text-xs font-bold uppercase tracking-wider text-slate-300 shadow-sm transition-all duration-300 hover:border-acp-purple hover:text-white hover:bg-white/10 hover:shadow-glow-blue transform hover:-translate-y-0.5"
          >
            <ShieldCheck className="h-4 w-4 text-acp-purple" aria-hidden="true" />
            Lender View
          </Link>
        </PageHeader>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px] items-start animate-fade-in-up">
        {/* Workspace Column */}
        <div className="space-y-5">
          <div className="flex gap-1.5 overflow-x-auto rounded-xl border border-white/[0.06] bg-[#0d0c1d] p-1.5 shadow-inner backdrop-blur-md">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={cx(
                  "inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-xs font-extrabold uppercase tracking-wider transition-all duration-300 flex-1 sm:flex-initial",
                  activeTab === tab.id
                    ? "bg-gradient-to-r from-acp-purple to-acp-purple-dark text-white shadow-md shadow-glow-purple-card"
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
              <DocumentChecklist documents={documentState.data ?? []} audience="internal" />
            ) : null}
            {activeTab === "submissions" ? <SubmissionTimeline entries={submissionState.data ?? []} /> : null}
          </div>
        </div>

        {/* VDR Audit Activity Column */}
        <aside className="rounded-2xl border border-white/[0.06] bg-[#0d0c1d] backdrop-blur-md p-6 shadow-premium-card space-y-6 card-sheen">
          <div className="flex items-center justify-between pb-3 border-b border-white/5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-350 select-none">
              <History className="h-4 w-4 text-acp-purple" />
              Room Audit Trail
            </div>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          </div>

          {/* Room stats */}
          <div className="grid grid-cols-2 gap-3 bg-white/5 border border-white/[0.06] rounded-xl p-3 text-center">
            <div>
              <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Index Files</span>
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
                icon={<Eye className="h-3.5 w-3.5 text-acp-blue" />}
                action="Financial model view logged"
                time="3 hours ago"
                user="External Reviewer (JPM)"
              />
              <ActivityItem 
                icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />}
                action="Passcode room unlocked"
                time="6 hours ago"
                user="Lender (Goldman Sachs)"
              />
              <ActivityItem 
                icon={<Lock className="h-3.5 w-3.5 text-acp-purple" />}
                action="Security hash generated"
                time="1 day ago"
                user="System compliance"
              />
              <ActivityItem 
                icon={<FileText className="h-3.5 w-3.5 text-indigo-400" />}
                action="3 documents uploaded"
                time="2 days ago"
                user="Sync webhook (Airtable)"
              />
            </div>
          </div>

          {/* Security Compliance Block */}
          <div className="rounded-xl border border-white/8 bg-acp-navy p-4 text-white relative overflow-hidden shadow-inner">
            <div className="absolute -right-8 -bottom-8 h-20 w-20 rounded-full bg-white/[0.02] blur-xl pointer-events-none" />
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-acp-purple animate-pulse-glow" />
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-white">VDR Certified</span>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400 font-medium">
              Data room operations conform to Private Equity diligence disclosure standards. Full audit logging is active.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link 
      to="/deals" 
      className="group mb-5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-acp-purple transition-colors duration-300"
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
