/**
 * Post-call tab — the ACP Post-Call Scorecard.
 *
 * Reads a call transcript or manual notes and shows one scorecard per run:
 * verdict (Kill / Price / Condition / Proceed to info request), completeness,
 * the eight hard gates, every field with its value/status/source/box/next
 * action, and the info request with its broker email draft.
 *
 * Runs are never edited: each new transcript or note queues a new run stamped
 * with the Playbook config version it used. Thresholds and the DSCR sanction
 * are Dami's (admin-only) and are set in the controls strip, never here in code.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, Copy, FileText,
  Loader2, Lock, Plus, RefreshCw, Send, ShieldCheck, Upload, XCircle,
} from "lucide-react";
import { cx } from "../../utils/cx";
import { Modal } from "../ui/Modal";
import { useAuth } from "../../context/AuthContext";
import {
  fetchPostcallRuns, runPostcallScorecard, fetchPlaybookVersions, createPlaybookVersion,
  fetchPostcallControls, updatePostcallControls, fetchPrecallBriefs, watchJob,
  type PostcallRun, type PostcallControls,
} from "../../api/admin";
import {
  GATES, POSTCALL_FIELDS, SECTIONS, PLAYBOOK_KEYS,
  type FieldBox, type FieldStatus, type GateResult, type PlaybookConfig, type PlaybookKey,
  type Scorecard, type Verdict,
} from "../../lib/acp/postcallSpec";

const ADMIN_ROLES = ["owner", "managing_partner", "partner", "admin"];

/** The slice of the deal view model this tab reads. */
interface DealLike {
  id: string;
  rawFields?: Record<string, unknown>;
}

type ComposerOpts = { type: "email"; recipientName?: string; recipientEmail?: string; subject?: string; body?: string; generatedBy?: string };

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const normRole = (r?: string) => (r ?? "").toLowerCase().replace(/[\s-]+/g, "_");

const VERDICT_STYLE: Record<Verdict, string> = {
  Kill: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  Price: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  Condition: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  "Proceed to info request": "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
};

const GATE_STYLE: Record<GateResult, string> = {
  pass: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  fail: "bg-rose-500/10 text-rose-300 border-rose-500/20",
  vendor: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  unknown: "bg-white/[0.03] text-slate-400 border-white/10",
};

const STATUS_STYLE: Record<FieldStatus, string> = {
  verified: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  filed: "bg-sky-500/10 text-sky-300 border-sky-500/20",
  vendor: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  estimated: "bg-violet-500/10 text-violet-300 border-violet-500/20",
  unknown: "bg-white/[0.03] text-slate-500 border-white/10",
};

const BOX_STYLE: Record<FieldBox, string> = {
  kill: "text-rose-300",
  price: "text-amber-300",
  condition: "text-sky-300",
  none: "text-slate-600",
};

const ADJUSTMENT_TEXT: Record<string, string> = {
  inputs_unknown: "Can't pass: inputs unknown",
  threshold_unset: "Can't pass: Playbook threshold not set",
  below_recurring_gate: "Recurring share below recurring_gate",
  mainly_b2c: "Mainly B2C",
  loss_making: "Maintainable EBITDA not positive",
  below_ebitda_band: "Below ebitda_band",
  above_ebitda_band: "Above ebitda_band",
  above_concentration_bands: "Above concentration bands",
  founder_dependency_priced: "Founder dependency moved to Price (manager installable)",
  hard_kill_confirmed: "Hard kill confirmed",
};

const LOI_BLOCKER_TEXT: Record<string, string> = {
  dscr_sanction_missing: "DSCR sanction not recorded",
  verdict_kill: "Verdict is Kill",
  debtors_missing: "Aged debtors missing",
};

const PLAYBOOK_LABELS: Record<PlaybookKey, string> = {
  recurring_gate_pct: "recurring_gate (%)",
  ebitda_band_min_gbp: "ebitda_band min (£)",
  ebitda_band_max_gbp: "ebitda_band max (£)",
  concentration_largest_pct: "concentration_largest (%)",
  concentration_top3_pct: "concentration_top3 (%)",
  accreditation_stay_months: "accreditation_stay_months",
  manager_install_days: "manager_install_days",
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString("en-GB");
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    if (!v.length) return "—";
    return v.map((item) => (item && typeof item === "object" ? Object.values(item).filter((x) => x != null && x !== "").join(" · ") : String(item))).join("\n");
  }
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x != null)
      .map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : String(x)}`)
      .join("\n");
  }
  return String(v);
}

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </span>
  );
}

const card = "rounded-2xl border border-white/[0.04] bg-[#161B22] p-5";
const heading = "text-[10px] font-extrabold uppercase tracking-wider text-slate-400";
const btnGhost = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:text-white hover:bg-white/[0.03] transition cursor-pointer disabled:opacity-50";
const btnGold = "inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#C6A66B] hover:bg-[#B8924F] text-slate-950 px-3 text-[10px] font-black uppercase tracking-wider transition cursor-pointer disabled:opacity-50";
const input = "h-9 w-full rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 text-xs text-white outline-none focus:border-[#C6A66B]";

export function PostCallScorecardTab({
  deal,
  onVerdictChange,
  openComposer,
}: {
  deal: DealLike;
  onVerdictChange: (verdict: string) => void;
  openComposer: (opts: ComposerOpts) => void;
}) {
  const { user } = useAuth();
  const isAdmin = ADMIN_ROLES.includes(normRole(user?.role));

  const [runs, setRuns] = useState<PostcallRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"view" | "new">("view");

  const [versions, setVersions] = useState<PlaybookConfig[]>([]);
  const [controls, setControls] = useState<PostcallControls | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    const [r, v, c] = await Promise.all([
      fetchPostcallRuns(deal.id),
      fetchPlaybookVersions().catch(() => [] as PlaybookConfig[]),
      fetchPostcallControls(deal.id).catch(() => null),
    ]);
    setRuns(r);
    setVersions(v);
    setControls(c);
    return r;
  }, [deal.id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load()
      .then((r) => {
        if (!active) return;
        setSelectedId(r[0]?.id ?? null);
        setMode(r.length ? "view" : "new");
      })
      .catch((err) => active && setErrorMsg(errText(err, "Failed to load post-call runs.")))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [load]);

  const selected = runs.find((r) => r.id === selectedId) ?? null;
  const activeConfig = versions[0] ?? null;

  useEffect(() => {
    onVerdictChange(runs[0]?.scorecard?.verdict ?? (runs.length ? "Legacy" : "Pending"));
  }, [runs, onVerdictChange]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3">
        <Loader2 className="h-8 w-8 text-[#C6A66B] animate-spin" />
        <p className="text-xs text-slate-400">Loading post-call scorecards…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans animate-fade-in-up">
      <ControlsStrip
        deal={deal}
        isAdmin={isAdmin}
        activeConfig={activeConfig}
        versions={versions}
        controls={controls}
        onVersionCreated={(v) => setVersions((prev) => [v, ...prev])}
        onControlsChange={setControls}
      />

      {errorMsg && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">{errorMsg}</div>}

      {mode === "new" || !selected ? (
        <NewRunForm
          deal={deal}
          activeConfig={activeConfig}
          canCancel={runs.length > 0}
          onCancel={() => setMode("view")}
          onDone={async () => {
            const r = await load();
            setSelectedId(r[0]?.id ?? null);
            setMode("view");
          }}
        />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 shrink-0">Run</span>
              <select
                value={selected.id}
                onChange={(e) => setSelectedId(e.target.value)}
                className="h-9 min-w-0 max-w-full rounded-xl border border-white/[0.04] bg-[#161B22] px-3 text-xs text-white outline-none focus:border-[#C6A66B] cursor-pointer"
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.scorecard ? `${r.scorecard.verdict} · ` : "Legacy · "}
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" onClick={() => setMode("new")} className={btnGhost}>
              <Plus className="h-3.5 w-3.5" /> New run
            </button>
          </div>

          {selected.scorecard ? (
            <RunView run={selected} sc={selected.scorecard} deal={deal} controls={controls} openComposer={openComposer} />
          ) : (
            <LegacyRunView run={selected} />
          )}
        </>
      )}
    </div>
  );
}

// ─── Controls: Playbook config + per-deal band and DSCR sanction ───────────
function ControlsStrip({
  deal, isAdmin, activeConfig, versions, controls, onVersionCreated, onControlsChange,
}: {
  deal: DealLike;
  isAdmin: boolean;
  activeConfig: PlaybookConfig | null;
  versions: PlaybookConfig[];
  controls: PostcallControls | null;
  onVersionCreated: (v: PlaybookConfig) => void;
  onControlsChange: (c: PostcallControls) => void;
}) {
  const [configOpen, setConfigOpen] = useState(false);
  const [sanctionOpen, setSanctionOpen] = useState(false);
  const [bandDraft, setBandDraft] = useState("");
  const [savingBand, setSavingBand] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setBandDraft(controls?.institutional_band_pct == null ? "" : String(controls.institutional_band_pct));
  }, [controls?.institutional_band_pct]);

  const unset = activeConfig ? PLAYBOOK_KEYS.filter((k) => activeConfig[k] == null) : [...PLAYBOOK_KEYS];

  const saveBand = async () => {
    setSavingBand(true);
    setErr("");
    try {
      const v = bandDraft.trim() === "" ? null : Number(bandDraft);
      if (v != null && (!Number.isFinite(v) || v < 0 || v > 100)) throw new Error("Institutional band must be 0-100.");
      onControlsChange(await updatePostcallControls(deal.id, { institutional_band_pct: v }));
    } catch (e) {
      setErr(errText(e, "Failed to save the institutional band."));
    } finally {
      setSavingBand(false);
    }
  };

  const sanctioned = Boolean(controls?.dscr_sanctioned_at);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className={cx(card, "space-y-2")}>
        <div className="flex items-center justify-between gap-2">
          <h3 className={heading}>Playbook config</h3>
          <button type="button" onClick={() => setConfigOpen(true)} className="text-[10px] font-black uppercase text-[#C6A66B] hover:underline cursor-pointer">
            {isAdmin ? "View / new version" : "View"}
          </button>
        </div>
        <p className="text-sm font-bold text-white">{activeConfig ? `Version ${activeConfig.version}` : "No config"}</p>
        {unset.length > 0 ? (
          <p className="text-[11px] text-amber-300 leading-relaxed">
            {unset.length} of {PLAYBOOK_KEYS.length} thresholds not set. Gates that depend on them return unknown until the Playbook values are entered.
          </p>
        ) : (
          <p className="text-[11px] text-slate-500">All thresholds set.</p>
        )}
      </div>

      <div className={cx(card, "space-y-2")}>
        <h3 className={heading}>Institutional band (this deal)</h3>
        {isAdmin ? (
          <div className="flex items-center gap-2">
            <input value={bandDraft} onChange={(e) => setBandDraft(e.target.value)} placeholder="Not set" inputMode="decimal" className={input} aria-label="Institutional band percent" />
            <span className="text-xs text-slate-500">%</span>
            <button type="button" onClick={saveBand} disabled={savingBand} className={btnGhost}>
              {savingBand ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
            </button>
          </div>
        ) : (
          <p className="text-sm font-bold text-white">{controls?.institutional_band_pct == null ? "Not set" : `${controls.institutional_band_pct}%`}</p>
        )}
        <p className="text-[11px] text-slate-500">Gate 4 allowance for an institutional largest customer. Set by Dami per deal; applies to new runs.</p>
        {err && <p className="text-[11px] text-rose-300">{err}</p>}
      </div>

      <div className={cx(card, "space-y-2")}>
        <div className="flex items-center justify-between gap-2">
          <h3 className={heading}>DSCR sanction</h3>
          {isAdmin && (
            <button type="button" onClick={() => setSanctionOpen(true)} className="text-[10px] font-black uppercase text-[#C6A66B] hover:underline cursor-pointer">
              {sanctioned ? "Withdraw" : "Record"}
            </button>
          )}
        </div>
        {sanctioned ? (
          <>
            <p className="flex items-center gap-1.5 text-sm font-bold text-emerald-300"><ShieldCheck className="h-4 w-4" /> Sanctioned</p>
            <p className="text-[11px] text-slate-500">
              {controls?.dscr_sanctioned_by} · {new Date(controls!.dscr_sanctioned_at!).toLocaleString("en-GB")}
              {controls?.dscr_sanction_note ? ` · ${controls.dscr_sanction_note}` : ""}
            </p>
          </>
        ) : (
          <>
            <p className="flex items-center gap-1.5 text-sm font-bold text-slate-300"><Lock className="h-4 w-4" /> Not recorded</p>
            <p className="text-[11px] text-slate-500">loi_ready stays false, and broker emails may not carry £, percentages or structure.</p>
          </>
        )}
      </div>

      <PlaybookModal isOpen={configOpen} onClose={() => setConfigOpen(false)} isAdmin={isAdmin} versions={versions} onCreated={onVersionCreated} />
      <SanctionModal isOpen={sanctionOpen} onClose={() => setSanctionOpen(false)} deal={deal} sanctioned={sanctioned} onSaved={onControlsChange} />
    </div>
  );
}

function PlaybookModal({
  isOpen, onClose, isAdmin, versions, onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  isAdmin: boolean;
  versions: PlaybookConfig[];
  onCreated: (v: PlaybookConfig) => void;
}) {
  const current = versions[0];
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setDraft(Object.fromEntries(PLAYBOOK_KEYS.map((k) => [k, current?.[k] == null ? "" : String(current[k])])));
    setNotes("");
    setErr("");
  }, [isOpen, current]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr("");
    try {
      const values: Record<string, number | null> = {};
      for (const k of PLAYBOOK_KEYS) {
        const raw = (draft[k] ?? "").trim().replace(/[£,%\s]/g, "");
        if (raw === "") values[k] = null;
        else {
          const n = Number(raw);
          if (!Number.isFinite(n)) throw new Error(`${PLAYBOOK_LABELS[k]} must be a number.`);
          values[k] = n;
        }
      }
      const created = await createPlaybookVersion({ ...(values as Record<PlaybookKey, number | null>), notes: notes.trim() || null });
      onCreated(created);
      onClose();
    } catch (e) {
      setErr(errText(e, "Failed to save the new version."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Playbook config" maxWidth="max-w-2xl" onSubmit={isAdmin ? submit : undefined}
      footer={isAdmin ? (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={saving} className={btnGold}>{saving && <Loader2 className="h-3 w-3 animate-spin" />} Save as version {(current?.version ?? 0) + 1}</button>
        </div>
      ) : undefined}
    >
      <div className="space-y-4 text-xs text-slate-300">
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Versions are never edited. Saving creates a new version; new runs use the newest, and every run keeps the version it was scored against.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PLAYBOOK_KEYS.map((k) => (
            <label key={k} className="space-y-1">
              <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">{PLAYBOOK_LABELS[k]}</span>
              <input
                value={draft[k] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                disabled={!isAdmin}
                placeholder="Not set"
                inputMode="decimal"
                className={input}
              />
            </label>
          ))}
        </div>
        {isAdmin && (
          <label className="block space-y-1">
            <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Change note</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Populated from Playbook v2.1" className={input} />
          </label>
        )}
        {err && <p className="text-rose-300">{err}</p>}
        <div className="border-t border-white/5 pt-3 space-y-1.5">
          <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">History</p>
          {versions.map((v) => (
            <p key={v.version} className="text-[11px] text-slate-400">
              v{v.version} · {v.created_by ?? "—"} · {v.created_at ? new Date(v.created_at).toLocaleDateString("en-GB") : ""}
              {v.notes ? ` · ${v.notes}` : ""}
            </p>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function SanctionModal({
  isOpen, onClose, deal, sanctioned, onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  deal: DealLike;
  sanctioned: boolean;
  onSaved: (c: PostcallControls) => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (isOpen) {
      setNote("");
      setErr("");
    }
  }, [isOpen]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr("");
    try {
      onSaved(await updatePostcallControls(deal.id, sanctioned ? { dscr_sanctioned: false } : { dscr_sanctioned: true, dscr_sanction_note: note.trim() || null }));
      onClose();
    } catch (e) {
      setErr(errText(e, "Failed to save."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={sanctioned ? "Withdraw DSCR sanction" : "Record DSCR sanction"} onSubmit={submit}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={saving} className={btnGold}>{saving && <Loader2 className="h-3 w-3 animate-spin" />} {sanctioned ? "Withdraw" : "Record sanction"}</button>
        </div>
      }
    >
      <div className="space-y-3 text-xs text-slate-300">
        {sanctioned ? (
          <p>Withdrawing sets loi_ready back to false and blocks figures in broker emails again.</p>
        ) : (
          <>
            <p>Recording the sanction lets loi_ready turn true (with debtors present and no Kill) and allows figures and structure in broker emails.</p>
            <label className="block space-y-1">
              <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Note</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sanctioned ratio and basis" className={input} />
            </label>
          </>
        )}
        {err && <p className="text-rose-300">{err}</p>}
      </div>
    </Modal>
  );
}

// ─── New run ───────────────────────────────────────────────────────────────
function NewRunForm({
  deal, activeConfig, canCancel, onCancel, onDone,
}: {
  deal: DealLike;
  activeConfig: PlaybookConfig | null;
  canCancel: boolean;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const [kind, setKind] = useState<"transcript" | "notes">("transcript");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [briefs, setBriefs] = useState<Array<{ id: string; name: string; created_at: string }>>([]);
  const [briefId, setBriefId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [dragging, setDragging] = useState(false);

  const cancelWatch = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelWatch.current?.(), []);

  useEffect(() => {
    fetchPrecallBriefs(deal.id)
      .then((list: Array<Record<string, unknown>>) => {
        const sorted = [...list].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        setBriefs(sorted.map((b) => ({ id: String(b.id), name: String(b.name ?? ""), created_at: String(b.created_at ?? "") })));
        setBriefId(sorted[0] ? String(sorted[0].id) : "");
      })
      .catch(() => setBriefs([]));
  }, [deal.id]);

  const readFile = async (file: File) => {
    setErr("");
    if (!/\.(txt|vtt|srt|md|csv)$/i.test(file.name) && !file.type.startsWith("text/")) {
      setErr("Load a text transcript (.txt, .vtt, .srt, .md). For PDF or Word files, paste the text instead.");
      return;
    }
    setText(await file.text());
    setFileName(file.name);
    setKind("transcript");
  };

  const submit = async () => {
    if (!text.trim()) {
      setErr("Paste the transcript or notes, or load a transcript file.");
      return;
    }
    setRunning(true);
    setErr("");
    setStatus("Queued…");
    try {
      const { jobId } = await runPostcallScorecard({ dealId: deal.id, inputText: text, inputKind: kind, precallBriefId: briefId || null });
      cancelWatch.current?.();
      cancelWatch.current = watchJob(jobId, {
        onProgress: setStatus,
        onComplete: async () => {
          setRunning(false);
          setStatus("");
          await onDone();
        },
        onFail: (message) => {
          setRunning(false);
          setStatus("");
          setErr(message);
        },
      });
    } catch (e) {
      setRunning(false);
      setStatus("");
      setErr(errText(e, "Failed to queue the run."));
    }
  };

  return (
    <div className={cx(card, "space-y-4")}>
      <div className="flex items-center justify-between border-b border-white/5 pb-3">
        <h3 className={heading}>New post-call run</h3>
        {canCancel && (
          <button type="button" onClick={onCancel} className="text-[10px] font-black uppercase text-[#C6A66B] hover:underline cursor-pointer">Back to scorecard</button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Input</span>
          <div className="flex rounded-lg border border-white/[0.06] overflow-hidden">
            {(["transcript", "notes"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={cx("flex-1 h-9 text-[10px] font-bold uppercase tracking-wider transition cursor-pointer", kind === k ? "bg-[#C6A66B] text-slate-950" : "text-slate-400 hover:text-white")}>
                {k === "transcript" ? "Transcript" : "Manual notes"}
              </button>
            ))}
          </div>
        </div>
        <label className="space-y-1">
          <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Pre-call brief</span>
          <select value={briefId} onChange={(e) => setBriefId(e.target.value)} className={cx(input, "cursor-pointer")} disabled={!briefs.length}>
            {!briefs.length && <option value="">None on this deal</option>}
            {briefs.map((b) => (
              <option key={b.id} value={b.id}>{b.name || "Pre-call brief"} · {b.created_at ? new Date(b.created_at).toLocaleDateString("en-GB") : ""}</option>
            ))}
          </select>
        </label>
        <div className="space-y-1">
          <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Playbook config</span>
          <p className="h-9 flex items-center text-xs text-slate-300">{activeConfig ? `Version ${activeConfig.version} (stamped on the run)` : "None — apply migration 0018"}</p>
        </div>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void readFile(f); }}
        className={cx("relative rounded-xl border border-dashed p-4 text-center transition", dragging ? "border-[#C6A66B] bg-[#C6A66B]/5" : "border-white/10 bg-white/[0.01]")}
      >
        <input type="file" accept=".txt,.vtt,.srt,.md,.csv,text/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ""; }} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Load transcript file" />
        <p className="flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {fileName ? <><FileText className="h-4 w-4 text-emerald-300" /> {fileName} loaded</> : <><Upload className="h-4 w-4" /> Drop or choose a text transcript (.txt, .vtt, .srt)</>}
        </p>
      </div>

      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setFileName(""); }}
        placeholder={kind === "transcript" ? "Paste the call transcript, with timestamps if you have them…" : "Paste the call notes. Each line becomes a citable source (L1, L2…)."}
        rows={12}
        className="w-full rounded-xl border border-white/[0.06] bg-white/[0.015] p-3 text-xs text-white placeholder-slate-600 outline-none focus:border-[#C6A66B] font-mono resize-y"
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-[11px] text-slate-500">Each run is stored as a new scorecard; earlier runs are never overwritten.</p>
        <button type="button" onClick={submit} disabled={running || !activeConfig} className={cx(btnGold, "h-10 px-5")}>
          {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {running ? "Scoring…" : "Score call"}
        </button>
      </div>

      {running && status && <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-3 text-[11px] text-slate-400">{status}</div>}
      {err && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">{err}</div>}
    </div>
  );
}

// ─── Run view ──────────────────────────────────────────────────────────────
function RunView({
  run, sc, deal, controls, openComposer,
}: {
  run: PostcallRun;
  sc: Scorecard;
  deal: DealLike;
  controls: PostcallControls | null;
  openComposer: (opts: ComposerOpts) => void;
}) {
  const [showInput, setShowInput] = useState(false);
  const [copied, setCopied] = useState<"" | "email" | "json">("");

  // LOI readiness is live: the sanction may have been recorded after this run.
  const sanctionedNow = Boolean(controls?.dscr_sanctioned_at);
  const liveBlockers = useMemo(
    () => [
      ...sc.loi_blockers.filter((b) => b !== "dscr_sanction_missing"),
      ...(sanctionedNow ? [] : ["dscr_sanction_missing" as const]),
    ],
    [sc.loi_blockers, sanctionedNow],
  );

  const copy = (what: "email" | "json") => {
    const text = what === "email" ? `Subject: ${sc.broker_email.subject}\n\n${sc.broker_email.body}` : JSON.stringify(sc, null, 2);
    navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(""), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Verdict + headline outputs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className={cx("rounded-2xl border p-5 md:col-span-2", VERDICT_STYLE[sc.verdict])}>
          <p className="text-[9px] font-extrabold uppercase tracking-widest opacity-80">Verdict</p>
          <p className="text-2xl font-black mt-1">{sc.verdict}</p>
          <p className="text-[11px] mt-2 opacity-90">
            {sc.verdict === "Kill"
              ? `Hard gate${sc.kill_gates.length > 1 ? "s" : ""} failed: ${sc.kill_gates.map((id) => `${id} ${GATES.find((g) => g.id === id)?.name}`).join(", ")}. Gates decide; nothing overrides a kill.`
              : sc.verdict === "Price"
                ? "No gate failed. Facts in the Price box move the price."
                : sc.verdict === "Condition"
                  ? "No gate failed. Facts in the Condition box become deal conditions."
                  : "No gate failed and nothing is boxed for price or condition. Send the info request."}
          </p>
          <p className="text-[10px] mt-3 opacity-70">
            Playbook v{sc.playbook_version} · {sc.input_kind === "transcript" ? "Transcript" : "Manual notes"} · {new Date(run.created_at).toLocaleString("en-GB")}
          </p>
        </div>
        <div className={card}>
          <p className={heading}>Completeness</p>
          <p className="text-2xl font-black text-white mt-1">{sc.completeness.pct}%</p>
          <p className="text-[11px] text-slate-500">{sc.completeness.known} of {sc.completeness.required} fields known</p>
          <div className="h-1.5 w-full bg-white/[0.04] rounded-full overflow-hidden mt-2">
            <div className="h-full bg-[#C6A66B]" style={{ width: `${sc.completeness.pct}%` }} />
          </div>
        </div>
        <div className={card}>
          <p className={heading}>LOI ready</p>
          <p className={cx("text-2xl font-black mt-1", liveBlockers.length ? "text-slate-300" : "text-emerald-300")}>{liveBlockers.length ? "No" : "Yes"}</p>
          {liveBlockers.map((b) => <p key={b} className="text-[11px] text-slate-500">{LOI_BLOCKER_TEXT[b]}</p>)}
          {sc.earnout_flag && <p className="mt-2 text-[11px] font-bold text-amber-300">Earn-out asked: Playbook gate flagged</p>}
        </div>
      </div>

      {/* Hard gates */}
      <div className={card}>
        <h3 className={cx(heading, "pb-3 border-b border-white/5")}>Hard gates (in order)</h3>
        <div className="divide-y divide-white/5">
          {sc.gates.map((g) => {
            const def = GATES.find((d) => d.id === g.id);
            return (
              <div key={g.id} className="py-2.5 grid grid-cols-[24px_1fr_auto] gap-3 items-start">
                <span className="text-xs font-black text-slate-500">{g.id}</span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white">{g.name}</p>
                  <p className="text-[11px] text-slate-500">{def?.question}</p>
                  {g.adjustments.length > 0 && (
                    <p className="text-[10px] text-amber-300 mt-0.5">
                      Claude said {g.claude_result} · {g.adjustments.map((a) => ADJUSTMENT_TEXT[a] ?? a).join(" · ")}
                    </p>
                  )}
                </div>
                <Chip className={GATE_STYLE[g.result]}>{g.result}</Chip>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fields by section */}
      <div className={card}>
        <h3 className={cx(heading, "pb-3 border-b border-white/5")}>Fields</h3>
        <div className="space-y-5 pt-3">
          {SECTIONS.map((section) => {
            const defs = POSTCALL_FIELDS.filter((f) => f.section === section.id);
            return (
              <div key={section.id}>
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#C6A66B]">
                  {section.label}{section.feeds ? <span className="text-slate-500 normal-case font-semibold tracking-normal"> · feeds {section.feeds}</span> : null}
                </p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-[11px]">
                    <thead>
                      <tr className="text-[9px] uppercase tracking-wider text-slate-500">
                        <th className="py-1 pr-3 font-bold w-[22%]">Field</th>
                        <th className="py-1 pr-3 font-bold w-[24%]">Value</th>
                        <th className="py-1 pr-3 font-bold">Status</th>
                        <th className="py-1 pr-3 font-bold">Source</th>
                        <th className="py-1 pr-3 font-bold">Box</th>
                        <th className="py-1 font-bold w-[30%]">Next action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                      {defs.map((d) => {
                        const f = sc.fields[d.key];
                        if (!f) return null;
                        return (
                          <tr key={d.key} className="align-top">
                            <td className="py-1.5 pr-3 text-slate-300 font-semibold">{d.label}</td>
                            <td className="py-1.5 pr-3 text-white whitespace-pre-wrap break-words">{formatValue(f.value)}</td>
                            <td className="py-1.5 pr-3"><Chip className={STATUS_STYLE[f.status]}>{f.status}</Chip></td>
                            <td className="py-1.5 pr-3 font-mono text-slate-400">{f.source ?? "—"}</td>
                            <td className={cx("py-1.5 pr-3 font-bold uppercase text-[9px] tracking-wider", BOX_STYLE[f.box])}>{f.box}</td>
                            <td className="py-1.5 text-slate-400">{f.next_action ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Info request + broker email */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className={card}>
          <h3 className={cx(heading, "pb-3 border-b border-white/5")}>Info request · {sc.info_request.length} unknown field{sc.info_request.length === 1 ? "" : "s"}</h3>
          <ol className="list-decimal pl-5 pt-3 space-y-1.5 text-xs text-slate-300">
            {sc.info_request.map((q) => (
              <li key={q.field}>
                {q.question} <span className="text-[10px] text-slate-600">({POSTCALL_FIELDS.find((f) => f.key === q.field)?.label})</span>
              </li>
            ))}
          </ol>
          {!sc.info_request.length && <p className="pt-3 text-xs text-slate-500">No unknown fields.</p>}
        </div>

        <div className={cx(card, "space-y-3")}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
            <h3 className={heading}>Broker email draft</h3>
            <div className="flex gap-2">
              <button type="button" onClick={() => copy("email")} className={btnGhost}>
                {copied === "email" ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />} Copy
              </button>
              <button
                type="button"
                onClick={() => openComposer({
                  type: "email",
                  recipientName: String(deal.rawFields?.["Broker Name"] || deal.rawFields?.["Contact Name"] || ""),
                  recipientEmail: String(deal.rawFields?.["Broker Email"] || deal.rawFields?.["Contact Email"] || ""),
                  subject: sc.broker_email.subject,
                  body: sc.broker_email.body,
                  generatedBy: "postcall_scorecard",
                })}
                className={btnGold}
              >
                <Send className="h-3 w-3" /> Send
              </button>
            </div>
          </div>
          {!sc.broker_email.figures_allowed && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                No figures out: drafted before the DSCR sanction, so no £, percentages or structure.
                {sc.broker_email.withheld > 0 && ` ${sc.broker_email.withheld} question${sc.broker_email.withheld === 1 ? "" : "s"} withheld from the email for that reason.`}
                {" "}Sending is blocked if they are added back before the sanction.
              </span>
            </p>
          )}
          <div className="rounded-xl border border-white/5 bg-[#0E1524] p-4 text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
            <p className="font-bold text-white mb-2">{sc.broker_email.subject}</p>
            {sc.broker_email.body}
          </div>
        </div>
      </div>

      {/* Input + raw JSON */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setShowInput((s) => !s)} className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 hover:text-white cursor-pointer">
            {showInput ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Input the sources cite ({run.input_kind === "transcript" ? "transcript" : "notes"})
          </button>
          <button type="button" onClick={() => copy("json")} className={btnGhost}>
            {copied === "json" ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />} Copy scorecard JSON
          </button>
        </div>
        {showInput && (
          <pre className="mt-3 max-h-[420px] overflow-auto rounded-xl border border-white/5 bg-[#0E1524] p-3 text-[11px] text-slate-300 whitespace-pre-wrap">
            {(run.input_text ?? "").split(/\r?\n/).map((l, i) => `L${i + 1}: ${l}`).join("\n")}
          </pre>
        )}
        {sc.field_adjustments.some((a) => a.code.startsWith("source")) && (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
            <XCircle className="h-3.5 w-3.5" />
            {sc.field_adjustments.filter((a) => a.code.startsWith("source")).length} field(s) set to unknown because their source didn't resolve to the input.
          </p>
        )}
      </div>
    </div>
  );
}

function LegacyRunView({ run }: { run: PostcallRun }) {
  return (
    <div className={cx(card, "space-y-3")}>
      <p className="flex items-center gap-2 text-xs text-amber-300">
        <AlertTriangle className="h-4 w-4" /> Legacy brief from before the post-call scorecard spec: no gates, verdict or Playbook version. Start a new run to score this deal.
      </p>
      {run.legacy?.summary && <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{run.legacy.summary}</p>}
    </div>
  );
}
