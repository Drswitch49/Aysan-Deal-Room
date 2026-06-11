import { usePipeline } from "../../context/PipelineContext";

export function HeaderMetrics() {
  const { overdueCount, liveDealsCount, loading } = usePipeline();

  if (loading) {
    return (
      <div className="flex items-center gap-2 animate-pulse">
        <span className="h-5 w-24 rounded-full bg-white/[0.015] border border-white/[0.02]" />
        <span className="h-5 w-20 rounded-full bg-white/[0.015] border border-white/[0.02]" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[9px] font-bold text-amber-500 uppercase tracking-wider select-none">
        {overdueCount} OVERDUE TASKS
      </span>
      <span className="inline-flex items-center rounded-full bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[9px] font-bold text-blue-400 uppercase tracking-wider select-none">
        {liveDealsCount} LIVE DEALS
      </span>
    </div>
  );
}
