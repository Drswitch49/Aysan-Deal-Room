import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { 
  ArrowRight, 
  FileText, 
  Mic, 
  Brain, 
  Search, 
  Clock, 
  AlertTriangle,
  RefreshCw
} from "lucide-react";
import { fetchActivityFeed, type ActivityEvent } from "../../api/admin";
import { cx } from "../../utils/cx";

// Helper to format timestamps to relative or readable text
function formatTimestamp(timestampStr: string): string {
  if (!timestampStr) return "Just now";
  const date = new Date(timestampStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined
  });
}

const EVENT_COLORS = {
  bronze:  "border-[#C6A66B]/20 bg-[#C6A66B]/5 text-[#C6A66B]",
  blue:    "border-blue-500/20 bg-blue-500/5 text-blue-400",
  emerald: "border-emerald-500/20 bg-emerald-500/5 text-emerald-400",
  purple:  "border-purple-500/20 bg-purple-500/5 text-purple-400",
  amber:   "border-amber-500/20 bg-amber-500/5 text-amber-400",
  red:     "border-red-500/20 bg-red-500/5 text-red-400",
};

interface ActivityFeedProps {
  dealId?: string;
  limit?: number;
  showFilters?: boolean;
}

export function ActivityFeed({ dealId, limit = 20, showFilters = false }: ActivityFeedProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);

    fetchActivityFeed({ dealId, limit })
      .then((data) => {
        if (active) {
          setEvents(data);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message || "Failed to load activity stream.");
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
  }, [dealId, limit, refreshKey]);

  const filteredEvents = events.filter((e) => {
    if (filterType === "all") return true;
    if (filterType === "transitions") return e.type === "stage_transition";
    if (filterType === "documents") return e.type === "document_uploaded";
    if (filterType === "analyses") {
      return e.type === "transcript_analyzed" || e.type === "brief_completed";
    }
    return true;
  });

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case "arrow-right": return <ArrowRight className="h-3.5 w-3.5" />;
      case "file":        return <FileText className="h-3.5 w-3.5" />;
      case "mic":         return <Mic className="h-3.5 w-3.5" />;
      case "brain":       return <Brain className="h-3.5 w-3.5" />;
      case "search":      return <Search className="h-3.5 w-3.5" />;
      default:            return <Clock className="h-3.5 w-3.5" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Optional Filters Row */}
      {showFilters && (
        <div className="flex items-center justify-between border-b border-white/[0.02] pb-3 select-none">
          <div className="flex gap-2">
            {[
              { id: "all", label: "All Activity" },
              { id: "transitions", label: "Transitions" },
              { id: "documents", label: "Documents" },
              { id: "analyses", label: "AI Insights" },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id)}
                className={cx(
                  "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border transition cursor-pointer",
                  filterType === f.id
                    ? "border-[#C6A66B] bg-[#C6A66B]/5 text-[#C6A66B]"
                    : "border-white/[0.02] bg-white/[0.01] text-slate-500 hover:text-white"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setRefreshKey((prev) => prev + 1)}
            className="p-1.5 rounded-lg border border-white/[0.02] bg-white/[0.01] hover:bg-white/[0.04] text-slate-500 hover:text-white transition cursor-pointer"
            title="Refresh feed"
          >
            <RefreshCw className={cx("h-3.5 w-3.5", isLoading && "animate-spin")} />
          </button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="py-8 text-center text-xs font-semibold text-slate-500 flex items-center justify-center gap-2 select-none">
          <RefreshCw className="h-4 w-4 animate-spin text-[#C6A66B]" />
          <span>Syncing activity logs...</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-rose-500/10 bg-rose-500/5 p-4 flex items-center gap-3 text-xs font-semibold text-rose-400">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
          <span>{error}</span>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && filteredEvents.length === 0 && (
        <div className="py-12 border border-dashed border-white/[0.02] rounded-2xl text-center select-none">
          <Clock className="mx-auto h-6 w-6 text-slate-700 mb-2" />
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">No activities logged</p>
          <p className="text-[10px] text-slate-650 mt-1 max-w-[240px] mx-auto">
            Audit history, AI analysis updates, and document processing will appear in this feed.
          </p>
        </div>
      )}

      {/* Timeline List */}
      {!isLoading && !error && filteredEvents.length > 0 && (
        <div className="space-y-3">
          {filteredEvents.map((event) => {
            const colorClass = EVENT_COLORS[event.color] || EVENT_COLORS.blue;
            return (
              <div
                key={event.id}
                className="group relative flex gap-3 rounded-xl border border-white/[0.02] bg-white/[0.01] p-3 hover:border-white/[0.08] hover:bg-white/[0.02] transition-all duration-200"
              >
                {/* Event Icon Block */}
                <div className={cx(
                  "flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg border",
                  colorClass
                )}>
                  {getIcon(event.icon)}
                </div>

                {/* Event Content Details */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-[11px] font-semibold text-white/95 leading-normal">
                      {event.title}
                    </p>
                    <span className="shrink-0 text-[9px] font-semibold text-slate-500 select-none whitespace-nowrap">
                      {formatTimestamp(event.timestamp)}
                    </span>
                  </div>

                  {event.detail && (
                    <p className="mt-1 text-[10px] text-slate-400 font-medium leading-relaxed break-words line-clamp-3">
                      {event.detail}
                    </p>
                  )}

                  {/* Contextual Badges Row */}
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[9px] font-semibold text-slate-600 select-none">
                    {/* Link to Deal Detail if it's a cross-deal activity */}
                    {!dealId && event.dealId && (
                      <Link
                        to={`/deals/${encodeURIComponent(event.dealRef || event.dealId)}`}
                        className="text-slate-500 hover:text-[#C6A66B] font-semibold transition"
                      >
                        {event.companyName || event.dealRef || "View Deal"}
                      </Link>
                    )}
                    
                    {!dealId && event.dealId && event.changedBy && (
                      <span>·</span>
                    )}

                    {event.changedBy && (
                      <span className="text-slate-500">
                        by {event.changedBy}
                      </span>
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
