import { useEffect, useState, useMemo } from "react";
import { 
  fetchDealStageHistory, 
  type StageHistoryEntry 
} from "../../api/admin";
import { 
  Clock, 
  ArrowRight, 
  User, 
  FileText,
  AlertTriangle,
  RefreshCw
} from "lucide-react";
import { cx } from "../../utils/cx";

// Duration formatter
function formatDuration(ms: number): string {
  if (ms < 0) return "0m";
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(ms / 86400000);

  if (days > 0) return `${days} day${days > 1 ? "s" : ""}`;
  if (hours > 0) return `${hours} hr${hours > 1 ? "s" : ""}`;
  if (mins > 0) return `${mins} min${mins > 1 ? "s" : ""}`;
  return "Less than a minute";
}

const STAGE_STYLES: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  INTRO:         { bg: "bg-indigo-500/10",  text: "text-indigo-400",  border: "border-indigo-500/20", badge: "bg-indigo-500/12 text-indigo-400 border-indigo-500/20" },
  DISCOVERY:     { bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/20",   badge: "bg-blue-500/12 text-blue-400 border-blue-500/20" },
  LOI:           { bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/20",  badge: "bg-amber-500/12 text-amber-400 border-amber-500/20" },
  DUE_DILIGENCE: { bg: "bg-purple-500/10",  text: "text-purple-400",  border: "border-purple-500/20", badge: "bg-purple-500/12 text-purple-400 border-purple-500/20" },
  CLOSING:       { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20",badge: "bg-emerald-500/12 text-emerald-400 border-emerald-500/20" },
  PORTFOLIO:     { bg: "bg-[#c5a059]/10",   text: "text-[#c5a059]",   border: "border-[#c5a059]/20",  badge: "bg-[#c5a059]/12 text-[#c5a059] border-[#c5a059]/20" },
  KILLED:        { bg: "bg-red-500/10",     text: "text-red-400",     border: "border-red-500/20",    badge: "bg-red-500/12 text-red-400 border-red-500/20" },
};

interface StageHistoryProps {
  dealId: string;
}

export function StageHistory({ dealId }: StageHistoryProps) {
  const [history, setHistory] = useState<StageHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!dealId) return;

    let active = true;
    setIsLoading(true);
    setError(null);

    fetchDealStageHistory(dealId)
      .then((data) => {
        if (active) {
          setHistory(data);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message || "Failed to load stage history.");
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [dealId, refreshKey]);

  // Calculate durations between consecutive transitions
  // history is sorted chronologically (oldest to newest)
  const timelineWithDurations = useMemo(() => {
    return history.map((entry, index) => {
      let durationMs: number | null = null;
      if (index < history.length - 1) {
        // Time between this transition and the next one
        const currentT = new Date(entry.changedAt).getTime();
        const nextT = new Date(history[index + 1].changedAt).getTime();
        durationMs = nextT - currentT;
      } else {
        // Time from last transition to now (current stage duration)
        const currentT = new Date(entry.changedAt).getTime();
        const nowT = new Date().getTime();
        durationMs = nowT - currentT;
      }

      return {
        ...entry,
        durationMs,
      };
    });
  }, [history]);

  // Reverse timeline for top-down descending order (newest first) in presentation
  const presentationTimeline = useMemo(() => {
    return [...timelineWithDurations].reverse();
  }, [timelineWithDurations]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-white/[0.04] pb-3 select-none">
        <h3 className="text-xs font-bold uppercase tracking-wider text-white">Deal Stage Audit Trail</h3>
        <button
          onClick={() => setRefreshKey((prev) => prev + 1)}
          className="p-1.5 rounded-lg border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.04] text-slate-500 hover:text-white transition cursor-pointer"
          title="Refresh history"
        >
          <RefreshCw className={cx("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </button>
      </div>

      {isLoading && (
        <div className="py-8 text-center text-xs font-semibold text-slate-500 flex items-center justify-center gap-2 select-none">
          <RefreshCw className="h-4 w-4 animate-spin text-[#c5a059]" />
          <span>Loading transition history...</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/10 bg-rose-500/5 p-4 flex items-center gap-3 text-xs font-semibold text-rose-400">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
          <span>{error}</span>
        </div>
      )}

      {!isLoading && !error && presentationTimeline.length === 0 && (
        <div className="py-8 border border-dashed border-white/[0.04] rounded-2xl text-center select-none">
          <Clock className="mx-auto h-6 w-6 text-slate-700 mb-2" />
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">No Transition History</p>
          <p className="text-[10px] text-slate-600 mt-1">
            This deal has not undergone any validated stage transitions yet.
          </p>
        </div>
      )}

      {!isLoading && !error && presentationTimeline.length > 0 && (
        <div className="relative border-l border-white/[0.06] pl-6 ml-3 space-y-8 font-sans">
          {presentationTimeline.map((item, index) => {
            const fromStyles = STAGE_STYLES[item.fromStage] || STAGE_STYLES.INTRO;
            const toStyles = STAGE_STYLES[item.toStage] || STAGE_STYLES.INTRO;
            const isCurrent = index === 0; // Newest is at index 0 because we reversed it

            return (
              <div key={item.id} className="relative group">
                {/* Timeline Dot Indicator */}
                <span className={cx(
                  "absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full border bg-[#09090b] transition duration-200",
                  isCurrent 
                    ? "border-[#c5a059] ring-4 ring-[#c5a059]/10" 
                    : "border-white/10 group-hover:border-white/30"
                )}>
                  <span className={cx(
                    "h-1.5 w-1.5 rounded-full",
                    isCurrent ? "bg-[#c5a059]" : "bg-slate-750"
                  )} />
                </span>

                {/* Main Card */}
                <div className={cx(
                  "rounded-xl border p-4 transition-all duration-200 bg-[#0c0c0e]/50",
                  isCurrent 
                    ? "border-white/[0.08] bg-[#0c0c0e]" 
                    : "border-white/[0.04] hover:border-white/[0.08]"
                )}>
                  {/* Transition path Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2 select-none">
                      <span className={cx(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold",
                        fromStyles.badge
                      )}>
                        {item.fromStageLabel}
                      </span>
                      <ArrowRight className="h-3 w-3 text-slate-600" />
                      <span className={cx(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold",
                        toStyles.badge
                      )}>
                        {item.toStageLabel}
                      </span>
                    </div>

                    <span className="text-[10px] font-semibold text-slate-500 select-none">
                      {new Date(item.changedAt).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </span>
                  </div>

                  {/* Notes description */}
                  {item.notes ? (
                    <div className="mt-2.5 rounded-lg border border-white/[0.04] bg-white/[0.01] p-3 text-xs text-slate-300 leading-relaxed font-medium">
                      <p className="whitespace-pre-line">{item.notes}</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs italic text-slate-600 select-none">No transition notes provided.</p>
                  )}

                  {/* Footer metadata */}
                  <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 text-[10px] font-semibold text-slate-500 border-t border-white/[0.04] pt-2.5 select-none">
                    <div className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-slate-600" />
                      <span>
                        {item.changedBy}
                      </span>
                      <span className="inline-flex items-center rounded-md bg-white/5 border border-white/10 px-1 py-0.2 text-[8px] font-bold uppercase text-slate-450 tracking-wider">
                        {item.changedByRole}
                      </span>
                    </div>

                    {item.durationMs !== null && (
                      <div className="flex items-center gap-1 text-[10px] text-slate-500 font-semibold">
                        <Clock className="h-3.5 w-3.5 text-slate-600" />
                        <span>
                          {isCurrent ? "Active for " : "Spent "}
                          <span className="text-slate-400 font-bold">{formatDuration(item.durationMs)}</span>
                          {!isCurrent && " in this stage"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
