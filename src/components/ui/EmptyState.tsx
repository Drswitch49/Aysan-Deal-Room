export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-acp-card backdrop-blur-md px-6 py-12 text-center shadow-premium-card">
      <div className="mx-auto mb-4 h-10 w-10 rounded-md border border-white/5 bg-white/5" />
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">{message}</p>
    </div>
  );
}
