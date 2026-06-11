import type { ReactNode } from "react";

/**
 * Consistent section header for content cards.
 * Replaces the repeated `text-[10px] font-extrabold uppercase tracking-wider` pattern.
 */
export function SectionHeader({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.02] pb-3 mb-2">
      <h3 className="text-[9px] font-bold uppercase tracking-widest text-slate-450 select-none">
        {children}
      </h3>
      {action && (
        <div className="flex items-center gap-2">
          {action}
        </div>
      )}
    </div>
  );
}
