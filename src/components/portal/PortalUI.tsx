/**
 * Capital partner portal components (Build Pack Section 9.2).
 *
 * Kept together because they only make sense together: every one of them
 * exists to make a figure honest about where it came from. A stat without a
 * provenance badge, a coverage pill that shows a number, or an empty panel that
 * does not say when it will fill are all defects here, not style choices.
 */
import { ReactNode, useState } from "react";
import { Download, Eye, FolderOpen, Loader2 } from "lucide-react";
import { openDocument, type PortalDocument } from "../../api/investorPortal";
import {
  CATEGORY_INFO,
  DOC_CATEGORIES,
  DOC_TYPE_INFO,
  acquisitionLabel,
  docTypeLabel,
  isDocType,
} from "../../../lib/core/investor-docs";
import {
  COPY,
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
  cfo_certified: "border-acp-bronze/40 text-acp-bronze",
  filed: "border-sky-500/30 text-sky-300",
  pending: "border-white/10 text-slate-400",
};

/**
 * An unknown kind renders nothing: a badge nobody defined asserts nothing.
 * With `onEvidence`, the badge links to the documents that prove the figure.
 */
export function ProvenanceBadge({
  kind,
  onEvidence,
}: {
  kind: Provenance | string | null | undefined;
  onEvidence?: () => void;
}) {
  const key = kind as Provenance;
  if (!key || !(key in PROVENANCE_LABEL)) return null;
  const className = cx(
    "inline-flex items-center rounded-full border px-2 py-[3px] text-[9px] font-bold uppercase tracking-[0.12em]",
    PROVENANCE_TONE[key],
  );
  if (onEvidence) {
    return (
      <button
        type="button"
        onClick={onEvidence}
        title={`${PROVENANCE_TOOLTIP[key]} Open the evidence.`}
        className={cx(className, "cursor-pointer underline-offset-2 hover:underline")}
      >
        {PROVENANCE_LABEL[key]} ↗
      </button>
    );
  }
  return (
    <span title={PROVENANCE_TOOLTIP[key]} className={className}>
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
  onEvidence,
}: {
  label: string;
  value: string;
  provenance?: Provenance;
  hint?: string;
  /** Where the figure's evidence lives; makes the badge a link. */
  onEvidence?: () => void;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-acp-card p-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-[32px] font-semibold leading-none tabular-nums text-white">{value}</p>
      <div className="mt-3 min-h-[20px]">
        {provenance ? <ProvenanceBadge kind={provenance} onEvidence={onEvidence} /> : hint ? (
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
  noticeType = null,
  version = 1,
  superseded = false,
  eventDate = null,
}: {
  id: string;
  title: string;
  docType: string;
  date: string | null;
  available: boolean;
  publishesOn: string | null;
  viewOnly: boolean;
  hasFile?: boolean;
  noticeType?: string | null;
  version?: number;
  /** A newer version corrects this one. It stays visible, marked. */
  superseded?: boolean;
  eventDate?: string | null;
}) {
  const typeLabel = [
    isDocType(docType) ? DOC_TYPE_INFO[docType].code : null,
    docTypeLabel(docType, noticeType),
    `v${version}`,
    eventDate ? `event ${formatDate(eventDate)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
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
    "inline-flex items-center gap-1 rounded border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-acp-bronze/50 hover:text-acp-bronze disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/5 py-3 last:border-b-0">
      {/* The floor on the title's width is what pushes the date and actions onto
          their own line in a narrow folder, rather than crushing the title. */}
      <div className="min-w-[min(100%,14rem)] flex-1">
        <p className={cx("text-sm [overflow-wrap:anywhere]", superseded ? "text-slate-500" : "text-slate-200")}>
          {title}
          {superseded ? (
            <span className="ml-2 rounded-full border border-white/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-slate-400">
              Superseded
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-[11px] uppercase tracking-[0.1em] text-slate-500">{typeLabel}</p>
        {error ? <p className="mt-1 text-[11px] text-rose-300">{error}</p> : null}
      </div>
      <div className="w-28 text-xs text-slate-400">{date ? formatDate(date) : ""}</div>
      <div className="ml-auto flex w-44 justify-end gap-1.5 text-right text-xs">
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
          <span className="text-slate-500">File to follow</span>
        ) : (
          <span className="font-semibold text-acp-bronze">
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
        className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-white/10 px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-acp-bronze/50 hover:text-acp-bronze disabled:opacity-50"
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
      <p className="text-sm text-slate-200 [overflow-wrap:anywhere]">{line}</p>
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
      <p className="font-semibold text-slate-400">{COPY.footerRisk}</p>
      <p className="mt-1">Private and confidential. Capital at risk.</p>
      <p className="mt-1">partnerships@aysancapital.com</p>
    </footer>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────────────

export function MetricRow({
  label,
  value,
  provenance,
  onEvidence,
}: {
  label: string;
  value: ReactNode;
  provenance?: Provenance;
  onEvidence?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/5 py-3 last:border-b-0">
      <span className="min-w-[min(100%,12rem)] flex-1 text-sm text-slate-300">{label}</span>
      <span className="text-sm font-medium tabular-nums text-white">{value}</span>
      <span className="ml-auto w-32 text-right">{provenance ? <ProvenanceBadge kind={provenance} onEvidence={onEvidence} /> : null}</span>
    </div>
  );
}

export function RailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-b border-white/5 py-3 last:border-b-0">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm tabular-nums text-white [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}

// ─── Document folders ──────────────────────────────────────────────────────

/**
 * A partner's documents in the standard's 7 numbered categories. Only folders
 * that hold something are drawn: the server has already held back every
 * category the partner has not reached, so an empty folder would only
 * advertise what is still to come.
 */
export function DocumentFolders({ docs }: { docs: PortalDocument[] }) {
  return (
    <div className="space-y-4">
      {DOC_CATEGORIES.map((cat) => {
        const inFolder = docs.filter((d) => d.category === cat);
        if (!inFolder.length) return null;
        const info = CATEGORY_INFO[cat];
        return (
          <div key={cat} className="rounded-lg border border-white/5 bg-white/[0.015] px-3 py-3 sm:px-4">
            <div className="flex flex-wrap items-center gap-2">
              <FolderOpen className="h-4 w-4 text-acp-portal-gold" />
              <p className="text-sm font-semibold text-white">
                {info.n} · {info.label}
              </p>
              <span className="text-[11px] text-slate-500">{info.question}</span>
              {!info.download ? (
                <span className="ml-auto rounded-full border border-acp-portal-gold/30 px-2 py-0.5 text-[10px] font-semibold text-acp-portal-gold">
                  View only, your numbered copy
                </span>
              ) : null}
            </div>
            {inFolder.map((d) => (
              <DocRow
                key={d.id}
                id={d.id}
                title={d.title}
                docType={d.doc_type}
                date={d.published_at}
                available={d.available}
                publishesOn={d.publishes_on}
                viewOnly={d.view_only || !info.download}
                hasFile={d.has_file}
                noticeType={d.notice_type}
                version={d.version}
                superseded={d.superseded}
                eventDate={d.event_date}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** The heading for a document group: "Acquisition 01", else the deal's partner name. */
export const docGroupName = (d: PortalDocument): string =>
  acquisitionLabel(d.acquisition_no) ?? d.partner_display_name ?? "Your documents";

export { gbp, formatDate };
