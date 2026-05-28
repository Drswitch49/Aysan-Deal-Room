export function LoadingState({ label = "Loading deal room data" }: { label?: string }) {
  return (
    <div className="space-y-3" aria-live="polite" aria-busy="true">
      <p className="text-sm font-semibold text-slate-400">{label}...</p>
      <div className="grid gap-3">
        <div className="h-20 animate-pulse rounded-lg bg-white/5 border border-white/5 shadow-premium-card" />
        <div className="h-20 animate-pulse rounded-lg bg-white/[0.04] border border-white/5 shadow-premium-card" />
        <div className="h-20 animate-pulse rounded-lg bg-white/[0.03] border border-white/5 shadow-premium-card" />
      </div>
    </div>
  );
}
