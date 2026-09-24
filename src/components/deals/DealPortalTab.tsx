/**
 * Investor Portal tab — the partner-facing side of one deal.
 *
 * Two jobs:
 *   1. How partners see the deal: the display name (never the company's real
 *      name before announcement — rule R3), the Business tab profile, and the
 *      reporting fields their dashboard shows.
 *   2. Who is in it: the capital partners committed to this deal. A partner
 *      sees the deal in their portal only once their commitment is completed.
 *
 * Coverage status has one author, the CFO (rule R4); other roles see it read
 * only, and the database refuses them even if this control is bypassed.
 */
import { useCallback, useEffect, useState } from "react";
import { Eye, Landmark, Loader2, Plus, Save } from "lucide-react";
import {
  getPartnerDealSettings,
  listCommitments,
  savePartnerDealSettings,
  setCoverageStatus,
  type PartnerDealSettings,
} from "../../api/admin/partners";
import { useAuth } from "../../context/AuthContext";
import { gbp } from "../../lib/portal/format";
import { cx } from "../../utils/cx";
import { IN_PORTAL } from "../../lib/portal/commitments";
import { CommitmentCard, NewCommitmentForm } from "../partners/CommitmentPanels";

/** Mirrors PARTNER_MANAGERS in api/_lib/authz.ts. */
const PARTNER_MANAGERS = ["owner", "super_admin", "managing_partner", "partner", "admin", "cfo"];

const input =
  "w-full rounded-lg border border-white/10 bg-[#0F1115] px-3 py-2 text-sm text-white outline-none transition focus:border-[#C6A66B] disabled:opacity-60";
const label = "mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500";
const card = "rounded-2xl border border-white/[0.04] bg-[#161B22] p-5";

const AMORT = [
  ["not_started", "Not started"],
  ["on_schedule", "On schedule"],
  ["ahead", "Ahead"],
  ["behind", "Behind"],
] as const;

const COVERAGE = [
  ["not_yet_reported", "Not yet reported"],
  ["above_floor", "Above floor"],
  ["watch", "Watch"],
  ["breach", "Breach"],
] as const;

interface Form {
  partner_display_name: string;
  sector: string;
  region: string;
  summary: string;
  customer_types: string;
  headcount_band: string;
  founded_year: string;
  amort_status: string;
  next_report_date: string;
  contracted_pct: string;
}

function toForm(s: PartnerDealSettings): Form {
  const p = s.profile ?? {};
  return {
    partner_display_name: s.deal.partner_display_name ?? "",
    sector: p.sector ?? "",
    region: p.region ?? "",
    summary: p.summary ?? "",
    customer_types: Array.isArray(p.customer_types) ? p.customer_types.join(", ") : "",
    headcount_band: p.headcount_band ?? "",
    founded_year: p.founded_year ? String(p.founded_year) : "",
    amort_status: s.deal.amort_status ?? "not_started",
    next_report_date: s.deal.next_report_date ?? "",
    contracted_pct:
      s.deal.contracted_bp_verified !== null && s.deal.contracted_bp_verified !== undefined
        ? String(s.deal.contracted_bp_verified / 100)
        : "",
  };
}

export function DealPortalTab({ dealId }: { dealId: string }) {
  const { user } = useAuth();
  const role = String(user?.role ?? "").toLowerCase().replace(/[\s_]+/g, "_");
  const canManage = PARTNER_MANAGERS.includes(role);

  const [settings, setSettings] = useState<PartnerDealSettings | null>(null);
  const [commitments, setCommitments] = useState<Array<Record<string, any>>>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        getPartnerDealSettings(dealId, { noCache: true }),
        listCommitments({ deal_id: dealId }),
      ]);
      setSettings(s);
      setCommitments(c.rows);
      setForm((prev) => prev ?? toForm(s));
      setError("");
    } catch (err: any) {
      setError(err?.message || "Could not load the investor portal settings.");
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!settings || !form) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-xs text-slate-500">
        {error ? <span className="text-rose-300">{error}</span> : <><Loader2 className="h-4 w-4 animate-spin text-[#C6A66B]" /> Loading…</>}
      </div>
    );
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setSaved(false);
    setForm({ ...form, [k]: e.target.value });
  };

  const live = commitments.filter((c) => IN_PORTAL.has(c.status));
  const pending = commitments.filter((c) => c.status === "pending");
  const sum = (list: Array<Record<string, any>>) => list.reduce((n, c) => n + Number(c.committed_pence || 0), 0);
  const committedTotal = sum(live);
  const pendingTotal = sum(pending);
  const nameMatchesCompany =
    form.partner_display_name.trim() !== "" &&
    form.partner_display_name.trim().toLowerCase() === String(settings.deal.company_name ?? "").trim().toLowerCase();

  const save = async () => {
    const pctNum = form.contracted_pct.trim() === "" ? null : Number(form.contracted_pct);
    if (pctNum !== null && (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100)) {
      setError("Contracted revenue must be a percentage from 0 to 100.");
      return;
    }
    const year = form.founded_year.trim() === "" ? null : Number(form.founded_year);
    if (year !== null && (!Number.isInteger(year) || year < 1800 || year > new Date().getFullYear())) {
      setError("Founded year must be a four-digit year.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await savePartnerDealSettings({
        deal_id: dealId,
        partner_display_name: form.partner_display_name.trim() || null,
        amort_status: form.amort_status,
        next_report_date: form.next_report_date || null,
        contracted_bp_verified: pctNum === null ? null : Math.round(pctNum * 100),
        profile: {
          sector: form.sector.trim() || null,
          region: form.region.trim() || null,
          summary: form.summary.trim() || null,
          customer_types: form.customer_types
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          headcount_band: form.headcount_band.trim() || null,
          founded_year: year,
        },
      });
      setSaved(true);
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in-up">
      {/* Status */}
      <div
        className={cx(
          "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-4",
          live.length ? "border-emerald-500/20 bg-emerald-500/[0.05]" : "border-white/[0.06] bg-[#161B22]",
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className={cx(
              "flex h-9 w-9 items-center justify-center rounded-xl border",
              live.length ? "border-emerald-500/30 bg-emerald-500/10" : "border-white/10 bg-white/[0.03]",
            )}
          >
            <Landmark className={cx("h-4 w-4", live.length ? "text-emerald-300" : "text-slate-400")} />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">
              {live.length
                ? `In the portal for ${live.length} partner${live.length === 1 ? "" : "s"}`
                : "Not in the investor portal yet"}
            </p>
            <p className="text-[11px] text-slate-500">
              {live.length
                ? `Partners see it as “${settings.deal.partner_display_name || "Acquisition"}”.`
                : "Add a partner commitment below and mark it completed to publish this deal to them."}
              {pending.length ? ` ${pending.length} pending commitment${pending.length === 1 ? "" : "s"}.` : ""}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Committed</p>
          <p className="text-lg font-bold tabular-nums text-white">{committedTotal ? gbp(committedTotal) : "—"}</p>
          {pendingTotal ? <p className="text-[10px] tabular-nums text-slate-500">+ {gbp(pendingTotal)} pending</p> : null}
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-5">
        {/* How partners see it */}
        <section className={cx(card, "space-y-4 xl:col-span-2")}>
          <div className="flex items-center gap-2">
            <Eye className="h-3.5 w-3.5 text-[#C6A66B]" />
            <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">How partners see it</h3>
          </div>

          <div>
            <label className={label} htmlFor="p-name">
              Partner-facing name
            </label>
            <input
              id="p-name"
              value={form.partner_display_name}
              onChange={set("partner_display_name")}
              placeholder="e.g. Midlands Care Group"
              className={input}
              disabled={!canManage}
            />
            <p className={cx("mt-1 text-[10px] leading-relaxed", nameMatchesCompany ? "text-amber-300" : "text-slate-500")}>
              {nameMatchesCompany
                ? "This is the company’s real name. Partners must not see it before announcement — use a descriptive name instead."
                : "Shown to partners instead of the company name, seller, lender or CFS code, which the portal never shows."}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Sector</label>
              <input value={form.sector} onChange={set("sector")} placeholder="Domiciliary care" className={input} disabled={!canManage} />
            </div>
            <div>
              <label className={label}>Region</label>
              <input value={form.region} onChange={set("region")} placeholder="West Midlands" className={input} disabled={!canManage} />
            </div>
            <div>
              <label className={label}>Headcount</label>
              <input value={form.headcount_band} onChange={set("headcount_band")} placeholder="50–100" className={input} disabled={!canManage} />
            </div>
            <div>
              <label className={label}>Founded</label>
              <input
                inputMode="numeric"
                value={form.founded_year}
                onChange={set("founded_year")}
                placeholder="2009"
                className={input}
                disabled={!canManage}
              />
            </div>
          </div>

          <div>
            <label className={label}>Customer types</label>
            <input
              value={form.customer_types}
              onChange={set("customer_types")}
              placeholder="Local authority, NHS, private pay"
              className={input}
              disabled={!canManage}
            />
            <p className="mt-1 text-[10px] text-slate-500">Separate with commas.</p>
          </div>

          <div>
            <label className={label}>Summary</label>
            <textarea
              value={form.summary}
              onChange={set("summary")}
              rows={4}
              placeholder="What the business does, in two or three plain sentences. Legal-reviewed text only."
              className={cx(input, "resize-y leading-relaxed")}
              disabled={!canManage}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Amortisation</label>
              <select value={form.amort_status} onChange={set("amort_status")} className={input} disabled={!canManage}>
                {AMORT.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Next report</label>
              <input type="date" value={form.next_report_date} onChange={set("next_report_date")} className={input} disabled={!canManage} />
            </div>
            <div>
              <label className={label}>Contracted revenue (%)</label>
              <input
                inputMode="decimal"
                value={form.contracted_pct}
                onChange={set("contracted_pct")}
                placeholder="61"
                className={input}
                disabled={!canManage}
              />
            </div>
          </div>

          <CoverageControl settings={settings} onChanged={load} />

          {error ? <p className="rounded border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p> : null}

          {canManage ? (
            <div className="flex items-center justify-end gap-3">
              {saved ? <span className="text-[11px] text-emerald-400">Saved</span> : null}
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#C6A66B] px-3.5 py-2 text-xs font-bold text-[#0F1115] transition hover:brightness-110 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save portal details
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">Only an admin or the CFO can change what partners see.</p>
          )}
        </section>

        {/* Partner commitments */}
        <section className={cx(card, "space-y-3 xl:col-span-3")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">
              Partner commitments{commitments.length ? ` · ${commitments.length}` : ""}
            </h3>
            {canManage && !adding ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#C6A66B] px-3 py-1.5 text-xs font-bold text-[#0F1115] transition hover:brightness-110"
              >
                <Plus className="h-3.5 w-3.5" /> Add partner commitment
              </button>
            ) : null}
          </div>

          {adding ? (
            <NewCommitmentForm
              dealId={dealId}
              onCancel={() => setAdding(false)}
              onDone={async () => {
                setAdding(false);
                await load();
              }}
            />
          ) : null}

          {commitments.length === 0 && !adding ? (
            <div className="rounded-xl border border-dashed border-white/10 px-6 py-10 text-center">
              <p className="text-sm text-slate-300">No capital partners in this deal yet.</p>
              <p className="mt-1.5 text-xs text-slate-500">
                Add a partner commitment, then mark it completed when subscription documents are executed.
              </p>
            </div>
          ) : (
            commitments.map((c) => (
              <CommitmentCard
                key={c.id}
                c={c}
                heading={c.investors?.name ?? "Capital partner"}
                sub={c.investors?.email}
                canManage={canManage}
                onChanged={load}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
}

/** Coverage status — CFO only (rule R4). Everyone else sees it read only. */
function CoverageControl({ settings, onChanged }: { settings: PartnerDealSettings; onChanged: () => Promise<void> }) {
  const [status, setStatus] = useState(settings.deal.dscr_status);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = COVERAGE.find(([v]) => v === settings.deal.dscr_status)?.[1] ?? settings.deal.dscr_status;

  if (!settings.can_set_coverage) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Debt coverage</span>
        <span className="text-xs text-slate-300">
          {current} <span className="text-[10px] text-slate-500">· set by the CFO</span>
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Debt coverage (CFO)</p>
      <div className="flex flex-wrap gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={cx(input, "w-auto")}>
          {COVERAGE.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Basis (e.g. Q3 management accounts)" className={cx(input, "min-w-[180px] flex-1")} />
        <button
          type="button"
          disabled={busy || status === settings.deal.dscr_status}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await setCoverageStatus({ deal_id: settings.deal.id, dscr_status: status as any, basis_note: note || null });
              setNote("");
              await onChanged();
            } catch (err: any) {
              setError(err?.message || "Could not set coverage.");
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-[#C6A66B]/40 disabled:opacity-40"
        >
          Set
        </button>
      </div>
      {error ? <p className="text-[10px] text-rose-300">{error}</p> : null}
    </div>
  );
}
