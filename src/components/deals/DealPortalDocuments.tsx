/**
 * Partner documents for one deal — what every capital partner in the deal can
 * open and download from their portal.
 *
 * Files go straight from the browser to Cloudinary as authenticated assets; the
 * row stores the public id, which the partner views never expose. A partner
 * only ever gets a two-minute signed link, through a route that checks they
 * hold the deal and logs the open.
 *
 * Revoke hides a document from every partner and keeps the file, so access can
 * be given back. Delete removes the row and the file for good.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Eye, FileText, Link2, Loader2, RotateCcw, Trash2, Upload } from "lucide-react";
import {
  addPartnerDocument,
  deletePartnerDocument,
  listPartnerDocuments,
  openPartnerDocument,
  updatePartnerDocument,
} from "../../api/admin/partners";
import { formatBytes, MAX_UPLOAD_BYTES, uploadToCloudinary } from "../../api/admin/_shared";
import { formatDate } from "../../lib/portal/format";
import { cx } from "../../utils/cx";

const DOC_TYPES = [
  ["other", "General"],
  ["notice", "Notice"],
  ["quarterly_report", "Quarterly report"],
  ["covenant_certificate", "Covenant certificate"],
  ["subscription", "Subscription agreement"],
  ["spv_sha", "SPV shareholders' agreement"],
] as const;

const typeLabel = (t: string) => DOC_TYPES.find(([v]) => v === t)?.[1] ?? t.replace(/_/g, " ");

const input =
  "w-full rounded-lg border border-white/10 bg-[#0F1115] px-3 py-2 text-sm text-white outline-none transition focus:border-[#C6A66B] disabled:opacity-60";
const label = "mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500";
const iconBtn =
  "inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-[#C6A66B]/40 hover:text-white disabled:opacity-40";

export function DealPortalDocuments({
  dealId,
  canManage,
  partnerCount,
}: {
  dealId: string;
  canManage: boolean;
  /** Partners with a completed commitment — the people who will see an upload. */
  partnerCount: number;
}) {
  const [docs, setDocs] = useState<Array<Record<string, any>>>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await listPartnerDocuments({ deal_id: dealId }, { noCache: true });
      // Documents addressed to a single partner live on that partner's record.
      setDocs(res.rows.filter((d) => !d.investor_id));
      setError("");
    } catch (err: any) {
      setError(err?.message || "Could not load partner documents.");
    } finally {
      setLoaded(true);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setError("");
    try {
      await fn();
      await load();
    } catch (err: any) {
      setError(err?.message || "That did not work.");
    } finally {
      setBusyId(null);
    }
  };

  const view = async (id: string) => {
    const tab = window.open("", "_blank");
    try {
      const { url } = await openPartnerDocument(id);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err: any) {
      tab?.close();
      setError(err?.message || "Could not open the document.");
    }
  };

  const live = docs.filter((d) => !d.revoked_at).length;

  return (
    <section className="space-y-3 rounded-2xl border border-white/[0.04] bg-[#161B22] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-[#C6A66B]" />
          <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">
            Partner documents{docs.length ? ` · ${live} shared` : ""}
          </h3>
        </div>
        {canManage && !adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#C6A66B] px-3 py-1.5 text-xs font-bold text-[#0F1115] transition hover:brightness-110"
          >
            <Upload className="h-3.5 w-3.5" /> Add document
          </button>
        ) : null}
      </div>

      <p className="text-[11px] text-slate-500">
        {partnerCount
          ? `Shared documents appear in the portal of all ${partnerCount} partner${partnerCount === 1 ? "" : "s"} with a completed commitment in this deal, who can view and download them.`
          : "Documents added here appear to partners once their commitment to this deal is marked completed."}
      </p>

      {adding ? (
        <AddDocumentForm
          dealId={dealId}
          onCancel={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            await load();
          }}
        />
      ) : null}

      {error ? <p className="rounded border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p> : null}

      {!loaded ? (
        <div className="flex items-center gap-2 py-6 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin text-[#C6A66B]" /> Loading…
        </div>
      ) : docs.length === 0 && !adding ? (
        <div className="rounded-xl border border-dashed border-white/10 px-6 py-8 text-center">
          <p className="text-sm text-slate-300">No documents shared with partners yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-white/5">
          {docs.map((d) => {
            const revoked = Boolean(d.revoked_at);
            const busy = busyId === d.id;
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className={cx("truncate text-sm", revoked ? "text-slate-500 line-through" : "text-slate-200")}>{d.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {[
                      typeLabel(d.doc_type),
                      d.file_name,
                      d.file_bytes ? formatBytes(Number(d.file_bytes)) : null,
                      !d.cloudinary_public_id && d.file_link ? "Link" : null,
                      `Added ${formatDate(d.uploaded_at)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span
                  className={cx(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                    revoked
                      ? "border-rose-500/25 bg-rose-500/10 text-rose-300"
                      : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
                  )}
                >
                  {revoked ? "Access revoked" : "Visible to partners"}
                </span>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => void view(d.id)} className={iconBtn} title="Open">
                    <Eye className="h-3 w-3" /> View
                  </button>
                  {canManage ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void act(d.id, () => updatePartnerDocument({ id: d.id, revoked: !revoked }))}
                        className={iconBtn}
                        title={revoked ? "Give partners access again" : "Hide from every partner, keep the file"}
                      >
                        {busy ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : revoked ? (
                          <RotateCcw className="h-3 w-3" />
                        ) : (
                          <Ban className="h-3 w-3" />
                        )}
                        {revoked ? "Restore" : "Revoke"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Delete “${d.title}”? Partners lose access and the file is removed for good.`)) return;
                          void act(d.id, () => deletePartnerDocument(d.id));
                        }}
                        className={cx(iconBtn, "hover:border-rose-500/40 hover:text-rose-300")}
                        title="Delete the document and its file"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function AddDocumentForm({
  dealId,
  onCancel,
  onDone,
}: {
  dealId: string;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"file" | "link">("file");
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<string>("other");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | null) => {
    setError("");
    if (f && f.size > MAX_UPLOAD_BYTES) {
      setError(`"${f.name}" is ${formatBytes(f.size)} — the document store takes files up to ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      setFile(null);
      return;
    }
    setFile(f);
    // Default the title to the file name without its extension.
    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async () => {
    setError("");
    if (!title.trim()) return setError("Give the document a title partners will recognise.");
    if (mode === "file" && !file) return setError("Choose a file to upload.");
    if (mode === "link" && !/^https?:\/\//i.test(link.trim())) return setError("Enter a full link starting with https://");

    try {
      const base = {
        deal_id: dealId,
        investor_id: null,
        doc_type: docType,
        title: title.trim(),
        published_at: new Date().toISOString(),
      };
      if (mode === "file" && file) {
        setProgress(0);
        const asset = await uploadToCloudinary(
          file.name,
          file.type || "application/octet-stream",
          file,
          "aysan-deal-room/partner-documents",
          (f) => setProgress(f),
        );
        await addPartnerDocument({
          ...base,
          cloudinary_public_id: asset.publicId,
          cloudinary_resource_type: asset.resourceType,
          file_format: asset.format ?? (file.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? null),
          file_name: file.name,
          file_bytes: asset.bytes ?? file.size,
        });
      } else {
        setProgress(1);
        await addPartnerDocument({ ...base, file_link: link.trim() });
      }
      await onDone();
    } catch (err: any) {
      setError(err?.message || "Could not add the document.");
      setProgress(null);
    }
  };

  const busy = progress !== null;

  return (
    <div className="space-y-3 rounded-xl border border-[#C6A66B]/20 bg-[#C6A66B]/[0.03] p-4">
      <div className="flex gap-1.5">
        {(
          [
            ["file", "Upload a file", Upload],
            ["link", "Add a link", Link2],
          ] as const
        ).map(([m, text, Icon]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            disabled={busy}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
              mode === m ? "border-[#C6A66B]/50 bg-[#C6A66B]/10 text-[#C6A66B]" : "border-white/10 text-slate-400 hover:text-white",
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {text}
          </button>
        ))}
      </div>

      {mode === "file" ? (
        <div>
          <label className={label}>File</label>
          <input
            ref={fileRef}
            type="file"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            disabled={busy}
            className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-white/15"
          />
          <p className="mt-1 text-[10px] text-slate-500">PDF, Word, Excel or images, up to {formatBytes(MAX_UPLOAD_BYTES)}.</p>
        </div>
      ) : (
        <div>
          <label className={label}>Link</label>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" className={input} disabled={busy} />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <div>
          <label className={label}>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Q3 2026 trading update" className={input} disabled={busy} />
        </div>
        <div>
          <label className={label}>Type</label>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={input} disabled={busy}>
            {DOC_TYPES.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <p className="text-xs text-rose-300">{error}</p> : null}

      <div className="flex items-center justify-end gap-2">
        {busy && mode === "file" && progress !== null && progress < 1 ? (
          <span className="text-[11px] tabular-nums text-slate-400">Uploading {Math.round(progress * 100)}%</span>
        ) : null}
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-white">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#C6A66B] px-3.5 py-1.5 text-xs font-bold text-[#0F1115] transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Share with partners
        </button>
      </div>
    </div>
  );
}
