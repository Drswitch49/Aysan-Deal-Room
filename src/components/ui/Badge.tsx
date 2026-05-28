import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { isSentToLender } from "../../utils/security";

type BadgeTone = "blue" | "green" | "amber" | "red" | "slate";

const toneClasses: Record<BadgeTone, string> = {
  blue: "bg-blue-500/10 text-blue-400 ring-blue-500/25 before:bg-blue-450 before:shadow-[0_0_10px_rgba(59,130,246,0.8)] before:animate-pulse-glow",
  green: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30 before:bg-emerald-450 before:shadow-[0_0_10px_rgba(16,185,129,0.8)] before:animate-pulse-glow",
  amber: "bg-amber-500/10 text-amber-400 ring-amber-500/30 before:bg-amber-450 before:shadow-[0_0_10px_rgba(245,158,11,0.8)] before:animate-pulse-glow",
  red: "bg-rose-500/10 text-rose-450 ring-rose-500/25 before:bg-rose-400 before:shadow-[0_0_10px_rgba(244,63,94,0.8)] before:animate-pulse-glow",
  slate: "bg-slate-500/10 text-slate-400 ring-slate-500/20 before:bg-slate-400",
};

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ring-inset before:h-1.5 before:w-1.5 before:rounded-full transition-all duration-300",
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status?: string }) {
  const normalized = (status || "").trim().toLowerCase();
  let tone: BadgeTone = "slate";

  if (isSentToLender(status || "") || normalized.includes("approved") || normalized.includes("complete")) tone = "green";
  if (normalized.includes("waiting") || normalized.includes("pending") || normalized.includes("expected")) tone = "amber";
  if (normalized.includes("missing") || normalized.includes("rejected")) tone = "red";
  if (normalized.includes("review")) tone = "blue";

  return <Badge tone={tone}>{status || "Unspecified"}</Badge>;
}
