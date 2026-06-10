import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "../../utils/cx";

type StatCardTone = "default" | "bronze" | "emerald" | "rose" | "blue";

const toneAccents: Record<StatCardTone, string> = {
  default: "text-white",
  bronze: "text-[#C5A059]",
  emerald: "text-emerald-400/90",
  rose: "text-rose-455",
  blue: "text-blue-400/90",
};

const toneIconBg: Record<StatCardTone, string> = {
  default: "bg-white/[0.02] border-white/[0.04] text-slate-400",
  bronze: "bg-[#C5A059]/5 border-[#C5A059]/10 text-[#C5A059]",
  emerald: "bg-emerald-500/5 border-emerald-500/10 text-emerald-450",
  rose: "bg-rose-500/5 border-rose-500/10 text-rose-450",
  blue: "bg-blue-500/5 border-blue-500/10 text-blue-400",
};

/**
 * Dashboard metric card with icon, value, label, and optional sub-label.
 * Supports a `to` prop to make the card a link.
 */
export function StatCard({
  label,
  value,
  subLabel,
  icon,
  tone = "default",
  to,
}: {
  label: string;
  value: ReactNode;
  subLabel?: string;
  icon?: ReactNode;
  tone?: StatCardTone;
  to?: string;
}) {
  const content = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400/80 group-hover:text-slate-300 transition-colors">
          {label}
        </p>
        <div className={cx("text-2xl font-semibold tracking-tight mt-1", toneAccents[tone])}>
          {value}
        </div>
        {subLabel && (
          <p className="text-[10px] font-semibold text-slate-500 mt-1.5 leading-none">
            {subLabel}
          </p>
        )}
      </div>
      {icon && (
        <div
          className={cx(
            "flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-xl border transition-colors",
            toneIconBg[tone]
          )}
        >
          {icon}
        </div>
      )}
    </div>
  );

  const baseClass =
    "group block rounded-2xl p-6 select-none";

  if (to) {
    return (
      <Link to={to} className={cx(baseClass, "premium-card-interactive card-sheen")}>
        {content}
      </Link>
    );
  }

  return <div className={cx(baseClass, "premium-card card-sheen")}>{content}</div>;
}
