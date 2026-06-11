import type { ReactNode } from "react";

export function PageHeader({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-8 overflow-hidden rounded-2xl border border-white/[0.02] bg-[#161B22] backdrop-blur-md shadow-premium-card animate-fade-in-up">
      <div className="grid gap-5 px-6 py-6 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#C6A66B]">{eyebrow}</p>
          ) : null}
          <h1 className="mt-2 truncate font-heading text-2xl sm:text-3xl text-white font-black tracking-tight uppercase">
            {title}
          </h1>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/[0.02] bg-white/[0.01] px-3 py-1">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-450/75 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
            </span>
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
              Database Connected
            </p>
          </div>
        </div>
        {children ? <div className="flex flex-wrap items-center gap-2.5">{children}</div> : null}
      </div>
    </div>
  );
}
