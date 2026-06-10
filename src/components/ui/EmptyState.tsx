import type { ReactNode } from "react";
import { FolderOpen } from "lucide-react";

/**
 * Empty state component with icon slot, message, and optional CTA.
 */
export function EmptyState({
  title,
  message,
  icon,
  action,
}: {
  title: string;
  message: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] px-8 py-14 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-slate-500">
        {icon ?? <FolderOpen className="h-5 w-5" />}
      </div>
      <h2 className="text-sm font-bold text-white tracking-tight">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-400 font-medium">
        {message}
      </p>
      {action && (
        <div className="mt-5 flex justify-center">
          {action}
        </div>
      )}
    </div>
  );
}
