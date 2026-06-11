import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "../../utils/cx";

type StatCardTone = "default" | "bronze" | "emerald" | "rose" | "blue";

const toneAccents: Record<StatCardTone, string> = {
  default: "text-white",
  bronze: "text-[#C6A66B]",
  emerald: "text-emerald-400/90",
  rose: "text-rose-400/90",
  blue: "text-blue-400/90",
};

const toneIconBg: Record<StatCardTone, string> = {
  default: "bg-white/[0.02] text-slate-400",
  bronze: "bg-[#C6A66B]/5 text-[#C6A66B]",
  emerald: "bg-emerald-500/5 text-emerald-400",
  rose: "bg-rose-500/5 text-rose-400",
  blue: "bg-blue-500/5 text-blue-400",
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
        <p className="text-[9.5px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-slate-350 transition-colors">
          {label}
        </p>
        <div className={cx("text-2xl font-semibold tracking-tight mt-1", toneAccents[tone])}>
          {value}
        </div>
        {subLabel && (
          <p className="text-[9.5px] font-semibold text-slate-500 mt-2 tracking-wide leading-none">
            {subLabel}
          </p>
        )}
      </div>
      {icon && (
        <div
          className={cx(
            "flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-xl transition-colors",
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
