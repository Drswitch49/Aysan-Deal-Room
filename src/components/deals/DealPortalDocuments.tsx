/**
 * Partner documents for one acquisition, filed by the Investor Portal Document
 * Standard v1.1: 11 documents in 7 category folders.
 *
 * Every document version moves draft → released. Release is refused with NOT
 * READY and the blockers named until its capital gate is met: the automatic
 * checks (coverage sanction, funds received, completion) plus the written
 * sign-offs recorded here against this exact version. A released version is
 * locked; a correction is a new version that supersedes it, and the old one
 * stays visible to partners marked superseded. Nothing released is deleted.
 *
 * Partners see a folder only once every folder above it is complete for them,
 * and Offer documents only as a view-only copy watermarked with their name.
 *
 * Files go straight from the browser to Cloudinary as authenticated assets; a
 * partner only ever gets a two-minute signed link through a route that re-checks
 * the gate and logs the open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  FilePlus2,
  FileText,
  FolderClosed,
  FolderOpen,
  Link2,
  Loader2,
  Lock,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import {
  addPartnerDocument,
  deletePartnerDocument,
  listPartnerDocuments,
  openPartnerDocument,
  releasePartnerDocument,
  revokePartnerDocument,
  signoffPartnerDocument,
  withdrawSignoff,
  type PartnerDocument,
} from "../../api/admin/partners";
import { formatBytes, MAX_UPLOAD_BYTES, uploadToCloudinary } from "../../api/admin/_shared";
import { formatDate } from "../../lib/portal/format";
import { cx } from "../../utils/cx";
import {
  CATEGORY_INFO,
  DOC_CATEGORIES,
  DOC_TYPES_BY_CATEGORY,
  DOC_TYPE_INFO,
  NOTICE_TYPES,
  NOTICE_TYPE_LABEL,
  SIGNOFFS,
  SIGNOFF_OWNER_LABEL,
  docTypeLabel,
  standardTitle,
  type DocCategory,
  type DocType,
  type SignoffKey,
} from "../../../lib/core/investor-docs";

const input =
  "w-full rounded-lg border border-white/10 bg-acp-ink px-3 py-2 text-sm text-white outline-none transition focus:border-acp-bronze disabled:opacity-60";
const label = "mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500";
const iconBtn =
  "inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-acp-bronze/40 hover:text-white disabled:opacity-40";

export interface DealPartner {
  investor_id: string;
  name: string;
  status: string;
}

export function DealPortalDocuments({
  dealId,
  canManage,
  partners,
  acquisitionNo,
  investable,
}: {
  dealId: string;
  canManage: boolean;
  /** Everyone subscribing to this acquisition, for partner-scoped documents. */
  partners: DealPartner[];
  acquisitionNo: number | null;
  /** Folders are for Active-stage deals only. */
  investable: boolean;
}) {
  const [docs, setDocs] = useState<PartnerDocument[]>([]);
  const [canSignCfo, setCanSignCfo] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Set<DocCategory>>(new Set(["certification"]));

  const load = useCallback(async () => {
    try {
      const res = await listPartnerDocuments({ deal_id: dealId }, { noCache: true });
      setDocs(res.rows);
      setCanSignCfo(res.can_sign_cfo);
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

  const byType = useMemo(() => {
    const map = new Map<string, PartnerDocument[]>();
    for (const d of docs) {
      if (!map.has(d.doc_type)) map.set(d.doc_type, []);
      map.get(d.doc_type)!.push(d);
    }
    return map;
  }, [docs]);

  const legacy = docs.filter((d) => !d.category);

  const toggle = (c: DocCategory) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  return (
    <section className="space-y-3 rounded-2xl border border-white/[0.04] bg-acp-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-acp-bronze" />
          <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">
            Investor portal documents · 11 documents in 7 categories
          </h3>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-500">
        Each document is released only when its capital gate is met; otherwise it shows NOT READY with the blocker
        named. A partner sees a folder only once every folder above it is complete for them. Offer documents are view
        only, and each partner reads a copy watermarked with their name.
      </p>

      {!investable ? (
        <p className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-200">
          Document folders open when this deal is at the Active stage.
        </p>
      ) : null}

      {error ? <p className="rounded border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p> : null}

      {!loaded ? (
        <div className="flex items-center gap-2 py-6 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin text-acp-bronze" /> Loading…
        </div>
      ) : investable ? (
        <div className="space-y-2">
          {DOC_CATEGORIES.map((cat) => {
            const info = CATEGORY_INFO[cat];
            const types = DOC_TYPES_BY_CATEGORY[cat];
            const inFolder = types.flatMap((t) => byType.get(t) ?? []);
            const released = inFolder.filter((d) => d.published_at && !d.revoked_at).length;
            const drafts = inFolder.filter((d) => !d.published_at && !d.revoked_at).length;
            const isOpen = open.has(cat);
            return (
              <div key={cat} className="rounded-xl border border-white/[0.06] bg-white/[0.015]">
                <button
                  type="button"
                  onClick={() => toggle(cat)}
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left"
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                  {isOpen ? <FolderOpen className="h-4 w-4 text-acp-bronze" /> : <FolderClosed className="h-4 w-4 text-acp-bronze" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">
                      {info.n} · {info.label}
                    </p>
                    <p className="text-[11px] text-slate-500">{info.question}</p>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {types.map((t) => DOC_TYPE_INFO[t].code).join(", ")}
                  </span>
                  <span
                    className={cx(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      info.download ? "border-white/10 text-slate-400" : "border-acp-bronze/30 text-acp-bronze",
                    )}
                  >
                    {info.download ? "Partner can download" : "View only, watermarked"}
                  </span>
                  <span className="text-[11px] tabular-nums text-slate-400">
                    {released} released{drafts ? ` · ${drafts} draft${drafts === 1 ? "" : "s"}` : ""}
                  </span>
                </button>

                {isOpen ? (
                  <div className="space-y-3 border-t border-white/[0.06] px-4 py-3">
                    {types.map((t) => (
                      <DocumentSlot
                        key={t}
                        docType={t}
                        docs={byType.get(t) ?? []}
                        dealId={dealId}
                        partners={partners}
                        acquisitionNo={acquisitionNo}
                        canManage={canManage}
                        canSignCfo={canSignCfo}
                        onChanged={load}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {legacy.length ? (
        <div className="rounded-xl border border-white/[0.06] px-4 py-3">
          <p className="text-[11px] font-semibold text-slate-400">Withdrawn: not filed under the standard</p>
          <p className="mb-2 text-[11px] text-slate-500">
            These were shared before the 7 categories existed and have no place in them, so partners no longer see
            them. The files are kept.
          </p>
          {legacy.map((d) => (
            <p key={d.id} className="text-xs text-slate-500 line-through">
              {d.title}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ─── One document slot (e.g. O1 Capital Partner Brief) ─────────────────────

function DocumentSlot({
  docType,
  docs,
  dealId,
  partners,
  acquisitionNo,
  canManage,
  canSignCfo,
  onChanged,
}: {
  docType: DocType;
  docs: PartnerDocument[];
  dealId: string;
  partners: DealPartner[];
  acquisitionNo: number | null;
  canManage: boolean;
  canSignCfo: boolean;
  onChanged: () => Promise<void>;
}) {
  const info = DOC_TYPE_INFO[docType];
  const [adding, setAdding] = useState<{ supersedes?: PartnerDocument } | null>(null);
  const scopeLabel = info.scope === "partner" ? "One per partner" : info.scope === "acquisition" ? "Whole acquisition" : "Partner or acquisition";

  return (
    <div className="rounded-lg border border-white/[0.06] bg-acp-ink/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-acp-bronze/10 px-1.5 py-0.5 text-[10px] font-bold text-acp-bronze">{info.code}</span>
        <p className="text-sm font-semibold text-slate-200">{info.label}</p>
        <span className="text-[10px] text-slate-500">
          {scopeLabel} · Gate owner: {info.gateOwner}
        </span>
        {canManage && !adding ? (
          <button type="button" onClick={() => setAdding({})} className={cx(iconBtn, "ml-auto")}>
            <Upload className="h-3 w-3" /> Add file
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="mt-3">
          <AddDocumentForm
            dealId={dealId}
            docType={docType}
            partners={partners}
            acquisitionNo={acquisitionNo}
            supersedes={adding.supersedes}
            onCancel={() => setAdding(null)}
            onDone={async () => {
              setAdding(null);
              await onChanged();
            }}
          />
        </div>
      ) : null}

      {docs.length ? (
        <ul className="mt-2 divide-y divide-white/5">
          {docs.map((d) => (
            <DocumentVersion
              key={d.id}
              d={d}
              canManage={canManage}
              canSignCfo={canSignCfo}
              onChanged={onChanged}
              onNewVersion={() => setAdding({ supersedes: d })}
            />
          ))}
        </ul>
      ) : !adding ? (
        <p className="mt-2 text-[11px] text-slate-500">Nothing filed yet.</p>
      ) : null}
    </div>
  );
}

// ─── One document version ──────────────────────────────────────────────────

function DocumentVersion({
  d,
  canManage,
  canSignCfo,
  onChanged,
  onNewVersion,
}: {
  d: PartnerDocument;
  canManage: boolean;
  canSignCfo: boolean;
  onChanged: () => Promise<void>;
  onNewVersion: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signing, setSigning] = useState<SignoffKey | null>(null);
  const [reference, setReference] = useState("");

  const released = Boolean(d.published_at);
  const revoked = Boolean(d.revoked_at);
  const superseded = Boolean(d.superseded_by);
  const info = DOC_TYPE_INFO[d.doc_type as DocType];

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await onChanged();
    } catch (err: any) {
      setError(err?.message || "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const view = async () => {
    const tab = window.open("", "_blank");
    try {
      const { url } = await openPartnerDocument(d.id);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err: any) {
      tab?.close();
      setError(err?.message || "Could not open the document.");
    }
  };

  const status = revoked
    ? { text: "Revoked", tone: "border-rose-500/25 bg-rose-500/10 text-rose-300" }
    : superseded
      ? { text: "Superseded", tone: "border-white/10 bg-white/[0.03] text-slate-400" }
      : released
        ? { text: "Released", tone: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" }
        : { text: "Draft", tone: "border-white/10 bg-white/[0.03] text-slate-300" };

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={cx("break-words text-sm", revoked ? "text-slate-500 line-through" : "text-slate-200")}>{d.title}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {[
              d.investors?.name ? `For ${d.investors.name}` : "All partners in this acquisition",
              `v${d.version}`,
              d.doc_type === "partner_notice" ? docTypeLabel(d.doc_type, d.notice_type) : null,
              d.event_date ? `Event ${formatDate(d.event_date)}` : null,
              d.file_name,
              d.file_bytes ? formatBytes(Number(d.file_bytes)) : null,
              !d.cloudinary_public_id && d.file_link ? "Link" : null,
              released ? `Released ${formatDate(d.published_at)}` : `Filed ${formatDate(d.uploaded_at)}`,
              d.category === "offer" && d.copies_issued ? `${d.copies_issued} numbered cop${d.copies_issued === 1 ? "y" : "ies"} issued` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span className={cx("rounded-full border px-2 py-0.5 text-[10px] font-semibold", status.tone)}>{status.text}</span>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => void view()} className={iconBtn} title="Open the original">
            <Eye className="h-3 w-3" /> View
          </button>
          {canManage && !released && !revoked ? (
            <button
              type="button"
              disabled={busy || !d.gate.ready}
              onClick={() => void act(() => releasePartnerDocument(d.id))}
              className={cx(iconBtn, d.gate.ready ? "border-emerald-500/30 text-emerald-300" : "")}
              title={d.gate.ready ? "Release to partners" : "NOT READY: see the blockers below"}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Release
            </button>
          ) : null}
          {canManage && released && !revoked && !superseded ? (
            <button type="button" disabled={busy} onClick={onNewVersion} className={iconBtn} title="Issue a correction as a new version">
              <FilePlus2 className="h-3 w-3" /> New version
            </button>
          ) : null}
          {canManage && released ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => revokePartnerDocument(d.id, !revoked))}
              className={iconBtn}
              title={revoked ? "Give partners access again" : "Hide from every partner, keep the file"}
            >
              {revoked ? <RotateCcw className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
              {revoked ? "Restore" : "Revoke"}
            </button>
          ) : null}
          {canManage && !released ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Delete the draft “${d.title}”? The file is removed.`)) return;
                void act(() => deletePartnerDocument(d.id));
              }}
              className={cx(iconBtn, "hover:border-rose-500/40 hover:text-rose-300")}
              title="Delete this draft and its file"
            >
              <Trash2 className="h-3 w-3" /> Delete draft
            </button>
          ) : null}
        </div>
      </div>

      {/* Gate */}
      {!revoked ? (
        <div
          className={cx(
            "rounded-lg border px-3 py-2",
            d.gate.ready ? "border-emerald-500/20 bg-emerald-500/[0.04]" : "border-amber-500/25 bg-amber-500/[0.05]",
          )}
        >
          <p className={cx("flex items-center gap-1.5 text-[11px] font-bold", d.gate.ready ? "text-emerald-300" : "text-amber-200")}>
            {d.gate.ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {d.gate.ready ? (released ? "Gate met" : "READY to release") : released ? "NOT READY: held back from partners" : "NOT READY"}
          </p>
          {released && !d.gate.ready && !superseded ? (
            <p className="mt-1 text-[11px] text-amber-100/80">
              This version was released before its gate was met, so partners do not see it. A released version is locked:
              issue a new version and record its sign-offs there.
            </p>
          ) : null}
          {d.gate.blockers.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11px] text-amber-100/90">
              {d.gate.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
          {[...d.gate.warnings, ...d.partner_blockers].map((w) => (
            <p key={w} className="mt-1 text-[11px] text-amber-200/80">
              {w}
            </p>
          ))}

          {info?.signoffs.length ? (
            <div className="mt-2 space-y-1.5 border-t border-white/[0.06] pt-2">
              {info.signoffs.map((key) => {
                const def = SIGNOFFS[key];
                const rec = d.signoffs?.[key];
                const mayRecord = canManage && (def.owner !== "cfo" || canSignCfo);
                return (
                  <div key={key} className="text-[11px]">
                    <div className="flex flex-wrap items-center gap-2">
                      {rec ? (
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
                      ) : (
                        <Lock className="h-3.5 w-3.5 text-slate-500" />
                      )}
                      <span className={rec ? "text-slate-200" : "text-slate-400"}>{def.label}</span>
                      <span className="text-slate-500">({SIGNOFF_OWNER_LABEL[def.owner]})</span>
                      {rec ? (
                        <span className="text-slate-500">
                          · {rec.reference} · {rec.by}, {formatDate(rec.at)}
                        </span>
                      ) : null}
                      {!released && rec && mayRecord ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void act(() => withdrawSignoff(d.id, key))}
                          className="text-slate-500 underline hover:text-slate-300"
                        >
                          Withdraw
                        </button>
                      ) : null}
                      {!released && !rec && mayRecord && signing !== key ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSigning(key);
                            setReference("");
                          }}
                          className="font-semibold text-acp-bronze hover:underline"
                        >
                          Record
                        </button>
                      ) : null}
                      {!released && !rec && !mayRecord && def.owner === "cfo" ? (
                        <span className="text-slate-600">CFO login only</span>
                      ) : null}
                    </div>
                    {signing === key ? (
                      <div className="mt-1.5 flex flex-wrap gap-2 pl-5">
                        <input
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          placeholder={
                            def.owner === "cfo" ? "Where it is recorded, e.g. CFO memo 14 Oct" : "Legal counsel's approval, e.g. email 14 Oct, ref LC-22"
                          }
                          className={cx(input, "min-w-[220px] flex-1 py-1.5 text-xs")}
                        />
                        <button
                          type="button"
                          disabled={busy || reference.trim().length < 3}
                          onClick={() =>
                            void act(async () => {
                              await signoffPartnerDocument(d.id, key, reference.trim());
                              setSigning(null);
                            })
                          }
                          className="rounded-lg bg-acp-bronze px-3 py-1.5 text-xs font-bold text-acp-on-accent disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button type="button" onClick={() => setSigning(null)} className="px-2 text-xs text-slate-400 hover:text-white">
                          Cancel
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
    </li>
  );
}

// ─── Filing a document ─────────────────────────────────────────────────────

function AddDocumentForm({
  dealId,
  docType,
  partners,
  acquisitionNo,
  supersedes,
  onCancel,
  onDone,
}: {
  dealId: string;
  docType: DocType;
  partners: DealPartner[];
  acquisitionNo: number | null;
  /** Set when issuing a correction of a released version. */
  supersedes?: PartnerDocument;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const info = DOC_TYPE_INFO[docType];
  const isOffer = info.category === "offer";
  const version = supersedes ? Number(supersedes.version) + 1 : 1;

  const [mode, setMode] = useState<"file" | "link">("file");
  const [investorId, setInvestorId] = useState<string>(
    supersedes ? (supersedes.investor_id ?? "") : info.scope === "partner" ? (partners[0]?.investor_id ?? "") : "",
  );
  const [noticeType, setNoticeType] = useState<string>(supersedes?.notice_type ?? "material_event");
  const [eventDate, setEventDate] = useState<string>(supersedes?.event_date ?? "");
  const [title, setTitle] = useState(() =>
    standardTitle({ acquisitionNo, docType, noticeType: supersedes?.notice_type ?? "material_event", date: new Date(), version }),
  );
  const [titleTouched, setTitleTouched] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Keep the standard title in step with the notice type until someone edits it.
  useEffect(() => {
    if (!titleTouched) setTitle(standardTitle({ acquisitionNo, docType, noticeType, date: new Date(), version }));
  }, [noticeType, titleTouched, acquisitionNo, docType, version]);

  const pick = (f: File | null) => {
    setError("");
    if (f && f.size > MAX_UPLOAD_BYTES) {
      setError(`"${f.name}" is ${formatBytes(f.size)}. The document store takes files up to ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      setFile(null);
      return;
    }
    if (f && isOffer && !/\.pdf$/i.test(f.name)) {
      setError("Offer documents must be a PDF, so each partner's copy can be watermarked.");
      setFile(null);
      return;
    }
    setFile(f);
  };

  const submit = async (release: boolean) => {
    setError("");
    if (!title.trim()) return setError("Give the document a title.");
    if (info.scope === "partner" && !investorId && !supersedes) {
      return setError("This document is issued to one partner. Choose the partner.");
    }
    if (mode === "file" && !file) return setError("Choose a file to upload.");
    if (mode === "link" && !/^https?:\/\//i.test(link.trim())) return setError("Enter a full link starting with https://");
    if (docType === "partner_notice" && !eventDate) return setError("Record the date of the triggering event.");

    try {
      const base: Record<string, unknown> = {
        deal_id: dealId,
        investor_id: investorId || null,
        doc_type: docType,
        title: title.trim(),
        supersedes_id: supersedes?.id ?? null,
        release,
      };
      if (docType === "partner_notice") {
        base.notice_type = noticeType;
        base.event_date = eventDate;
      }
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
      // If the gate was not met it is kept as a draft, and the gate panel
      // under it names what is missing.
      await onDone();
    } catch (err: any) {
      setError(err?.message || "Could not file the document.");
      setProgress(null);
    }
  };

  const busy = progress !== null;

  return (
    <div className="space-y-3 rounded-xl border border-acp-bronze/20 bg-acp-bronze/[0.03] p-4">
      <p className="text-xs font-semibold text-slate-200">
        {supersedes ? `Correction: ${info.code} ${info.label}, version ${version}` : `File ${info.code} ${info.label}`}
      </p>
      {supersedes ? (
        <p className="text-[11px] text-slate-500">
          Version {supersedes.version} stays visible to partners, marked superseded. This version needs its own sign-offs.
        </p>
      ) : null}

      {!isOffer ? (
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
                mode === m ? "border-acp-bronze/50 bg-acp-bronze/10 text-acp-bronze" : "border-white/10 text-slate-400 hover:text-white",
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {text}
            </button>
          ))}
        </div>
      ) : null}

      {mode === "file" ? (
        <div>
          <label className={label}>File</label>
          <input
            ref={fileRef}
            type="file"
            accept={isOffer ? "application/pdf,.pdf" : undefined}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            disabled={busy}
            className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-white/15"
          />
          <p className="mt-1 text-[10px] text-slate-500">
            {isOffer ? "PDF only. Each partner receives a numbered copy watermarked with their name." : "PDF, Word, Excel or images"}, up
            to {formatBytes(MAX_UPLOAD_BYTES)}.
          </p>
        </div>
      ) : (
        <div>
          <label className={label}>Link</label>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" className={input} disabled={busy} />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Issued to</label>
          <select
            value={investorId}
            onChange={(e) => setInvestorId(e.target.value)}
            className={input}
            disabled={busy || Boolean(supersedes)}
          >
            {info.scope !== "partner" || (supersedes && !supersedes.investor_id) ? (
              <option value="">Every partner in this acquisition</option>
            ) : null}
            {info.scope === "partner" && !partners.length ? <option value="">No partners subscribing yet</option> : null}
            {partners.map((p) => (
              <option key={p.investor_id} value={p.investor_id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {docType === "partner_notice" ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Notice type</label>
              <select value={noticeType} onChange={(e) => setNoticeType(e.target.value)} className={input} disabled={busy}>
                {NOTICE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {NOTICE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Event date</label>
              <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className={input} disabled={busy} />
            </div>
          </div>
        ) : null}
      </div>

      <div>
        <label className={label}>Title</label>
        <input
          value={title}
          onChange={(e) => {
            setTitleTouched(true);
            setTitle(e.target.value);
          }}
          className={input}
          disabled={busy}
        />
        <p className="mt-1 text-[10px] text-slate-500">
          Standard naming: Acquisition nn · Document name · YYYY-MM-DD · vn.
          {acquisitionNo ? "" : " Set the acquisition number under “How partners see it” to fill in nn."}
        </p>
      </div>

      {error ? <p className="text-xs text-rose-300">{error}</p> : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {busy && mode === "file" && progress !== null && progress < 1 ? (
          <span className="text-[11px] tabular-nums text-slate-400">Uploading {Math.round(progress * 100)}%</span>
        ) : null}
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-white">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit(false)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-acp-bronze/40 disabled:opacity-50"
        >
          Save as draft
        </button>
        <button
          type="button"
          onClick={() => void submit(true)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-acp-bronze px-3.5 py-1.5 text-xs font-bold text-acp-on-accent transition hover:brightness-110 disabled:opacity-50"
          title="Released only if the gate is met; otherwise kept as a draft with the blockers named"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Save and release if ready
        </button>
      </div>
    </div>
  );
}
