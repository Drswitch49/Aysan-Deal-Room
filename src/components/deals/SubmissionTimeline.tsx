import { CheckCircle2, Mail, MessageSquareReply, Send } from "lucide-react";
import type { ReactNode } from "react";
import type { SubmissionLogEntry } from "../../types/deal";
import { formatDate } from "../../utils/fields";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";

export function SubmissionTimeline({ entries }: { entries: SubmissionLogEntry[] }) {
  if (entries.length === 0) {
    return <EmptyState title="No submission activity" message="Submission_Log has no entries for this deal." />;
  }

  return (
    <ol className="relative space-y-6 before:absolute before:left-5 before:top-3 before:h-[calc(100%-1.5rem)] before:w-0.5 before:bg-white/5 pl-0">
      {entries.map((entry) => (
        <li key={entry.id} className="relative pl-14 animate-fade-in-up">
          {/* Timeline node dot */}
          <div className="absolute left-0 top-2 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-acp-purple shadow-md transition-all duration-300 hover:border-acp-purple hover:shadow-glow-purple">
            <Send className="h-4 w-4" aria-hidden="true" />
          </div>
          
          {/* Card */}
          <div className="rounded-2xl border border-white/10 bg-acp-card backdrop-blur-md p-6 shadow-premium-card hover-glow-card">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400">
                  {formatDate(entry.date) || "Date not specified"}
                </p>
                <h3 className="mt-2 text-sm font-semibold text-white leading-relaxed">
                  {entry.whatWasSent || "Submission detail not specified"}
                </h3>
              </div>
              {entry.flag ? (
                <div className="self-start">
                  <Badge tone="amber">{entry.flag}</Badge>
                </div>
              ) : null}
            </div>
            
            <dl className="mt-6 grid gap-4 text-xs sm:grid-cols-3">
              <Detail icon={<CheckCircle2 className="h-4 w-4" />} label="Recipient" value={entry.sentTo} />
              <Detail icon={<Mail className="h-4 w-4" />} label="Method" value={entry.sentVia} />
              <Detail icon={<MessageSquareReply className="h-4 w-4" />} label="Response State" value={entry.responseReceived} />
            </dl>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Detail({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 hover:bg-white/[0.04] transition-colors">
      <dt className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">
        <span className="text-acp-purple">{icon}</span>
        {label}
      </dt>
      <dd className="mt-2.5 font-semibold text-slate-200 break-words">{value || "None"}</dd>
    </div>
  );
}
