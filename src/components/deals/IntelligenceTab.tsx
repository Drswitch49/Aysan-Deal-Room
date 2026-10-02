/**
 * INTELLIGENCE tab — Deal Intelligence (Optimisation Brief v1.1, section 4).
 *
 * Inserted after POST-CALL and sharing its run selector. Two panes:
 *   Intelligence Brief          1 BLUF … 11 Actions
 *   Negotiation Engine · P-089  12 A Diagnosis … 19 H Replies + I Log row
 *
 * Behaviour (s4): each card has evidence chips, Lock, Regenerate and a
 * comment thread; locked cards survive regeneration; a newer upload marks
 * document-dependent cards stale; Copy and Send are disabled while any Gate
 * Check row is FAIL; clicking a Technique Map row highlights its line in the
 * draft in the same colour; Write to Negotiation Log syncs section 19 to
 * Notion with live figures stripped; partners see every section, the
 * fractional analyst sees 1-9 and 11 (never 8); section 8 never exports.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, BookOpen, Check, Copy, Download, Loader2, Lock, MessageSquare, Printer,
  RefreshCw, Send, Sparkles, Unlock,
} from "lucide-react";
import { cx } from "../../utils/cx";
import { useAuth } from "../../context/AuthContext";
import {
  commentSection, fetchIntelligence, fetchPostcallControls, fetchPostcallRuns, generateIntelligence,
  lockSection, regenerateSections, writeNegotiationLogRow,
  type CounterpartyOpts, type IntelligenceView, type PostcallControls, type PostcallRun,
} from "../../api/admin";
import {
  SECTIONS, SECTION_BY_KEY, type Pane, type SectionCard, type SectionContent, type SectionKey,
} from "../../lib/acp/intelligence";
import { TECHNIQUE_BY_CODE, type LintRow, type TechniqueMapRow } from "../../lib/acp/negotiation";
import { laneBadge } from "../../lib/acp/wbsSpec";
import { Chip, TAG_CHIP } from "./WbsPostCall";

const PARTNER_ROLES = ["owner", "managing_partner", "partner", "admin", "cfo", "super_admin"];
const card = "rounded-2xl border border-white/[0.04] bg-acp-card";
const btnGhost = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:text-white hover:bg-white/[0.03] transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
const btnGold = "inline-flex h-8 items-center gap-1.5 rounded-lg bg-acp-bronze hover:bg-acp-bronze-dark text-acp-on-accent px-3 text-[10px] font-black uppercase tracking-wider transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
const errText = (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f);
const normRole = (r?: string) => (r ?? "").toLowerCase().replace(/[\s-]+/g, "_");

/** Technique-map highlight colours (row i ↔ span i, same colour both places). */
const HIGHLIGHTS = [
  "bg-amber-400/25", "bg-sky-400/25", "bg-emerald-400/25", "bg-violet-400/25", "bg-rose-400/25",
  "bg-lime-400/25", "bg-cyan-400/25", "bg-orange-400/25", "bg-fuchsia-400/25", "bg-teal-400/25",
];

type DealLike = { id: string; rawFields?: Record<string, unknown>; dealRef?: string; companyName?: string };

export function IntelligenceTab({
  deal, selectedRunId, onSelectRun,
}: {
  deal: DealLike;
  selectedRunId: string | null;
  onSelectRun: (id: string | null) => void;
}) {
  const { user } = useAuth();
  const isPartner = PARTNER_ROLES.includes(normRole(user?.role));
  const [runs, setRuns] = useState<PostcallRun[]>([]);
  const [controls, setControls] = useState<PostcallControls | null>(null);
  const [intel, setIntel] = useState<IntelligenceView | null>(null);
  const [visible, setVisible] = useState<SectionKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [pane, setPane] = useState<Pane>("brief");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [highlight, setHighlight] = useState<number | null>(null);
  const [cp, setCp] = useState<CounterpartyOpts>({ counterparty_role: "broker", recipient_name: "", inbound: "" });
  const sectionRefs = useRef<Partial<Record<SectionKey, HTMLDivElement | null>>>({});

  // Runs + controls once per deal.
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([fetchPostcallRuns(deal.id), fetchPostcallControls(deal.id).catch(() => null)])
      .then(([r, c]) => {
        if (!active) return;
        setRuns(r);
        setControls(c);
        if (!selectedRunId || !r.some((x) => x.id === selectedRunId)) onSelectRun(r[0]?.id ?? null);
      })
      .catch((e) => active && setErr(errText(e, "Failed to load post-call runs.")))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id]);

  const run = runs.find((r) => r.id === selectedRunId) ?? null;

  const loadIntel = useCallback(async () => {
    if (!run) return null;
    const res = await fetchIntelligence(deal.id, run.id);
    setIntel(res.run);
    setVisible(res.run?.visible_sections ?? res.visible_sections ?? []);
    return res.run;
  }, [deal.id, run]);

  useEffect(() => {
    setIntel(null);
    if (run) loadIntel().catch((e) => setErr(errText(e, "Failed to load intelligence.")));
  }, [run, loadIntel]);

  // Poll while a generation is in flight.
  const inFlight = intel?.status === "queued" || intel?.status === "running";
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => { loadIntel().catch(() => undefined); }, 3000);
    return () => clearInterval(t);
  }, [inFlight, loadIntel]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setErr("");
    setNotice("");
    try {
      await fn();
      await loadIntel();
    } catch (e) {
      setErr(errText(e, "That didn't work."));
    } finally {
      setBusy("");
    }
  };

  const opts = (): CounterpartyOpts => ({
    counterparty_role: cp.counterparty_role,
    recipient_name: cp.recipient_name?.trim() || null,
    inbound: cp.inbound?.trim() || null,
  });

  const generateAll = () => act("all", () => (intel
    ? regenerateSections(intel.id, visible.filter((k) => !intel.locked_sections.includes(k)), opts())
    : generateIntelligence(deal.id, run!.id, opts())));

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-xs text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin text-acp-bronze" /> Loading Deal Intelligence…</div>;
  }
  if (!runs.length) {
    return <div className={cx(card, "p-6 text-xs text-slate-400")}>No post-call run yet. Score a call on the POST-CALL tab first: Deal Intelligence reads the selected run.</div>;
  }

  const sc = run?.wbs ?? null;
  const sections = SECTIONS.filter((s) => visible.includes(s.key) && s.pane === pane);
  const sendEnabled = Boolean(intel?.sections["17"]?.data?.send_enabled ?? intel?.sections["15"]?.data?.send_enabled);

  return (
    <div className="space-y-4 font-sans animate-fade-in-up">
      {/* A · Sticky strip */}
      {/* Sticky on desktop; on a phone it would cover half the screen, so it scrolls. */}
      <div className={cx(card, "lg:sticky lg:top-[64px] lg:z-10 p-4 backdrop-blur-xl bg-acp-card/95")}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Stat label="Verdict" value={run?.verdict ?? "—"} accent />
          {sc && <Stat label="WBS score" value={sc.total_score == null ? "UNSCORED" : `${sc.total_score}/100`} />}
          {sc && <Stat label="Confidence" value={`${sc.confidence_pct}%`} />}
          <Stat label="LOI ready" value={(sc?.loi_ready ?? run?.scorecard?.loi_ready) && controls?.dscr_sanctioned_at ? "Yes" : "No"} />
          <Stat label="DSCR sanction" value={controls?.dscr_sanctioned_at ? "Recorded" : "Not recorded"} />
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
            <select
              value={run?.id ?? ""}
              onChange={(e) => onSelectRun(e.target.value)}
              className="h-8 min-w-0 max-w-[260px] rounded-lg border border-white/[0.06] bg-acp-card px-2 text-[11px] text-white outline-none focus:border-acp-bronze cursor-pointer"
              aria-label="Post-call run"
            >
              {runs.map((r) => <option key={r.id} value={r.id}>{r.verdict ?? "Legacy"} · {new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</option>)}
            </select>
            <button type="button" className={btnGhost} disabled={!run || !!busy || inFlight || (!run.wbs && !run.scorecard)} onClick={generateAll}>
              {busy === "all" || inFlight ? <Loader2 className="h-3 w-3 animate-spin" /> : intel ? <RefreshCw className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
              {intel ? "Regenerate all" : "Generate"}
            </button>
            <ExportButtons intel={intel} visible={visible} dealName={deal.companyName ?? "Deal"} />
          </div>
        </div>
        {run && <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-acp-bronze">{laneBadge(run.lane, sc?.subsector)}</p>}
      </div>

      {err && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">{err}</div>}
      {notice && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300">{notice}</div>}
      {intel?.status === "failed" && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">Generation failed: {intel.error}</div>}
      {inFlight && <div className="rounded-xl border border-white/[0.05] bg-white/[0.015] p-3 text-[11px] text-slate-400"><Loader2 className="mr-1.5 inline h-3 w-3 animate-spin" /> Generating: sections 2-10, then BLUF, then the Negotiation Engine. Cards fill in as each stage lands.</div>}

      {/* Counterparty for P-089 */}
      {(!intel || pane === "negotiation") && isPartner && (
        <div className={cx(card, "p-4 grid grid-cols-1 md:grid-cols-[160px_200px_1fr] gap-3")}>
          <label className="space-y-1">
            <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Counterparty</span>
            <select value={cp.counterparty_role} onChange={(e) => setCp((c) => ({ ...c, counterparty_role: e.target.value as CounterpartyOpts["counterparty_role"] }))} className="h-9 w-full rounded-lg border border-white/[0.06] bg-white/[0.015] px-2 text-xs text-white cursor-pointer">
              <option value="broker">Broker</option><option value="seller">Seller direct</option><option value="lender">Lender</option><option value="adviser">Adviser</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Addressee</span>
            <input value={cp.recipient_name ?? ""} onChange={(e) => setCp((c) => ({ ...c, recipient_name: e.target.value }))} placeholder="e.g. Kimberley Aspin" className="h-9 w-full rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 text-xs text-white" />
          </label>
          <label className="space-y-1">
            <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Their message (blank = info request, pre-negotiation)</span>
            <textarea value={cp.inbound ?? ""} onChange={(e) => setCp((c) => ({ ...c, inbound: e.target.value }))} rows={2} placeholder="Paste the counterparty's latest message for a negotiation reply" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.015] p-2 text-xs text-white" />
          </label>
        </div>
      )}

      {/* B · Pane toggle */}
      <div className="flex gap-2">
        {(["brief", "negotiation"] as Pane[]).map((p) => {
          const any = SECTIONS.some((s) => s.pane === p && visible.includes(s.key));
          if (!any) return null;
          return (
            <button key={p} type="button" onClick={() => setPane(p)} className={pane === p ? btnGold : btnGhost}>
              {p === "brief" ? "Intelligence Brief" : "Negotiation Engine · P-089"}
            </button>
          );
        })}
      </div>

      {!intel ? (
        <div className={cx(card, "p-6 text-xs text-slate-400 space-y-2")}>
          <p>No Deal Intelligence for this run yet.</p>
          <p>Generate writes sections 2-10, then the BLUF, then the Negotiation Engine (P-089) from this run, the deal's documents and the call input.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-4 items-start">
          {/* C · Section rail */}
          <nav className={cx(card, "p-3 lg:sticky lg:top-[200px] space-y-0.5 max-lg:flex max-lg:gap-1 max-lg:overflow-x-auto")}>
            {SECTIONS.filter((s) => visible.includes(s.key)).map((s) => {
              const state = sectionState(intel, s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => {
                    setPane(s.pane);
                    setTimeout(() => sectionRefs.current[s.key]?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                  }}
                  className={cx("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition hover:bg-white/[0.03] max-lg:w-auto max-lg:shrink-0", s.pane === pane ? "text-slate-200" : "text-slate-500")}
                >
                  <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", STATE_DOT[state])} />
                  <span className="truncate">{s.key} {s.letter ? `${s.letter} · ` : ""}{s.title}</span>
                  {s.partnersOnly && <Lock className="h-2.5 w-2.5 text-acp-bronze shrink-0" />}
                </button>
              );
            })}
            <p className="pt-2 text-[9px] text-slate-500 max-lg:hidden">
              <span className="text-emerald-400">●</span> generated <span className="text-sky-400">●</span> edited <span className="text-acp-bronze">●</span> locked <span className="text-amber-400">●</span> stale
            </p>
          </nav>

          {/* D · Cards */}
          <div className="space-y-4 min-w-0">
            {sections.map((s) => {
              const c = intel.sections[s.key];
              const locked = intel.locked_sections.includes(s.key);
              const stale = intel.stale_sections.includes(s.key);
              return (
                <div key={s.key} ref={(el) => { sectionRefs.current[s.key] = el; }} className={cx(card, "p-5 scroll-mt-48", stale && "border-amber-500/30")}>
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-white/5 pb-3">
                    <div className="min-w-0">
                      <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                        {s.key}{s.letter ? ` · ${s.letter}` : ""} · {s.title}
                        {s.partnersOnly && <span className="ml-2 rounded border border-acp-bronze/30 px-1 text-acp-bronze">Internal only · partners</span>}
                      </h3>
                      {stale && <p className="mt-1 text-[10px] text-amber-300">Stale: a document was uploaded after this card was generated.</p>}
                      <EvidenceChips content={c?.content} />
                    </div>
                    <div className="flex gap-1.5">
                      <button type="button" className={btnGhost} disabled={!!busy || !c} onClick={() => act(`lock-${s.key}`, () => lockSection(intel.id, s.key, !locked))}>
                        {locked ? <Lock className="h-3 w-3 text-acp-bronze" /> : <Unlock className="h-3 w-3" />} {locked ? "Locked" : "Lock"}
                      </button>
                      <button type="button" className={btnGhost} disabled={!!busy || locked || inFlight} onClick={() => act(`regen-${s.key}`, () => regenerateSections(intel.id, [s.key], opts()))}>
                        {busy === `regen-${s.key}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Regenerate
                      </button>
                    </div>
                  </div>

                  <div className="pt-3">
                    {!c ? (
                      <p className="text-xs text-slate-500">{inFlight ? "Generating…" : "Not generated yet."}</p>
                    ) : s.key === "15" ? (
                      <DraftCard card={c} ranges={(intel.sections["16"]?.data?.map ?? []) as TechniqueMapRow[]} highlight={highlight} sendEnabled={sendEnabled} onRegenerate={() => act("regen-15", () => regenerateSections(intel.id, ["15"], opts()))} locked={locked} />
                    ) : s.key === "16" ? (
                      <TechniqueMapCard map={(c.data?.map ?? []) as TechniqueMapRow[]} highlight={highlight} onPick={setHighlight} />
                    ) : s.key === "17" ? (
                      <GateCheckCard card={c} />
                    ) : s.key === "19" ? (
                      <LogCard card={c} isPartner={isPartner} sendEnabled={sendEnabled} busy={busy === "log"} onWrite={() => act("log", async () => {
                        const r = await writeNegotiationLogRow(intel.id);
                        setNotice(r.notion.synced ? "Logged and synced to the Notion Negotiation Log (no live figures)." : `Logged in the Deal OS. Notion not synced: ${r.notion.reason}`);
                      })} />
                    ) : (
                      <Content content={c.content} />
                    )}
                  </div>

                  <Comments
                    comments={intel.comments.filter((x) => x.section === s.key)}
                    onAdd={(text) => act(`comment-${s.key}`, () => commentSection(intel.id, s.key, text))}
                    busy={busy === `comment-${s.key}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pieces ────────────────────────────────────────────────────────────────
function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cx("text-sm font-black", accent ? "text-acp-bronze" : "text-white")}>{value}</p>
    </div>
  );
}

type State = "generated" | "edited" | "locked" | "stale" | "empty";
const STATE_DOT: Record<State, string> = { generated: "bg-emerald-400", edited: "bg-sky-400", locked: "bg-acp-bronze", stale: "bg-amber-400", empty: "bg-slate-600" };

function sectionState(intel: IntelligenceView, key: SectionKey): State {
  if (!intel.sections[key]) return "empty";
  if (intel.locked_sections.includes(key)) return "locked";
  if (intel.stale_sections.includes(key)) return "stale";
  if (intel.sections[key]?.edited) return "edited";
  return "generated";
}

/** **bold** support for BLUF leads. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i} className="text-white">{p.slice(2, -2)}</b> : <span key={i}>{p}</span>))}</>;
}

function EvidenceChips({ content }: { content?: SectionContent }) {
  const ev = content?.evidence ?? [];
  if (!ev.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {ev.slice(0, 8).map((e, i) => <Chip key={i} className={TAG_CHIP[e.tag.toLowerCase()]}>{e.tag} · {e.source}</Chip>)}
    </div>
  );
}

function Content({ content }: { content: SectionContent }) {
  return (
    <div className="space-y-3 text-xs text-slate-300">
      {content.bullets?.length ? (
        <ul className="space-y-1.5">
          {content.bullets.map((b, i) => (
            <li key={i} className="flex gap-2 leading-relaxed">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-500" />
              <span className="min-w-0"><Rich text={b.text} /> {b.tags?.map((t) => <Chip key={t} className={cx("ml-1", TAG_CHIP[t.toLowerCase()])}>{t}</Chip>)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {content.table && <Table columns={content.table.columns} rows={content.table.rows} />}
      {content.note && <p className="text-[11px] text-slate-400">{content.note}</p>}
      {content.open_items?.length ? (
        <div className="rounded-lg border border-amber-500/15 bg-amber-500/5 p-2.5">
          <p className="text-[9px] font-extrabold uppercase tracking-wider text-amber-300">Open items</p>
          <ul className="mt-1 list-disc pl-4 text-[11px] text-amber-200/90">{content.open_items.map((o) => <li key={o}>{o}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

function Table({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-[11px]">
        <thead><tr className="text-[9px] uppercase tracking-wider text-slate-500">{columns.map((c) => <th key={c} className="py-1 pr-3 font-bold">{c}</th>)}</tr></thead>
        <tbody className="divide-y divide-white/[0.04]">
          {rows.map((r, i) => (
            <tr key={i} className={cx("align-top", /^maintainable$/i.test(r[0] ?? "") && "font-bold text-white")}>
              {r.map((cell, j) => <td key={j} className="py-1.5 pr-3 text-slate-300"><ResultCell text={cell} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultCell({ text }: { text: string }) {
  const up = text.trim().toUpperCase();
  const style: Record<string, string> = {
    PASS: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    OPEN: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    CONDITION: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    PRICE: "bg-rose-500/10 text-rose-300 border-rose-500/20",
    FAIL: "bg-rose-500/10 text-rose-300 border-rose-500/20",
  };
  if (style[up]) return <Chip className={style[up]}>{up}</Chip>;
  if (TAG_CHIP[up.toLowerCase()] && ["FILED", "VENDOR", "ESTIMATED", "VERIFIED", "MGMT", "UNKNOWN", "ASSUMPTION"].includes(up)) return <Chip className={TAG_CHIP[up.toLowerCase()]}>{up}</Chip>;
  return <Rich text={text} />;
}

function DraftCard({ card: c, ranges, highlight, sendEnabled, onRegenerate, locked }: { card: SectionCard; ranges: TechniqueMapRow[]; highlight: number | null; sendEnabled: boolean; onRegenerate: () => void; locked: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = String(c.data?.text ?? "");
  const subject = String(c.data?.subject ?? "");
  const words = text.replace(/Schedule A:[\s\S]*$/, "").split(/\s+/).filter(Boolean).length;

  const gmail = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-300"><b className="text-white">Subject:</b> {subject}</p>
        <span className={cx("text-[10px] font-bold", words > 650 ? "text-rose-300" : "text-slate-500")}>{words} / 650 words</span>
      </div>
      <HighlightedDraft text={text} ranges={ranges} active={highlight} />
      {!sendEnabled && <p className="flex items-center gap-1.5 text-[11px] text-rose-300"><AlertTriangle className="h-3.5 w-3.5" /> A Gate Check row is FAIL: Copy and Send are disabled until the draft passes.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnGold} disabled={!sendEnabled} onClick={() => { navigator.clipboard.writeText(`Subject: ${subject}\n\n${text}`); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copy draft
        </button>
        <a
          href={sendEnabled ? gmail : undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!sendEnabled}
          className={cx(btnGhost, !sendEnabled && "pointer-events-none opacity-40")}
          title="Opens a Gmail draft for a partner to review and send. Never auto-sends."
        >
          <Send className="h-3 w-3" /> Create Gmail draft
        </a>
        <button type="button" className={btnGhost} disabled={locked} onClick={onRegenerate}><RefreshCw className="h-3 w-3" /> Regenerate</button>
      </div>
    </div>
  );
}

function HighlightedDraft({ text, ranges, active }: { text: string; ranges: TechniqueMapRow[]; active: number | null }) {
  const parts: Array<{ t: string; i: number | null }> = [];
  let cursor = 0;
  const sorted = ranges.map((r, i) => ({ ...r, i })).sort((a, b) => a.start - b.start);
  for (const r of sorted) {
    if (r.start < cursor) continue;
    if (r.start > cursor) parts.push({ t: text.slice(cursor, r.start), i: null });
    parts.push({ t: text.slice(r.start, r.end), i: r.i });
    cursor = r.end;
  }
  parts.push({ t: text.slice(cursor), i: null });
  return (
    <div className="rounded-xl border border-white/5 bg-acp-portal-bg p-4 text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">
      {parts.map((p, k) => (
        <span key={k} className={cx(p.i != null && (active == null || active === p.i) && HIGHLIGHTS[p.i % HIGHLIGHTS.length], p.i != null && active === p.i && "ring-1 ring-acp-bronze/60 rounded")}>{p.t}</span>
      ))}
    </div>
  );
}

function TechniqueMapCard({ map, highlight, onPick }: { map: TechniqueMapRow[]; highlight: number | null; onPick: (i: number | null) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-slate-500">Click a row to highlight its line in the draft (card 15), same colour.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-[11px]">
          <thead><tr className="text-[9px] uppercase tracking-wider text-slate-500"><th className="py-1 pr-3">Technique</th><th className="py-1 pr-3">Source</th><th className="py-1">Line in draft</th></tr></thead>
          <tbody className="divide-y divide-white/[0.04]">
            {map.map((m, i) => (
              <tr key={i} onClick={() => onPick(highlight === i ? null : i)} className={cx("cursor-pointer align-top transition hover:bg-white/[0.02]", highlight === i && "bg-white/[0.03]")}>
                <td className="py-1.5 pr-3"><span className={cx("rounded px-1.5 py-0.5 font-bold text-white", HIGHLIGHTS[i % HIGHLIGHTS.length])}>{m.codes.join(", ")}</span></td>
                <td className="py-1.5 pr-3 text-slate-400">{m.source}</td>
                <td className="py-1.5 text-slate-300" title={m.codes.map((c) => TECHNIQUE_BY_CODE[c]?.name).join(" · ")}>{m.line}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GateCheckCard({ card: c }: { card: SectionCard }) {
  const [more, setMore] = useState(false);
  const gate = (c.data?.gate_check ?? []) as LintRow[];
  const lint = [...((c.data?.technique_lint ?? []) as LintRow[]), ...((c.data?.style ?? []) as LintRow[])];
  const row = (r: LintRow) => (
    <div key={r.rule} className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0"><p className="text-[11px] text-slate-200">{r.label}</p>{r.result === "FAIL" && <p className="text-[10px] text-rose-300">{r.detail}</p>}</div>
      <Chip className={r.result === "PASS" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" : "bg-rose-500/10 text-rose-300 border-rose-500/20"}>{r.result}</Chip>
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="divide-y divide-white/[0.04]">{gate.map(row)}</div>
      <p className="text-[10px] text-slate-500">Any FAIL disables Copy and Send, and names the failing rule.</p>
      <button type="button" onClick={() => setMore((m) => !m)} className="text-[10px] font-bold uppercase tracking-wider text-acp-bronze hover:underline cursor-pointer">
        {more ? "Hide" : "Show"} technique and style lint ({lint.filter((r) => r.result === "FAIL").length} fail)
      </button>
      {more && <div className="divide-y divide-white/[0.04]">{lint.map(row)}</div>}
    </div>
  );
}

function LogCard({ card: c, isPartner, sendEnabled, busy, onWrite }: { card: SectionCard; isPartner: boolean; sendEnabled: boolean; busy: boolean; onWrite: () => void }) {
  const log = (c.data?.log_row ?? {}) as Record<string, unknown>;
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-[9px] font-extrabold uppercase tracking-wider text-slate-500">H · Predicted replies</p>
        <Content content={c.content} />
      </div>
      <div>
        <p className="mb-1 text-[9px] font-extrabold uppercase tracking-wider text-slate-500">I · Negotiation Log row</p>
        <Table
          columns={["Field", "Value"]}
          rows={[
            ["Exchange", `${log.exchange_no ?? "—"} · ${log.direction ?? "outbound"}`],
            ["Deal ref", String(log.deal_ref ?? "")],
            ["Counterparty / role", String(log.counterparty ?? "")],
            ["Move type", String(log.move_type ?? "")],
            ["Techniques", ((log.techniques as string[]) ?? []).join(", ")],
            ["Moved", "Pending"],
            ["Next move", String(log.next_move ?? "")],
            ["Live figures", "None (H-08)"],
          ]}
        />
      </div>
      {isPartner && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnGold} disabled={busy || !sendEnabled} onClick={onWrite}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookOpen className="h-3 w-3" />} Write to Negotiation Log (Notion)
          </button>
          <span className="text-[10px] text-slate-500">No live figures (H-08){!sendEnabled ? " · blocked while the gate check fails" : ""}</span>
        </div>
      )}
    </div>
  );
}

function Comments({ comments, onAdd, busy }: { comments: Array<{ by: string; at: string; text: string }>; onAdd: (t: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return (
    <div className="mt-3 border-t border-white/[0.04] pt-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-white cursor-pointer">
        <MessageSquare className="h-3 w-3" /> Comment{comments.length ? `s (${comments.length})` : ""}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {comments.map((c, i) => <p key={i} className="text-[11px] text-slate-300"><b className="text-white">{c.by}</b> <span className="text-slate-500">{new Date(c.at).toLocaleString("en-GB")}</span><br />{c.text}</p>)}
          <div className="flex gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment" className="h-8 flex-1 rounded-lg border border-white/[0.06] bg-white/[0.015] px-2 text-xs text-white" />
            <button type="button" className={btnGhost} disabled={busy || !text.trim()} onClick={() => { onAdd(text.trim()); setText(""); }}>{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Post"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Export (section 8 never exports externally) ───────────────────────────
function exportHtml(intel: IntelligenceView, visible: SectionKey[], dealName: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const bold = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const body = SECTIONS
    .filter((s) => visible.includes(s.key) && !SECTION_BY_KEY[s.key].partnersOnly && intel.sections[s.key])
    .map((s) => {
      const c = intel.sections[s.key]!;
      let html = `<h2>${s.key}${s.letter ? ` · ${s.letter}` : ""} · ${esc(s.title)}</h2>`;
      if (s.key === "15") html += `<p><b>Subject:</b> ${esc(String(c.data?.subject ?? ""))}</p><pre>${esc(String(c.data?.text ?? ""))}</pre>`;
      const ct = c.content;
      if (ct.bullets?.length) html += `<ul>${ct.bullets.map((b) => `<li>${bold(b.text)}${b.tags?.length ? ` [${b.tags.join(", ")}]` : ""}</li>`).join("")}</ul>`;
      if (ct.table) html += `<table border="1" cellpadding="4" cellspacing="0"><tr>${ct.table.columns.map((c2) => `<th>${esc(c2)}</th>`).join("")}</tr>${ct.table.rows.map((r) => `<tr>${r.map((x) => `<td>${bold(x)}</td>`).join("")}</tr>`).join("")}</table>`;
      if (ct.note) html += `<p>${esc(ct.note)}</p>`;
      if (ct.open_items?.length) html += `<p><b>Open items:</b> ${ct.open_items.map(esc).join("; ")}</p>`;
      return html;
    })
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(dealName)} · Deal Intelligence</title>
<style>body{font-family:Inter,Arial,sans-serif;font-size:11pt;color:#111;max-width:820px;margin:24px auto}h1{font-size:18pt}h2{font-size:12pt;margin-top:20px;border-bottom:1px solid #ccc}table{border-collapse:collapse;width:100%;font-size:10pt}pre{white-space:pre-wrap;font-family:inherit;background:#f6f5f2;padding:10px}</style></head>
<body><h1>${esc(dealName)} · Deal Intelligence</h1><p>Generated ${intel.generated_at ? new Date(intel.generated_at).toLocaleString("en-GB") : ""}. Section 8 (Structure · DSCR · EV) is internal and excluded from exports.</p>${body}</body></html>`;
}

function ExportButtons({ intel, visible, dealName }: { intel: IntelligenceView | null; visible: SectionKey[]; dealName: string }) {
  const doc = () => {
    if (!intel) return;
    const blob = new Blob([exportHtml(intel, visible, dealName)], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dealName.replace(/[^\w-]+/g, "_")}_Deal_Intelligence.doc`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const pdf = () => {
    if (!intel) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(exportHtml(intel, visible, dealName));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };
  return (
    <>
      <button type="button" className={btnGhost} disabled={!intel} onClick={pdf} title="Print to PDF (section 8 excluded)"><Printer className="h-3 w-3" /> PDF</button>
      <button type="button" className={btnGold} disabled={!intel} onClick={doc} title="Word document (section 8 excluded)"><Download className="h-3 w-3" /> Export Doc</button>
    </>
  );
}
