/**
 * Quarterly reports — schedule, upload and send each deal's report to the
 * capital partners in it.
 *
 * A report is a period (Q3 2026), the date it publishes, ACP's one-line
 * trading summary, the coverage status at period end, and its files: the
 * report itself and, optionally, the covenant certificate. Files go straight
 * from the browser to Cloudinary; the server turns each into a deal-wide
 * partner document tied to the report.
 *
 * "Publish & send" makes it visible to every partner with a completed
 * commitment in the deal, writes their feed line and emails them (no figures
 * in the email). "Schedule" keeps it as a draft partners see only as
 * "Publishes <date>", with no summary, coverage or file until it is sent.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eye, FileText, Loader2, Plus, Send, Trash2, Upload } from "lucide-react";
import {
  createDealReport,
  deleteDealReport,
  listCommitments,
  listDealReports,
  openPartnerDocument,
  updateDealReport,
  type ReportFile,
  type ReportNotified,
} from "../../api/admin/partners";
import { formatBytes, MAX_UPLOAD_BYTES, uploadToCloudinary } from "../../api/admin/_shared";
import { COVERAGE_LABEL, formatDate } from "../../lib/portal/format";
import { IN_PORTAL, dealLabel } from "../../lib/portal/commitments";
import { cx } from "../../utils/cx";

const input =
  "w-full rounded-lg border border-white/10 bg-[#0F1115] px-3 py-2 text-sm text-white outline-none transition focus:border-[#C6A66B] disabled:opacity-60";
const label = "mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500";
const smallBtn =
  "inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-[#C6A66B]/40 hover:text-white disabled:opacity-40";

const COVERAGE_OPTIONS = ["not_yet_reported", "above_floor", "watch", "breach"] as const;

interface DealWithPartners {
  id: string;
  name: string;
  ref: string | null;
  partners: number;
}

/** The quarter that most recently ended, e.g. "Q3 2026" on 25 Oct 2026. */
function lastQuarterLabel(now = new Date()): string {
  const q = Math.floor(now.getMonth() / 3); // current quarter, 0-based
  return q === 0 ? `Q4 ${now.getFullYear() - 1}` : `Q${q} ${now.getFullYear()}`;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Message for what a publish actually did. */
function notifiedText(n: ReportNotified | null | undefined): string {
  if (!n) return "Published.";
  if (n.partners === 0) return "Published — no partner holds a completed commitment in this deal yet, so nobody was notified.";
  const base = `Published to ${n.partners} partner${n.partners === 1 ? "" : "s"}; ${n.emailed} email${n.emailed === 1 ? "" : "s"} sent.`;
  return n.failed.length ? `${base} Not emailed: ${n.failed.join("; ")}` : base;
}

export function QuarterlyReportsTab({ canManage }: { canManage: boolean }) {
  const [reports, setReports] = useState<Array<Record<string, any>>>([]);
  const [deals, setDeals] = useState<DealWithPartners[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([listDealReports(), listCommitments({})]);
      setReports(r.rows);
      // Reports go to partners with a completed commitment, so only those
      // deals are offered.
      const byDeal = new Map<string, DealWithPartners & { seen: Set<string> }>();
      for (const row of c.rows) {
        if (!IN_PORTAL.has(row.status) || !row.deals?.id) continue;
        const entry =
          byDeal.get(row.deals.id) ??
          { id: row.deals.id, name: dealLabel(row.deals), ref: row.deals.acp_ref_no ?? null, partners: 0, seen: new Set<string>() };
        if (!entry.seen.has(row.investor_id)) {
          entry.seen.add(row.investor_id);
          entry.partners += 1;
        }
        byDeal.set(row.deals.id, entry);
      }
      setDeals(Array.from(byDeal.values()).map(({ seen: _seen, ...d }) => d));
      setError("");
    } catch (err: any) {
      setError(err?.message || "Could not load quarterly reports.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const partnersIn = useMemo(() => new Map(deals.map((d) => [d.id, d.partners])), [deals]);

  const act = async (id: string, fn: () => Promise<string | void>) => {
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      await load();
    } catch (err: any) {
      setError(err?.message || "That did not work.");
    } finally {
      setBusyId(null);
    }
  };

  const view = async (docId: string) => {
    const tab = window.open("", "_blank");
    try {
      const { url } = await openPartnerDocument(docId);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err: any) {
      tab?.close();
      setError(err?.message || "Could not open the file.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs text-slate-400">
          Upload each deal's quarterly report and send it to the capital partners in that deal. They are emailed that it
          is available, and it appears under Reporting and Documents in their portal.
        </p>
        {canManage && !adding ? (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setNotice("");
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#C6A66B] px-3 py-1.5 text-xs font-bold text-[#0F1115] transition hover:brightness-110"
          >
            <Plus className="h-3.5 w-3.5" /> New quarterly report
          </button>
        ) : null}
      </div>

      {adding ? (
        <NewReportForm
          deals={deals}
          onCancel={() => setAdding(false)}
          onDone={async (msg) => {
            setAdding(false);
            setNotice(msg);
            await load();
          }}
        />
      ) : null}

      {notice ? (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-xs text-emerald-200">
          <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" /> {notice}
        </p>
      ) : null}
      {error ? <p className="rounded border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p> : null}

      {!loaded ? (
        <div className="flex items-center gap-2 py-10 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin text-[#C6A66B]" /> Loading reports…
        </div>
      ) : reports.length === 0 && !adding ? (
        <div className="rounded-xl border border-dashed border-white/10 px-6 py-10 text-center">
          <FileText className="mx-auto h-6 w-6 text-slate-600" />
          <p className="mt-2 text-sm text-slate-300">No quarterly reports yet.</p>
          <p className="mt-1 text-xs text-slate-500">
            {deals.length
              ? "Create one to upload the report and send it to the partners in that deal."
              : "Reports can be sent once a partner's commitment to a deal is marked completed."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.04] overflow-hidden rounded-xl border border-white/[0.04]">
          {reports.map((r) => {
            const published = Boolean(r.published_at);
            const files = ((r.investor_documents ?? []) as Array<Record<string, any>>).filter((d) => !d.revoked_at);
            const busy = busyId === r.id;
            const partners = partnersIn.get(r.deal_id) ?? 0;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 bg-white/[0.01] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">
                    {r.period_label} <span className="font-normal text-slate-400">· {dealLabel(r.deals)}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {[
                      r.deals?.acp_ref_no,
                      r.coverage_at_period ? `Coverage: ${COVERAGE_LABEL[r.coverage_at_period as keyof typeof COVERAGE_LABEL] ?? r.coverage_at_period}` : null,
                      `${partners} partner${partners === 1 ? "" : "s"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {r.trading_summary ? <p className="mt-1 line-clamp-2 text-xs text-slate-400">{r.trading_summary}</p> : null}
                  {files.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {files.map((f) => (
                        <button key={f.id} type="button" onClick={() => void view(f.id)} className={smallBtn}>
                          <Eye className="h-3 w-3" /> {f.doc_type === "covenant_certificate" ? "Certificate" : "Report"}
                          {f.file_bytes ? <span className="text-slate-500">· {formatBytes(Number(f.file_bytes))}</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-amber-300/80">No file attached.</p>
                  )}
                </div>

                <span
                  className={cx(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                    published
                      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                      : "border-[#C6A66B]/30 bg-[#C6A66B]/10 text-[#C6A66B]",
                  )}
                >
                  {published ? `Sent ${formatDate(r.published_at)}` : `Draft · publishes ${formatDate(r.publishes_on)}`}
                </span>

                {canManage && !published ? (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Publish ${r.period_label} and email the ${partners} partner(s) in this deal now?`)) return;
                        void act(r.id, async () => notifiedText((await updateDealReport({ id: r.id, publish: true })).notified));
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#C6A66B] px-2.5 py-1 text-[11px] font-bold text-[#0F1115] transition hover:brightness-110 disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Publish & send
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Delete the draft ${r.period_label} report and its files?`)) return;
                        void act(r.id, async () => {
                          await deleteDealReport(r.id);
                          return "Draft deleted.";
                        });
                      }}
                      className={cx(smallBtn, "hover:border-rose-500/40 hover:text-rose-300")}
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FileField({
  title,
  hint,
  file,
  onPick,
  disabled,
}: {
  title: string;
  hint: string;
  file: File | null;
  onPick: (f: File | null) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <label className={label}>{title}</label>
      <input
        type="file"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        disabled={disabled}
        className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-white/15"
      />
      <p className="mt-1 text-[10px] text-slate-500">{file ? `${file.name} · ${formatBytes(file.size)}` : hint}</p>
    </div>
  );
}

function NewReportForm({
  deals,
  onCancel,
  onDone,
}: {
  deals: DealWithPartners[];
  onCancel: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [dealId, setDealId] = useState(deals[0]?.id ?? "");
  const [period, setPeriod] = useState(lastQuarterLabel());
  const [publishesOn, setPublishesOn] = useState(today());
  const [summary, setSummary] = useState("");
  const [coverage, setCoverage] = useState<string>("");
  const [nextReport, setNextReport] = useState("");
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");

  const pick = (set: (f: File | null) => void) => (f: File | null) => {
    setError("");
    if (f && f.size > MAX_UPLOAD_BYTES) {
      setError(`"${f.name}" is ${formatBytes(f.size)} — the document store takes files up to ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      return set(null);
    }
    set(f);
  };

  const upload = async (f: File, what: string): Promise<ReportFile> => {
    setStage(`Uploading ${what}…`);
    const asset = await uploadToCloudinary(f.name, f.type || "application/octet-stream", f, "aysan-deal-room/partner-reports", (p) =>
      setStage(`Uploading ${what} ${Math.round(p * 100)}%`),
    );
    return {
      public_id: asset.publicId,
      resource_type: asset.resourceType,
      format: asset.format ?? null,
      name: f.name,
      bytes: asset.bytes ?? f.size,
    };
  };

  const submit = async (publish: boolean) => {
    setError("");
    const deal = deals.find((d) => d.id === dealId);
    if (!deal) return setError("Choose the deal this report is for.");
    if (!period.trim()) return setError("Give the period, e.g. Q3 2026.");
    if (!publishesOn) return setError("Set the date it publishes.");
    if (publish && !reportFile) return setError("Attach the report file before sending it.");
    if (
      publish &&
      !window.confirm(
        `Send the ${period.trim()} report for ${deal.name} to ${deal.partners} partner${deal.partners === 1 ? "" : "s"} now? They will be emailed.`,
      )
    )
      return;

    try {
      const report_file = reportFile ? await upload(reportFile, "report") : null;
      const certificate_file = certFile ? await upload(certFile, "certificate") : null;
      setStage(publish ? "Sending…" : "Saving…");
      const res = await createDealReport({
        deal_id: dealId,
        period_label: period.trim(),
        publishes_on: publishesOn,
        trading_summary: summary.trim() || null,
        coverage_at_period: coverage || null,
        report_file,
        certificate_file,
        publish,
        next_report_date: nextReport || undefined,
      });
      await onDone(publish ? notifiedText(res.notified) : `${period.trim()} saved as a draft. Partners see it as “Publishes ${formatDate(publishesOn)}”.`);
    } catch (err: any) {
      setError(err?.message || "Could not save the report.");
      setStage("");
    }
  };

  const busy = stage !== "";

  if (deals.length === 0) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-xs text-amber-200">
        No deal has a capital partner with a completed commitment yet, so there is nobody to send a report to.{" "}
        <button type="button" onClick={onCancel} className="underline">
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-[#C6A66B]/20 bg-[#C6A66B]/[0.03] p-4">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <div>
          <label className={label}>Deal</label>
          <select value={dealId} onChange={(e) => setDealId(e.target.value)} className={input} disabled={busy}>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.ref ? ` (${d.ref})` : ""} · {d.partners} partner{d.partners === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Period</label>
          <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="Q3 2026" className={input} disabled={busy} />
        </div>
        <div>
          <label className={label}>Publishes on</label>
          <input type="date" value={publishesOn} onChange={(e) => setPublishesOn(e.target.value)} className={input} disabled={busy} />
        </div>
      </div>

      <div>
        <label className={label}>Trading summary</label>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={2}
          placeholder="One or two plain sentences on the quarter, written by ACP. No projections."
          className={cx(input, "resize-y leading-relaxed")}
          disabled={busy}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Coverage at period end</label>
          <select value={coverage} onChange={(e) => setCoverage(e.target.value)} className={input} disabled={busy}>
            <option value="">Not stated</option>
            {COVERAGE_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {COVERAGE_LABEL[c as keyof typeof COVERAGE_LABEL] ?? c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Next report due (optional)</label>
          <input type="date" value={nextReport} onChange={(e) => setNextReport(e.target.value)} className={input} disabled={busy} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FileField
          title="Quarterly report"
          hint={`PDF or Word, up to ${formatBytes(MAX_UPLOAD_BYTES)}. Required to send.`}
          file={reportFile}
          onPick={pick(setReportFile)}
          disabled={busy}
        />
        <FileField
          title="Covenant certificate (optional)"
          hint="The signed certificate for the period, if there is one."
          file={certFile}
          onPick={pick(setCertFile)}
          disabled={busy}
        />
      </div>

      {error ? <p className="text-xs text-rose-300">{error}</p> : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {busy ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <Loader2 className="h-3 w-3 animate-spin" /> {stage}
          </span>
        ) : null}
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-white">
          Cancel
        </button>
        <button type="button" onClick={() => void submit(false)} disabled={busy} className={cx(smallBtn, "px-3 py-1.5 text-xs")}>
          <Upload className="h-3.5 w-3.5" /> Save as draft
        </button>
        <button
          type="button"
          onClick={() => void submit(true)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#C6A66B] px-3.5 py-1.5 text-xs font-bold text-[#0F1115] transition hover:brightness-110 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" /> Publish & send
        </button>
      </div>
    </div>
  );
}
