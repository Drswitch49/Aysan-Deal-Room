/**
 * The bar shown while an attachment is going up.
 *
 * Separate from `ProgressBar`: that one is built for the light-surface metric
 * cards (slate-100 track) and eases over a full second, which on an upload
 * reads as a bar lagging a second behind the file. This sits on the dark deal
 * panels and follows the transfer closely.
 */
export function UploadProgressBar({
  name,
  fraction,
  finishing,
}: {
  name: string;
  /** 0 → 1. */
  fraction: number;
  /** Bytes are all sent; we are waiting on the store and the row. */
  finishing?: boolean;
}) {
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));

  return (
    <div className="w-full space-y-1.5" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-[10px] font-semibold">
        <span className="truncate text-slate-300" title={name}>
          {finishing ? "Finishing" : "Uploading"} {name}
        </span>
        <span className="shrink-0 tabular-nums text-acp-bronze">{finishing ? "Saving…" : `${percent}%`}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-acp-bronze transition-[width] duration-150 ease-out"
          style={{ width: `${percent}%` }}
        >
          {finishing && <div className="h-full w-full animate-pulse bg-acp-bronze" />}
        </div>
      </div>
    </div>
  );
}
