/**
 * Post-call tab · Lane 2 (WBS) pieces — Optimisation Brief v1.1, section 2.
 *
 *  - LaneCard: the new card at the top of POST-CALL. Lane, WBS sub-sector,
 *    run type and the config line ("Playbook Config WBS v2 · signed by …").
 *  - WbsConfigModal: the WBS Playbook config, per lane and signed.
 *  - WbsRunView: verdict card, H1-H9 gates, D1-D7 weighted score, fields,
 *    Schedule A and the broker email for a WBS run.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, PenLine, Send, ShieldCheck } from "lucide-react";
import { cx } from "../../utils/cx";
import { Modal } from "../ui/Modal";
import {
  createWbsConfigVersion, signPlaybookVersion, updatePostcallControls,
  type PostcallControls, type PostcallRun,
} from "../../api/admin";
import type { PlaybookConfig } from "../../lib/acp/postcallSpec";
import {
  LANES, LANE_LABELS, RUN_TYPES, RUN_TYPE_LABELS, WBS_DIMENSIONS, WBS_FIELDS, WBS_GATES, WBS_SECTIONS,
  WBS_SUBSECTORS, WBS_SUBSECTOR_LABELS, WBS_V2_PLACEHOLDERS, WBS_V2_PROPOSED, WBS_VERDICT_LABEL, laneBadge,
  type EvidenceTag, type Lane, type RunType, type WbsGateResult, type WbsScorecard, type WbsSubsector,
  type WbsThresholds, type WbsWeights,
} from "../../lib/acp/wbsSpec";

const card = "rounded-2xl border border-white/[0.04] bg-acp-card p-5";
const heading = "text-[10px] font-extrabold uppercase tracking-wider text-slate-400";
const btnGhost = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:text-white hover:bg-white/[0.03] transition cursor-pointer disabled:opacity-50";
const btnGold = "inline-flex h-8 items-center gap-1.5 rounded-lg bg-acp-bronze hover:bg-acp-bronze-dark text-acp-on-accent px-3 text-[10px] font-black uppercase tracking-wider transition cursor-pointer disabled:opacity-50";
const input = "h-9 w-full rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 text-xs text-white outline-none focus:border-acp-bronze";
const label = "block text-[9px] font-extrabold uppercase tracking-wider text-slate-400";
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export const GATE_CHIP: Record<WbsGateResult, string> = {
  pass: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  fail: "bg-rose-500/10 text-rose-300 border-rose-500/20",
  open: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  unscored: "bg-white/[0.03] text-slate-400 border-white/10",
};

export const TAG_CHIP: Record<EvidenceTag | string, string> = {
  filed: "bg-sky-500/10 text-sky-300 border-sky-500/20",
  verified: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  mgmt: "bg-indigo-500/10 text-indigo-300 border-indigo-500/20",
  vendor: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  estimated: "bg-violet-500/10 text-violet-300 border-violet-500/20",
  assumption: "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20",
  unknown: "bg-white/[0.03] text-slate-500 border-white/10",
};

export function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider whitespace-nowrap", className)}>{children}</span>;
}

/** "x of 7 set": dimensions whose linear end-points are all set. */
function setCount(t: WbsThresholds | null | undefined): number {
  if (!t?.metrics) return 0;
  return WBS_DIMENSIONS.filter((d) => d.metrics.every((m) => m.kind !== "linear" || (t.metrics[m.key]?.full != null && t.metrics[m.key]?.zero != null))).length;
}

// ─── Lane & scoring config card ────────────────────────────────────────────
export function LaneCard({
  dealId, isAdmin, controls, onControlsChange, runType, onRunTypeChange, laneConfig, onOpenConfig, onLaneChanged,
}: {
  dealId: string;
  isAdmin: boolean;
  controls: PostcallControls | null;
  onControlsChange: (c: PostcallControls) => void;
  runType: RunType;
  onRunTypeChange: (r: RunType) => void;
  laneConfig: PlaybookConfig | null;
  onOpenConfig: () => void;
  /** Changing lane forces a new run (old runs keep their lane stamp). */
  onLaneChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const lane: Lane = controls?.lane ?? "lane_1_cfs";

  const save = async (patch: Parameters<typeof updatePostcallControls>[1]) => {
    setSaving(true);
    setErr("");
    try {
      const next = await updatePostcallControls(dealId, patch);
      onControlsChange(next);
      if (patch.lane && patch.lane !== lane) onLaneChanged();
    } catch (e) {
      setErr(errText(e, "Failed to save the lane."));
    } finally {
      setSaving(false);
    }
  };

  const wbs = lane === "lane_2_wbs";
  const signed = Boolean(laneConfig?.signed_at);
  const thresholds = laneConfig?.thresholds as WbsThresholds | undefined;

  return (
    <div className={cx(card, "space-y-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={heading}>Lane &amp; scoring config</h3>
        <span className="text-[10px] font-black uppercase tracking-wider text-acp-bronze">{laneBadge(lane, controls?.wbs_subsector)}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="space-y-1">
          <span className={label}>Lane</span>
          <select
            value={lane}
            disabled={!isAdmin || saving}
            onChange={(e) => {
              const next = e.target.value as Lane;
              if (next === lane) return;
              if (!window.confirm(`Switch this deal to ${LANE_LABELS[next]}? Changing lane forces a new run; earlier runs keep their lane stamp.`)) return;
              void save({ lane: next });
            }}
            className={cx(input, "cursor-pointer")}
          >
            {LANES.map((l) => <option key={l} value={l}>{LANE_LABELS[l]}</option>)}
          </select>
          <span className="block text-[10px] text-slate-500">
            {wbs ? "Gates H1 to H9 + weighted score D1 to D7" : "Lane 1 gates: non-discretionary, B2B contracted…"}
          </span>
        </label>

        <label className="space-y-1">
          <span className={label}>WBS sub-sector {wbs ? "" : "(Lane 2 only)"}</span>
          <select
            value={controls?.wbs_subsector ?? ""}
            disabled={!isAdmin || !wbs || saving}
            onChange={(e) => void save({ wbs_subsector: (e.target.value || null) as WbsSubsector | null })}
            className={cx(input, "cursor-pointer disabled:opacity-50")}
          >
            <option value="">Not set</option>
            {WBS_SUBSECTORS.map((s) => <option key={s} value={s}>{WBS_SUBSECTOR_LABELS[s]}</option>)}
          </select>
          <span className="block text-[10px] text-slate-500">Applies the sub-sector weight shift</span>
        </label>

        <label className="space-y-1">
          <span className={label}>Run type</span>
          <select value={runType} onChange={(e) => onRunTypeChange(e.target.value as RunType)} className={cx(input, "cursor-pointer")}>
            {RUN_TYPES.map((r) => <option key={r} value={r}>{RUN_TYPE_LABELS[r]}{r === "post_call" ? " (transcript)" : ""}</option>)}
          </select>
          <span className="block text-[10px] text-slate-500">Sets which evidence may fail a gate</span>
        </label>
      </div>

      <div className={cx("flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2", signed || !wbs ? "border-white/[0.05] bg-white/[0.015]" : "border-amber-500/20 bg-amber-500/5")}>
        <p className="text-[11px] text-slate-300">
          {laneConfig ? (
            <>
              Playbook Config <b className="text-white">{wbs ? "WBS" : "CFS"} v{laneConfig.version}</b>
              {" · "}
              {signed ? <>signed by <b className="text-white">{laneConfig.signed_by}</b> · {new Date(laneConfig.signed_at!).toLocaleDateString("en-GB")}</> : <span className="text-amber-300 font-bold">unsigned</span>}
              {wbs && <> · <span className="font-bold text-white">{setCount(thresholds)} of 7 set</span></>}
            </>
          ) : (
            <span className="text-amber-300">No config for this lane: apply migration 0025.</span>
          )}
        </p>
        {wbs && (
          <button type="button" onClick={onOpenConfig} className="text-[10px] font-black uppercase text-acp-bronze hover:underline cursor-pointer">
            {isAdmin ? (signed ? "View / new version" : "Review / sign") : "View"}
          </button>
        )}
      </div>
      {wbs && !signed && (
        <p className="text-[11px] text-amber-300">Unsigned: every gate returns UNSCORED and the verdict cannot be KILL until Dami signs the WBS config.</p>
      )}
      {err && <p className="text-[11px] text-rose-300">{err}</p>}
    </div>
  );
}

// ─── WBS config modal ──────────────────────────────────────────────────────
export function WbsConfigModal({
  isOpen, onClose, isAdmin, versions, onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  isAdmin: boolean;
  versions: PlaybookConfig[];
  onCreated: (v: PlaybookConfig) => void;
}) {
  const current = versions[0];
  const base = useMemo(() => ({
    thresholds: (current?.thresholds as WbsThresholds | undefined) ?? WBS_V2_PROPOSED.thresholds,
    weights: (current?.weights as WbsWeights | undefined) ?? WBS_V2_PROPOSED.weights,
  }), [current]);
  const [metrics, setMetrics] = useState<Record<string, { full: string; zero: string }>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [h7, setH7] = useState({ practitioner: "", payer: "" });
  const [h3, setH3] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "sign">("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setMetrics(Object.fromEntries(Object.entries(base.thresholds.metrics).map(([k, v]) => [k, { full: v.full == null ? "" : String(v.full), zero: v.zero == null ? "" : String(v.zero) }])));
    setWeights(Object.fromEntries(Object.entries(base.weights).map(([k, v]) => [k, String(v)])));
    setH7({ practitioner: String(base.thresholds.h7_practitioner_max_pct ?? ""), payer: String(base.thresholds.h7_payer_max_pct ?? "") });
    setH3((base.thresholds.h3_conditions ?? []).join("\n"));
    setNotes("");
    setErr("");
  }, [isOpen, base]);

  const toNum = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[£,%\s]/g, "")));

  const build = () => {
    const thresholds: WbsThresholds = {
      metrics: Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, { full: toNum(v.full), zero: toNum(v.zero) }])),
      h7_practitioner_max_pct: toNum(h7.practitioner),
      h7_payer_max_pct: toNum(h7.payer),
      h3_conditions: h3.split("\n").map((s) => s.trim()).filter(Boolean),
    };
    const w = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Number(v)])) as WbsWeights;
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    if (sum !== 100) throw new Error(`D1-D7 weights sum to ${sum}; they must sum to 100.`);
    return { thresholds, weights: w };
  };

  const save = async (sign: boolean) => {
    setBusy(sign ? "sign" : "save");
    setErr("");
    try {
      onCreated(await createWbsConfigVersion({ ...build(), notes: notes.trim() || null, sign }));
      onClose();
    } catch (e) {
      setErr(errText(e, "Failed to save the config."));
    } finally {
      setBusy("");
    }
  };

  const signCurrent = async () => {
    if (!current) return;
    setBusy("sign");
    setErr("");
    try {
      onCreated(await signPlaybookVersion(current.version));
      onClose();
    } catch (e) {
      setErr(errText(e, "Failed to sign."));
    } finally {
      setBusy("");
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Playbook Config · Lane 2 WBS" maxWidth="max-w-3xl"
      footer={isAdmin ? (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          {current && !current.signed_at && (
            <button type="button" onClick={signCurrent} disabled={!!busy} className={btnGhost}>
              {busy === "sign" ? <Loader2 className="h-3 w-3 animate-spin" /> : <PenLine className="h-3 w-3" />} Sign v{current.version} as is
            </button>
          )}
          <button type="button" onClick={() => save(false)} disabled={!!busy} className={btnGhost}>{busy === "save" && <Loader2 className="h-3 w-3 animate-spin" />} Save unsigned</button>
          <button type="button" onClick={() => save(true)} disabled={!!busy} className={btnGold}><ShieldCheck className="h-3 w-3" /> Save and sign</button>
        </div>
      ) : undefined}
    >
      <div className="space-y-5 text-xs text-slate-300">
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Gates kill; the score prices. Saving creates a new version; signing records the signer and time. Until a WBS version is signed, every gate and dimension returns UNSCORED.
          {" "}Values the brief does not state outright are placeholders to confirm: {WBS_V2_PLACEHOLDERS.join(", ")}.
        </p>

        {WBS_DIMENSIONS.map((d) => (
          <div key={d.id} className="rounded-xl border border-white/[0.05] p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-bold text-white">{d.id} {d.name}</p>
              <label className="flex items-center gap-1.5 text-[10px] text-slate-400">
                Weight
                <input value={weights[d.id] ?? ""} onChange={(e) => setWeights((w) => ({ ...w, [d.id]: e.target.value }))} disabled={!isAdmin} className={cx(input, "h-7 w-14 text-center")} inputMode="numeric" />
              </label>
            </div>
            <p className="text-[10px] text-slate-500">100 when: {d.full} · 0 when: {d.zero}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {d.metrics.filter((m) => m.kind === "linear").map((m) => (
                <div key={m.key} className="space-y-1">
                  <span className={label}>{m.label}</span>
                  <div className="flex items-center gap-1">
                    <input value={metrics[m.key]?.full ?? ""} onChange={(e) => setMetrics((x) => ({ ...x, [m.key]: { ...(x[m.key] ?? { zero: "" }), full: e.target.value } }))} disabled={!isAdmin} placeholder="100 at" className={cx(input, "h-7")} aria-label={`${m.label} scores 100 at`} />
                    <input value={metrics[m.key]?.zero ?? ""} onChange={(e) => setMetrics((x) => ({ ...x, [m.key]: { ...(x[m.key] ?? { full: "" }), zero: e.target.value } }))} disabled={!isAdmin} placeholder="0 at" className={cx(input, "h-7")} aria-label={`${m.label} scores 0 at`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1"><span className={label}>H7 top practitioner band (%)</span><input value={h7.practitioner} onChange={(e) => setH7((x) => ({ ...x, practitioner: e.target.value }))} disabled={!isAdmin} className={input} /></label>
          <label className="space-y-1"><span className={label}>H7 single payer band (%)</span><input value={h7.payer} onChange={(e) => setH7((x) => ({ ...x, payer: e.target.value }))} disabled={!isAdmin} className={input} /></label>
        </div>
        <label className="block space-y-1">
          <span className={label}>H3 patient-facing conditions (one per line; empty keeps H3 OPEN)</span>
          <textarea value={h3} onChange={(e) => setH3(e.target.value)} disabled={!isAdmin} rows={5} className="w-full rounded-lg border border-white/[0.06] bg-white/[0.015] p-2 text-xs text-white outline-none focus:border-acp-bronze" placeholder="Paste the Playbook's five conditions" />
        </label>
        {isAdmin && <label className="block space-y-1"><span className={label}>Change note</span><input value={notes} onChange={(e) => setNotes(e.target.value)} className={input} placeholder="e.g. WBS v2 thresholds signed" /></label>}
        {err && <p className="text-rose-300">{err}</p>}
        <div className="border-t border-white/5 pt-3 space-y-1">
          <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">History</p>
          {versions.map((v) => (
            <p key={v.version} className="text-[11px] text-slate-400">
              v{v.version} · {v.signed_at ? `signed by ${v.signed_by} · ${new Date(v.signed_at).toLocaleDateString("en-GB")}` : "unsigned"}{v.notes ? ` · ${v.notes}` : ""}
            </p>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ─── WBS run view ──────────────────────────────────────────────────────────
type ComposerOpts = { type: "email"; recipientName?: string; recipientEmail?: string; subject?: string; body?: string; generatedBy?: string };

const BLOCKER_TEXT: Record<string, string> = {
  dscr_sanction_missing: "DSCR sanction not recorded",
  verdict_kill: "Verdict is Kill",
  debtors_missing: "Aged debtors missing",
  deferred_income_missing: "Deferred income missing (consumer-paid cash model)",
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString("en-GB");
  if (typeof v === "string") return v.replace(/_/g, " ");
  if (Array.isArray(v)) return v.map((i) => (i && typeof i === "object" ? Object.values(i).filter((x) => x != null && x !== "").join(" · ") : String(i))).join("\n") || "—";
  return Object.entries(v as Record<string, unknown>).filter(([, x]) => x != null).map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : String(x)}`).join("\n");
}

export function verdictText(sc: WbsScorecard): string {
  if (sc.verdict === "PROVISIONAL" && sc.band) return `Provisional · ${WBS_VERDICT_LABEL[sc.band]}`;
  return WBS_VERDICT_LABEL[sc.verdict];
}

export function WbsRunView({
  run, sc, deal, controls, openComposer,
}: {
  run: PostcallRun;
  sc: WbsScorecard;
  deal: { rawFields?: Record<string, unknown> };
  controls: PostcallControls | null;
  openComposer: (opts: ComposerOpts) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const sanctionedNow = Boolean(controls?.dscr_sanctioned_at);
  const blockers = [...sc.loi_blockers.filter((b) => b !== "dscr_sanction_missing"), ...(sanctionedNow ? [] : ["dscr_sanction_missing"])];
  const kill = sc.verdict === "KILL";

  return (
    <div className="space-y-6">
      {controls && controls.lane !== "lane_2_wbs" && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-amber-300">
          This run was scored in Lane 2 · WBS. The deal is now in Lane 1: score a new run to use Lane 1 gates.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Verdict card */}
        <div className={cx("rounded-2xl border p-5 space-y-3", kill ? "border-rose-500/30 bg-rose-500/10" : sc.verdict === "ADVANCE" ? "border-emerald-500/30 bg-emerald-500/10" : "border-acp-bronze/30 bg-acp-bronze/[0.06]")}>
          <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">Verdict · {laneBadge("lane_2_wbs", sc.subsector)}</p>
          <p className={cx("font-display text-3xl font-bold leading-none", kill ? "text-rose-300" : "text-acp-bronze")}>{verdictText(sc)}</p>
          <p className="text-[11px] text-slate-300">{sc.reason}</p>
          <div className="grid grid-cols-3 gap-3 pt-1">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">WBS score</p>
              <p className="text-2xl font-black text-white">{sc.total_score ?? "—"}<span className="text-xs text-slate-500">/100</span></p>
              {sc.verdict === "PROVISIONAL" && <p className="text-[10px] text-slate-500">indicative</p>}
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Confidence</p>
              <p className="text-2xl font-black text-white">{sc.confidence_pct}%</p>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">LOI ready</p>
              <p className={cx("text-2xl font-black", blockers.length ? "text-slate-300" : "text-emerald-300")}>{blockers.length ? "No" : "Yes"}</p>
            </div>
          </div>
          {blockers.length > 0 && <p className="text-[10px] text-slate-400">{blockers.map((b) => BLOCKER_TEXT[b] ?? b).join(" · ")}</p>}
          <p className="text-[10px] text-slate-500">
            Config WBS v{sc.playbook_version} · {sc.config_signed ? `signed by ${sc.config_signed_by}` : "unsigned"} · {RUN_TYPE_LABELS[sc.run_type]} · {new Date(run.created_at).toLocaleString("en-GB")}
          </p>
          {sc.earnout_flag && <p className="text-[11px] font-bold text-amber-300">Earn-out raised by the sellers: Playbook gate flagged</p>}
        </div>

        {/* Completeness */}
        <div className={cx(card, "space-y-2")}>
          <p className={heading}>Completeness</p>
          <p className="text-2xl font-black text-white">{sc.completeness.pct}%</p>
          <p className="text-[11px] text-slate-500">{sc.completeness.known} of {sc.completeness.required} WBS fields known</p>
          <div className="h-1.5 w-full bg-white/[0.04] rounded-full overflow-hidden"><div className="h-full bg-acp-bronze" style={{ width: `${sc.completeness.pct}%` }} /></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Hard gates */}
        <div className={card}>
          <h3 className={cx(heading, "pb-3 border-b border-white/5")}>WBS hard gates (in order)</h3>
          <div className="divide-y divide-white/5">
            {sc.gates.map((g) => (
              <div key={g.id} className="py-2.5 grid grid-cols-[28px_1fr_auto] gap-3 items-start">
                <span className="text-xs font-black text-slate-500">{g.id}</span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white">{g.name}</p>
                  <p className="text-[11px] text-slate-500">{g.reason || WBS_GATES.find((d) => d.id === g.id)?.failWhen}</p>
                </div>
                <Chip className={GATE_CHIP[g.result]}>{g.result}{g.qualifier ? ` · ${g.qualifier}` : ""}</Chip>
              </div>
            ))}
          </div>
          <p className="pt-2 text-[10px] text-slate-500">States: PASS · FAIL · OPEN · UNSCORED. ESTIMATED evidence never produces FAIL.</p>
        </div>

        {/* Weighted score */}
        <div className={card}>
          <h3 className={cx(heading, "pb-3 border-b border-white/5")}>WBS weighted score</h3>
          <div className="space-y-3 pt-3">
            {sc.dimensions.map((d) => (
              <div key={d.id} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-bold text-white">{d.id} {d.name}</p>
                  <p className="text-[10px] text-slate-400 tabular-nums">{d.score == null ? "UNSCORED" : `${d.score}/100 · w${d.weight} → ${d.points?.toFixed(1)}`}</p>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                  <div className={cx("h-full rounded-full", (d.score ?? 0) >= 60 ? "bg-acp-bronze" : "bg-rose-400/80")} style={{ width: `${d.score ?? 0}%` }} />
                </div>
                <p className="text-[10px] text-slate-500">{d.driver}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
            <p className="text-xs font-black text-white">Total</p>
            <p className="text-xs font-black text-acp-bronze">{sc.total_score == null ? "UNSCORED" : `${sc.total_score} / 100 · ${sc.band ? WBS_VERDICT_LABEL[sc.band] : ""}`}</p>
          </div>
        </div>
      </div>

      {/* Fields */}
      <div className={card}>
        <h3 className={cx(heading, "pb-3 border-b border-white/5")}>WBS fields</h3>
        <div className="space-y-5 pt-3">
          {WBS_SECTIONS.map((section) => (
            <div key={section.id}>
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-acp-bronze">{section.label} <span className="text-slate-500 normal-case font-semibold tracking-normal">· feeds {section.feeds}</span></p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-[11px]">
                  <thead><tr className="text-[9px] uppercase tracking-wider text-slate-500"><th className="py-1 pr-3 w-[24%]">Field</th><th className="py-1 pr-3 w-[26%]">Value</th><th className="py-1 pr-3">Tag</th><th className="py-1 pr-3">Source</th><th className="py-1 w-[30%]">Next action</th></tr></thead>
                  <tbody className="divide-y divide-white/[0.03]">
                    {WBS_FIELDS.filter((f) => f.section === section.id).map((d) => {
                      const f = sc.fields[d.key];
                      if (!f) return null;
                      return (
                        <tr key={d.key} className="align-top">
                          <td className="py-1.5 pr-3 text-slate-300 font-semibold">{d.label}</td>
                          <td className="py-1.5 pr-3 text-white whitespace-pre-wrap break-words">{formatValue(f.value)}</td>
                          <td className="py-1.5 pr-3"><Chip className={TAG_CHIP[f.status]}>{f.status}</Chip></td>
                          <td className="py-1.5 pr-3 font-mono text-slate-400">{f.source ?? "—"}</td>
                          <td className="py-1.5 text-slate-400">{f.next_action ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Schedule A + broker email */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className={cx(card, "space-y-4")}>
          <div>
            <h3 className={cx(heading, "pb-3 border-b border-white/5")}>Schedule A · {sc.schedule_a.length} ranked ask{sc.schedule_a.length === 1 ? "" : "s"} (max 12)</h3>
            <ol className="list-decimal pl-5 pt-3 space-y-1.5 text-xs text-slate-300">
              {sc.schedule_a.map((a) => <li key={a.ask}>{a.ask}</li>)}
            </ol>
          </div>
          {sc.second_call_agenda.length > 0 && (
            <div>
              <h3 className={cx(heading, "pb-2")}>Second-call agenda (never to the broker)</h3>
              <ul className="list-disc pl-5 space-y-1 text-xs text-slate-400">{sc.second_call_agenda.map((q) => <li key={q}>{q}</li>)}</ul>
            </div>
          )}
        </div>
        <div className={cx(card, "space-y-3")}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
            <h3 className={heading}>Info request email</h3>
            <div className="flex gap-2">
              <button type="button" className={btnGhost} onClick={() => { navigator.clipboard.writeText(`Subject: ${sc.broker_email.subject}\n\n${sc.broker_email.body}`); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                {copied ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />} Copy
              </button>
              <button type="button" className={btnGold} onClick={() => openComposer({
                type: "email",
                recipientName: String(deal.rawFields?.["Broker Name"] || deal.rawFields?.["Contact Name"] || ""),
                recipientEmail: String(deal.rawFields?.["Broker Email"] || deal.rawFields?.["Contact Email"] || ""),
                subject: sc.broker_email.subject,
                body: sc.broker_email.body,
                generatedBy: "postcall_wbs",
              })}>
                <Send className="h-3 w-3" /> Send
              </button>
            </div>
          </div>
          {!sc.broker_email.figures_allowed && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-300"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> No ACP figures before the DSCR sanction. The negotiated draft lives in the INTELLIGENCE tab.</p>
          )}
          <div className="rounded-xl border border-white/5 bg-acp-portal-bg p-4 text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
            <p className="font-bold text-white mb-2">{sc.broker_email.subject}</p>
            {sc.broker_email.body}
          </div>
        </div>
      </div>

      <div className={card}>
        <button type="button" onClick={() => setShowInput((s) => !s)} className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 hover:text-white cursor-pointer">
          {showInput ? "Hide" : "Show"} the input the sources cite
        </button>
        {showInput && (
          <pre className="mt-3 max-h-[420px] overflow-auto rounded-xl border border-white/5 bg-acp-portal-bg p-3 text-[11px] text-slate-300 whitespace-pre-wrap">
            {(run.input_text ?? "").split(/\r?\n/).map((l, i) => `L${i + 1}: ${l}`).join("\n")}
          </pre>
        )}
      </div>
    </div>
  );
}
