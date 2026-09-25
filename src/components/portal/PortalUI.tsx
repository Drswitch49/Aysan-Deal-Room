/**
 * Capital partner portal components (Build Pack Section 9.2).
 *
 * Kept together because they only make sense together: every one of them
 * exists to make a figure honest about where it came from. A stat without a
 * provenance badge, a coverage pill that shows a number, or an empty panel that
 * does not say when it will fill are all defects here, not style choices.
 */
import { ReactNode, useState } from "react";
import { Download, Eye, Loader2 } from "lucide-react";
import { openDocument } from "../../api/investorPortal";
import {
  COVERAGE_EXPLAINER,
  COVERAGE_LABEL,
  COVERAGE_TONE,
  PROVENANCE_LABEL,
  PROVENANCE_TOOLTIP,
  type CoverageStatus,
  type Provenance,
  activityLine,
  formatDate,
  gbp,
} from "../../lib/portal/format";
import { cx } from "../../utils/cx";

// ─── Provenance ────────────────────────────────────────────────────────────

const PROVENANCE_TONE: Record<Provenance, string> = {
  verified: "border-emerald-500/30 text-emerald-300",
  verified_ledger: "border-emerald-500/30 text-emerald-300",
  cfo_certified: "border-[#C6A66B]/40 text-[#C6A66B]",
  filed: "border-sky-500/30 text-sky-300",
  pending: "border-white/10 text-slate-400",
};

/** An unknown kind renders nothing: a badge nobody defined asserts nothing. */
export function ProvenanceBadge({ kind }: { kind: Provenance | string | null | undefined }) {
  const key = kind as Provenance;
  if (!key || !(key in PROVENANCE_LABEL)) return null;
  return (
    <span
      title={PROVENANCE_TOOLTIP[key]}
      className={cx(
        "inline-flex items-center rounded-full border px-2 py-[3px] text-[9px] font-bold uppercase tracking-[0.12em]",
        PROVENANCE_TONE[key],
      )}
    >
      {PROVENANCE_LABEL[key]}
    </span>
  );
}

// ─── Coverage ──────────────────────────────────────────────────────────────

/** Renders the status word only. There is deliberately no number prop. */
export function CoveragePill({ status }: { status: string | null | undefined }) {
  const key = (status ?? "not_yet_reported") as CoverageStatus;
  const label = COVERAGE_LABEL[key] ?? COVERAGE_LABEL.not_yet_reported;
  return (
    <span
      title={COVERAGE_EXPLAINER[key] ?? ""}
      className={cx(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        COVERAGE_TONE[key] ?? COVERAGE_TONE.not_yet_reported,
      )}
    >
      {label}
    </span>
  );
}

// ─── Stat card ─────────────────────────────────────────────────────────────

export function PortalStatCard({
  label,
  value,
  provenance,
  hint,
}: {
  label: string;
  value: string;
  provenance?: Provenance;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-[#161B22] p-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-[32px] font-semibold leading-none tabular-nums text-white">{value}</p>
      <div className="mt-3 min-h-[20px]">
        {provenance ? <ProvenanceBadge kind={provenance} /> : hint ? (
          <span className="text-[11px] text-slate-500">{hint}</span>
        ) : null}
      </div>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────

/**
 * Never a blank panel. Every empty state says what will appear here and when,
 * because "nothing yet" and "something is broken" look identical otherwise.
 */
export function PortalEmpty({ title, body, icon }: { title: string; body: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-slate-600">{icon}</div> : null}
      <p className="text-sm font-semibold text-slate-300">{title}</p>
      <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-500">{body}</p>
    </div>
  );
}

// ─── Document row ──────────────────────────────────────────────────────────

/**
 * A document that has not published yet shows the date it will, in gold, with
 * no link. Certification is view only and never offers a download.
 *
 * Opening goes through the document-open route, which checks the partner may
 * see it, logs the access and returns a URL that expires in two minutes — the
 * row never holds a shareable link.
 */
export function DocRow({
  id,
  title,
  docType,
  date,
  available,
  publishesOn,
  viewOnly,
  hasFile = false,
}: {
  id: string;
  title: string;
  docType: string;
  date: string | null;
  available: boolean;
  publishesOn: string | null;
  viewOnly: boolean;
  hasFile?: boolean;
}) {
  const typeLabel = docType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const [busy, setBusy] = useState<"view" | "download" | null>(null);
  const [error, setError] = useState("");

  const view = async () => {
    // Opened synchronously so the popup blocker treats it as the click's window.
    const tab = window.open("", "_blank");
    setBusy("view");
    setError("");
    try {
      const { url } = await openDocument(id);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err: any) {
      tab?.close();
      setError(err?.message || "Could not open the document.");
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy("download");
    setError("");
    try {
      const { url, file_name } = await openDocument(id, true);
      // Cloudinary names a download after its random id, so fetch the bytes and
      // save them under the document's real name.
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = href;
      a.download = file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (err: any) {
      setError(err?.message || "Could not download the document.");
    } finally {
      setBusy(null);
    }
  };

  const action =
    "inline-flex items-center gap-1 rounded border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-[#C6A66B]/50 hover:text-[#C6A66B] disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-white/5 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-slate-200">{title}</p>
        <p className="mt-0.5 text-[11px] uppercase tracking-[0.1em] text-slate-500">{typeLabel}</p>
        {error ? <p className="mt-1 text-[11px] text-rose-300">{error}</p> : null}
      </div>
      <div className="w-28 text-xs text-slate-400">{date ? formatDate(date) : ""}</div>
      <div className="flex w-44 justify-end gap-1.5 text-right text-xs">
        {available && hasFile ? (
          <>
            <button type="button" onClick={() => void view()} disabled={busy !== null} className={action}>
              {busy === "view" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} View
            </button>
            {viewOnly ? null : (
              <button type="button" onClick={() => void download()} disabled={busy !== null} className={action}>
                {busy === "download" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                Download
              </button>
            )}
          </>
        ) : available ? (
          <span className="text-slate-500">{viewOnly ? "View only" : "File to follow"}</span>
        ) : (
          <span className="font-semibold text-[#C6A66B]">
            Publishes {publishesOn ? formatDate(publishesOn) : "soon"}
          </span>
        )}
      </div>
    </div>
  );
}

/** A compact "open this document" button, for tables such as Reporting. */
export function DocOpenButton({ id, label }: { id: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = async () => {
    const tab = window.open("", "_blank");
    setBusy(true);
    setError("");
    try {
      const { url } = await openDocument(id);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err: any) {
      tab?.close();
      setError(err?.message || "Could not open it.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-white/10 px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-[#C6A66B]/50 hover:text-[#C6A66B] disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} {label}
      </button>
      {error ? <span className="mt-1 text-[10px] text-rose-300">{error}</span> : null}
    </span>
  );
}

// ─── Activity ──────────────────────────────────────────────────────────────

export function ActivityItem({
  eventType,
  payload,
  createdAt,
}: {
  eventType: string;
  payload: Record<string, any>;
  createdAt: string;
}) {
  const line = activityLine(eventType, payload);
  if (!line) return null; // unknown types are hidden, not guessed at
  return (
    <div className="border-b border-white/5 py-3 last:border-b-0">
      <p className="text-sm text-slate-200">{line}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{formatDate(createdAt)}</p>
    </div>
  );
}

// ─── Banners ───────────────────────────────────────────────────────────────

export function ReadOnlyBanner({ until }: { until: string | null }) {
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
      Your holding was bought back. You have read-only access
      {until ? ` until ${formatDate(until)}` : ""}. Your record stays visible; no actions are available.
    </div>
  );
}

export function PortalFooter() {
  return (
    <footer className="mt-10 border-t border-white/5 pt-5 text-[11px] leading-relaxed text-slate-500">
      <p>Private and confidential. Capital at risk. Figures are actuals; ACP publishes no forecasts.</p>
      <p className="mt-1">partnerships@aysancapital.com</p>
    </footer>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────────────

export function MetricRow({
  label,
  value,
  provenance,
}: {
  label: string;
  value: ReactNode;
  provenance?: Provenance;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-white/5 py-3 last:border-b-0">
      <span className="min-w-0 flex-1 text-sm text-slate-300">{label}</span>
      <span className="text-sm font-medium tabular-nums text-white">{value}</span>
      <span className="w-32 text-right">{provenance ? <ProvenanceBadge kind={provenance} /> : null}</span>
    </div>
  );
}

export function RailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-b border-white/5 py-3 last:border-b-0">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm tabular-nums text-white">{value}</p>
    </div>
  );
}

export { gbp, formatDate };
