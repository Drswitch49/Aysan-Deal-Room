import type { ReactNode } from "react";
import { cx } from "../../utils/cx";

/**
 * Shared skeleton pulse block — used to build context-aware loading states.
 */
export function Skeleton({
  className = "",
  height = "h-4",
}: {
  className?: string;
  height?: string;
}) {
  return (
    <div
      className={cx(
        "skeleton rounded-lg bg-white/[0.03]",
        height,
        className
      )}
      aria-hidden="true"
    />
  );
}

/**
 * Context-aware loading state with realistic card skeletons.
 * Pass `variant` to match the shape of the page content being loaded.
 */
export function LoadingState({
  label = "Loading deal room data",
  variant = "cards",
}: {
  label?: string;
  variant?: "cards" | "table" | "detail" | "list";
}) {
  return (
    <div className="space-y-4" role="status" aria-label={label} aria-live="polite">
      {variant === "cards" && (
        <>
          {/* Metric row */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className={cx(
                  "rounded-2xl border border-white/[0.05] bg-[#0D0D0E] p-5 space-y-3",
                  `stagger-${i + 1}`
                )}
              >
                <Skeleton height="h-3" className="w-24" />
                <Skeleton height="h-8" className="w-16" />
                <Skeleton height="h-2.5" className="w-20" />
              </div>
            ))}
          </div>
          {/* Two-column content */}
          <div className="grid gap-6 lg:grid-cols-2">
            {[...Array(2)].map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-white/[0.05] bg-[#0D0D0E] p-5 space-y-4"
              >
                <Skeleton height="h-3" className="w-36" />
                {[...Array(4)].map((_, j) => (
                  <div key={j} className="flex items-center gap-3">
                    <Skeleton height="h-2.5" className="w-2.5 rounded-full shrink-0" />
                    <Skeleton height="h-3" className="flex-1" />
                    <Skeleton height="h-2.5" className="w-16 shrink-0" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {variant === "table" && (
        <div className="rounded-2xl border border-white/[0.05] bg-[#0E121A] overflow-hidden">
          {/* Table header */}
          <div className="border-b border-white/[0.06] bg-white/[0.01] px-5 py-3 flex gap-4">
            {["w-44", "w-20", "w-24", "w-16", "w-16", "w-16", "w-16", "w-24", "w-36", "w-24"].map((w, i) => (
              <Skeleton key={i} height="h-2.5" className={w} />
            ))}
          </div>
          {/* Table rows */}
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className={cx(
                "border-b border-white/[0.04] px-5 py-4 flex items-center gap-4",
                `stagger-${Math.min(i + 1, 5)}`
              )}
            >
              <div className="w-44 space-y-1.5">
                <Skeleton height="h-3" className="w-36" />
                <Skeleton height="h-2.5" className="w-28" />
              </div>
              <Skeleton height="h-5" className="w-20 rounded-full" />
              <Skeleton height="h-5" className="w-24 rounded-full" />
              {["w-14", "w-14", "w-14", "w-14"].map((w, j) => (
                <Skeleton key={j} height="h-3" className={w} />
              ))}
              <Skeleton height="h-5" className="w-20 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <Skeleton height="h-3" className="w-32" />
                <Skeleton height="h-2.5" className="w-20" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton height="h-5" className="w-5 rounded-full" />
                <Skeleton height="h-2.5" className="w-12" />
              </div>
            </div>
          ))}
        </div>
      )}

      {variant === "detail" && (
        <div className="space-y-6">
          {/* Header block */}
          <div className="rounded-2xl border border-white/[0.05] bg-[#0D0D0E] p-6 space-y-4">
            <div className="flex items-center gap-4">
              <Skeleton height="h-12" className="w-12 rounded-xl" />
              <div className="space-y-2 flex-1">
                <Skeleton height="h-5" className="w-64" />
                <Skeleton height="h-3" className="w-40" />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton height="h-2.5" className="w-16" />
                  <Skeleton height="h-4" className="w-20" />
                </div>
              ))}
            </div>
          </div>
          {/* Tab content */}
          <div className="rounded-2xl border border-white/[0.05] bg-[#0D0D0E] p-6 space-y-4">
            <Skeleton height="h-3" className="w-48" />
            {[...Array(5)].map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton height="h-3" className="w-full" />
                <Skeleton height="h-3" className="w-4/5" />
              </div>
            ))}
          </div>
        </div>
      )}

      {variant === "list" && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className={cx(
                "rounded-2xl border border-white/[0.05] bg-[#0D0D0E] p-4 flex items-center gap-4",
                `stagger-${Math.min(i + 1, 5)}`
              )}
            >
              <Skeleton height="h-10" className="w-10 rounded-xl shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton height="h-3.5" className="w-48" />
                <Skeleton height="h-2.5" className="w-32" />
              </div>
              <Skeleton height="h-6" className="w-20 rounded-full" />
            </div>
          ))}
        </div>
      )}

      <p className="sr-only">{label}...</p>
    </div>
  );
}
