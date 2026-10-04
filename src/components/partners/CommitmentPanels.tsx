/**
 * Commitments — the link between a capital partner and a deal.
 *
 * A deal reaches a partner's portal through a commitment, and only once that
 * commitment is completed: the portal's views read completed, converted and
 * bought-back commitments, never pending ones. So the lifecycle here is the
 * publishing workflow:
 *
 *   record (pending)  →  mark completed (ownership set, figures lock, deal
 *   appears in the portal)  →  capital calls and distributions (count towards
 *   Paid and Returned once settled)
 *
 * Completion needs that partner's Completion and Ownership Statement (payment
 * receipt) and Share Certificate filed under Ownership first; Postgres refuses
 * it otherwise. A test holding (is_test) reaches only test partners.
 *
 * The same pieces serve both doors in: the partner record (pick a deal) and the
 * deal's Investor Portal tab (pick a partner). The rules behind them — the
 * lock after completion, the CFO sanction reference on distributions, evidence
 * before settling — are enforced by the API and Postgres; these forms explain
 * them up front rather than deciding them.
 */
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, Eye, EyeOff, Loader2, Plus, Search, X } from "lucide-react";
import {
  completeCommitment,
  createCommitment,
  setCommitmentTest,
  listPartners,
  recordTransaction,
  searchDeals,
  settleTransaction,
  type DealOption,
  type PartnerListRow,
} from "../../api/admin/partners";
import { formatDate, gbp, pct } from "../../lib/portal/format";
import { IN_PORTAL } from "../../lib/portal/commitments";
import { cx } from "../../utils/cx";

const input =
  "w-full rounded border border-white/10 bg-acp-ink px-3 py-2 text-sm text-white outline-none transition focus:border-acp-bronze";
const label = "mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500";
const primaryBtn =
  "rounded bg-acp-bronze px-3.5 py-2 text-xs font-bold text-acp-on-accent transition hover:bg-acp-bronze-light disabled:cursor-not-allowed disabled:opacity-40";
const ghostBtn =
  "rounded border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-acp-bronze/40 disabled:opacity-40";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  completed: "Completed",
  converted: "Converted",
  bought_back: "Bought back",
};

/** "£250,000" or "250000.50" → integer pence, or null if it is not a positive amount. */
function toPence(raw: string): number | null {
  const n = Number(raw.replace(/[£,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** "12.5" (%) → 1250 basis points, or null when outside 0–100. */
function toBp(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw.replace(/[%\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

const today = () => new Date().toISOString().slice(0, 10);

const Err = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{children}</p>
);

export function PortalBadge({ status }: { status: string }) {
  const live = IN_PORTAL.has(status);
  return (
    <span
      title={live ? "This deal shows in the partner's portal" : "Not visible to the partner until marked completed"}
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] font-semibold",
        live
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-white/10 bg-white/5 text-slate-400",
      )}
    >
      {live ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
      {live ? "In portal" : "Not in portal yet"}
    </span>
  );
}

// ─── Pickers ───────────────────────────────────────────────────────────────

function DealPicker({ value, onChange }: { value: DealOption | null; onChange: (d: DealOption | null) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<DealOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (value) return;
    let live = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      searchDeals(q)
        .then((res) => live && setRows(res.rows))
        .catch(() => live && setRows([]))
        .finally(() => live && setLoading(false));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q, value]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded border border-acp-bronze/40 bg-acp-bronze/5 px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate text-sm text-white">{value.company_name || value.deal_name || "Deal"}</span>
          <span className="block truncate text-[10px] text-slate-500">
            {value.acp_ref_no ?? "No ref"}
            {value.partner_display_name ? ` · partners see “${value.partner_display_name}”` : " · no partner-facing name yet"}
          </span>
        </span>
        <button type="button" onClick={() => onChange(null)} className="shrink-0 text-slate-400 hover:text-white" aria-label="Change deal">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by company, ref or sector"
          className={cx(input, "pl-8")}
          autoFocus
        />
      </div>
      <div className="mt-1.5 max-h-52 overflow-y-auto rounded border border-white/5">
        {loading ? (
          <p className="flex items-center gap-2 px-3 py-3 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching deals…
          </p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-3 text-xs text-slate-500">{q ? "No Active-stage deals match." : "No deals at the Active stage."}</p>
        ) : (
          rows.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onChange(d)}
              className="flex w-full items-center justify-between gap-2 border-b border-white/5 px-3 py-2 text-left transition last:border-b-0 hover:bg-white/[0.04]"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-slate-200">
                  {d.company_name || d.deal_name || "Untitled deal"}
                </span>
                <span className="block truncate text-[10px] text-slate-500">
                  {d.acp_ref_no ?? "No ref"}
                  {d.partner_display_name ? ` · “${d.partner_display_name}”` : ""}
                </span>
              </span>
              <span className="shrink-0 text-[10px] text-emerald-400">Active</span>
            </button>
          ))
        )}
      </div>
      {!q ? <p className="mt-1 text-[10px] text-slate-500">Only deals at the Active stage can take subscriptions.</p> : null}
    </div>
  );
}

function PartnerPicker({
  value,
  onChange,
}: {
  value: PartnerListRow | null;
  onChange: (p: PartnerListRow | null) => void;
}) {
  const [all, setAll] = useState<PartnerListRow[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    listPartners({ noCache: true })
      .then((res) => setAll(res.rows.filter((r) => r.status !== "passed" && r.status !== "ended")))
      .catch(() => setAll([]));
  }, []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (all ?? []).filter((p) => !needle || `${p.name} ${p.email} ${p.entity ?? ""}`.toLowerCase().includes(needle));
  }, [all, q]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded border border-acp-bronze/40 bg-acp-bronze/5 px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate text-sm text-white">{value.name}</span>
          <span className="block truncate text-[10px] text-slate-500">{value.email}</span>
        </span>
        <button type="button" onClick={() => onChange(null)} className="shrink-0 text-slate-400 hover:text-white" aria-label="Change partner">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search capital partners" className={cx(input, "pl-8")} autoFocus />
      </div>
      <div className="mt-1.5 max-h-52 overflow-y-auto rounded border border-white/5">
        {all === null ? (
          <p className="flex items-center gap-2 px-3 py-3 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading partners…
          </p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-3 text-xs text-slate-500">
            {all.length ? "No partners match." : "No capital partners yet — add one under Investors."}
          </p>
        ) : (
          rows.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(p)}
              className="flex w-full items-center justify-between gap-2 border-b border-white/5 px-3 py-2 text-left transition last:border-b-0 hover:bg-white/[0.04]"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-slate-200">{p.name}</span>
                <span className="block truncate text-[10px] text-slate-500">{p.email}</span>
              </span>
              {!p.certified_now ? <span className="shrink-0 text-[10px] text-amber-400">Not certified</span> : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ─── New commitment ────────────────────────────────────────────────────────

/**
 * Record a commitment. Pass `investorId` from the partner record (the deal is
 * picked) or `dealId` from the deal page (the partner is picked).
 */
export function NewCommitmentForm({
  investorId,
  dealId,
  onDone,
  onCancel,
}: {
  investorId?: string;
  dealId?: string;
  onDone: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [deal, setDeal] = useState<DealOption | null>(null);
  const [partner, setPartner] = useState<PartnerListRow | null>(null);
  const [amount, setAmount] = useState("");
  const [isTest, setIsTest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pence = toPence(amount);
  const targetDeal = dealId ?? deal?.id;
  const targetInvestor = investorId ?? partner?.id;
  const ready = Boolean(targetDeal && targetInvestor && pence);

  const submit = async () => {
    if (!targetDeal || !targetInvestor || !pence) return;
    setBusy(true);
    setError("");
    try {
      await createCommitment({ investor_id: targetInvestor, deal_id: targetDeal, committed_pence: pence, is_test: isTest });
      await onDone();
    } catch (err: any) {
      setError(err?.message || "The subscription could not be recorded.");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded border border-acp-bronze/30 bg-acp-bronze/[0.04] p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-acp-bronze">Record a subscription</p>
        <button type="button" onClick={onCancel} className="text-slate-500 hover:text-slate-200" aria-label="Cancel">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!dealId ? (
        <div>
          <p className={label}>Deal</p>
          <DealPicker value={deal} onChange={setDeal} />
          {deal && !deal.partner_display_name ? (
            <p className="mt-1.5 text-[10px] leading-relaxed text-amber-300">
              This deal has no partner-facing name, so the portal will call it “Acquisition”. Set one on the deal’s
              Investor Portal tab — never the company’s real name before announcement.
            </p>
          ) : null}
        </div>
      ) : null}

      {!investorId ? (
        <div>
          <p className={label}>Capital partner</p>
          <PartnerPicker value={partner} onChange={setPartner} />
        </div>
      ) : null}

      <div>
        <label className={label} htmlFor="commit-amount">
          Amount subscribed (£)
        </label>
        <input
          id="commit-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="250,000"
          className={input}
        />
        {amount && !pence ? <p className="mt-1 text-[10px] text-rose-300">Enter an amount above zero.</p> : null}
        {pence ? <p className="mt-1 text-[10px] text-slate-500">{gbp(pence)}</p> : null}
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={isTest}
          onChange={(e) => setIsTest(e.target.checked)}
          className="mt-0.5 accent-acp-bronze"
        />
        <span>
          Test holding
          <span className="block text-[10px] text-slate-500">Shown only to test partners, never to a real one.</span>
        </span>
      </label>

      <p className="text-[10px] leading-relaxed text-slate-500">
        It is saved as pending. Mark it completed once this partner’s Completion and Ownership Statement and Share
        Certificate are filed under Ownership.
      </p>

      {error ? <Err>{error}</Err> : null}

      <div className="flex justify-end gap-2">
        <button type="button" className={ghostBtn} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={primaryBtn} disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 inline h-3.5 w-3.5" />}
          Record subscription
        </button>
      </div>
    </div>
  );
}

// ─── One commitment ────────────────────────────────────────────────────────

type Mode = null | "complete" | "transaction";

// ─── Payment status ────────────────────────────────────────────────────────

type PaymentState = "paid" | "overdue" | "awaiting" | "part_paid" | "not_called";

const PAYMENT_STATE: Record<PaymentState, { label: string; tone: string }> = {
  paid: { label: "Paid in full", tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  overdue: { label: "Payment overdue", tone: "border-rose-500/30 bg-rose-500/10 text-rose-300" },
  awaiting: { label: "Payment pending", tone: "border-amber-500/30 bg-amber-500/10 text-amber-200" },
  part_paid: { label: "Part paid", tone: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
  not_called: { label: "Not yet called", tone: "border-white/10 bg-white/5 text-slate-400" },
};

const sumPence = (rows: Array<Record<string, any>>) => rows.reduce((n, t) => n + Number(t.amount_pence ?? 0), 0);

/**
 * Where the money stands on one subscription, from its capital transactions.
 * Only a settled call counts as paid; a call that is recorded but not settled
 * is pending, and overdue once its due date has passed.
 */
function paymentSummary(c: Record<string, any>) {
  const txns: Array<Record<string, any>> = c.capital_transactions ?? [];
  const calls = txns.filter((t) => t.type === "call");
  const dists = txns.filter((t) => t.type === "distribution");
  const subscribed = Number(c.committed_pence ?? 0);
  const called = sumPence(calls);
  const paid = sumPence(calls.filter((t) => t.settled));
  const pending = called - paid;
  const now = today();
  const overdueCalls = calls.filter((t) => !t.settled && t.due_date && String(t.due_date) < now);
  const pendingCalls = calls.filter((t) => !t.settled);
  const settledAt = calls
    .filter((t) => t.settled)
    .map((t) => String(t.settled_at ?? t.txn_date))
    .sort();
  const state: PaymentState =
    subscribed > 0 && paid >= subscribed
      ? "paid"
      : overdueCalls.length
        ? "overdue"
        : pending > 0
          ? "awaiting"
          : paid > 0
            ? "part_paid"
            : "not_called";
  return {
    state,
    subscribed,
    called,
    paid,
    pending,
    outstanding: Math.max(0, subscribed - paid),
    notCalled: Math.max(0, subscribed - called),
    overdueCalls,
    pendingCalls,
    firstCallDate: calls.map((t) => String(t.txn_date)).sort()[0] ?? null,
    lastPaidAt: settledAt[settledAt.length - 1] ?? null,
    returned: sumPence(dists.filter((t) => t.settled)),
    distPending: sumPence(dists.filter((t) => !t.settled)),
  };
}

function PaymentPill({ state }: { state: PaymentState }) {
  const s = PAYMENT_STATE[state];
  return <span className={cx("rounded-full border px-2 py-[3px] text-[10px] font-semibold", s.tone)}>{s.label}</span>;
}

/** The Status tab: what has been subscribed, called, paid and is still owed, and each milestone. */
function StatusPanel({ c }: { c: Record<string, any> }) {
  const s = paymentSummary(c);
  const pctPaid = s.subscribed ? Math.min(100, Math.round((s.paid / s.subscribed) * 100)) : 0;
  const steps: Array<{ label: string; done: boolean; detail: string }> = [
    { label: "Subscription recorded", done: true, detail: `${gbp(s.subscribed)} · ${formatDate(c.created_at)}` },
    {
      label: "Capital called",
      done: s.called > 0,
      detail: s.called > 0 ? `${gbp(s.called)} · first call ${formatDate(s.firstCallDate)}` : "No call recorded yet",
    },
    {
      label: "Payment received",
      done: s.state === "paid",
      detail:
        s.paid > 0
          ? `${gbp(s.paid)} of ${gbp(s.subscribed)}${s.lastPaidAt ? ` · last settled ${formatDate(s.lastPaidAt)}` : ""}`
          : "Nothing settled yet",
    },
    {
      label: "Completed and in the partner's portal",
      done: IN_PORTAL.has(c.status),
      detail: c.completed_at ? formatDate(c.completed_at) : "Not yet completed",
    },
  ];
  if (c.status === "converted") steps.push({ label: "Converted to holdco shares", done: true, detail: formatDate(c.converted_at) });
  if (c.status === "bought_back") steps.push({ label: "Bought back", done: true, detail: formatDate(c.bought_back_at) });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <PaymentPill state={s.state} />
        <span className="text-[11px] text-slate-400">
          {gbp(s.paid)} of {gbp(s.subscribed)} paid ({pctPaid}%)
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${pctPaid}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat k="Subscribed" v={gbp(s.subscribed)} />
        <Stat k="Paid (settled)" v={s.paid ? gbp(s.paid) : "—"} />
        <Stat k="Pending (called)" v={s.pending ? gbp(s.pending) : "—"} />
        <Stat k="Still owed" v={s.outstanding ? gbp(s.outstanding) : "—"} />
        <Stat k="Not yet called" v={s.notCalled ? gbp(s.notCalled) : "—"} />
        <Stat k="Returned" v={s.returned ? gbp(s.returned) : "—"} />
        <Stat k="Distribution pending" v={s.distPending ? gbp(s.distPending) : "—"} />
      </div>

      {s.pendingCalls.length ? (
        <div className="rounded border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2">
          <p className="text-[11px] font-semibold text-amber-200">Awaiting payment</p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-slate-300">
            {s.pendingCalls.map((t) => {
              const overdue = t.due_date && String(t.due_date) < today();
              return (
                <li key={t.id}>
                  {gbp(t.amount_pence)} called {formatDate(t.txn_date)}
                  {t.due_date ? (
                    <span className={overdue ? "font-semibold text-rose-300" : "text-slate-400"}>
                      {" "}
                      · {overdue ? "overdue since" : "due"} {formatDate(t.due_date)}
                    </span>
                  ) : (
                    <span className="text-slate-500"> · no due date</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[10px] text-slate-500">Settle a call with its bank evidence once the money arrives.</p>
        </div>
      ) : null}

      <ol className="space-y-1.5">
        {steps.map((step) => (
          <li key={step.label} className="flex items-start gap-2 text-[11px]">
            {step.done ? (
              <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-400" />
            ) : (
              <Circle className="mt-px h-3.5 w-3.5 shrink-0 text-slate-600" />
            )}
            <span>
              <span className={step.done ? "text-slate-200" : "text-slate-400"}>{step.label}</span>
              <span className="text-slate-500"> · {step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function CommitmentCard({
  c,
  heading,
  sub,
  canManage,
  onChanged,
}: {
  c: Record<string, any>;
  /** The deal name in the partner record, the partner name on the deal page. */
  heading: string;
  sub?: string;
  canManage: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const txns: Array<Record<string, any>> = c.capital_transactions ?? [];
  const settledCalls = txns.filter((t) => t.type === "call" && t.settled).reduce((n, t) => n + Number(t.amount_pence), 0);
  const settledDist = txns
    .filter((t) => t.type === "distribution" && t.settled)
    .reduce((n, t) => n + Number(t.amount_pence), 0);
  const live = IN_PORTAL.has(c.status);

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-100">{heading}</p>
          {sub ? <p className="truncate text-[11px] text-slate-500">{sub}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {c.is_test ? (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-[3px] text-[10px] font-semibold text-amber-200">
              Test holding
            </span>
          ) : null}
          <PaymentPill state={paymentSummary(c).state} />
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-[3px] text-[10px] font-semibold text-slate-300">
            {STATUS_LABEL[c.status] ?? c.status}
          </span>
          <PortalBadge status={c.status} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat k="Subscribed" v={gbp(c.committed_pence)} />
        <Stat k="Ownership" v={c.ownership_bp !== null && c.ownership_bp !== undefined ? pct(c.ownership_bp) : "—"} />
        <Stat k="Paid" v={settledCalls ? gbp(settledCalls) : "—"} />
        <Stat k="Returned" v={settledDist ? gbp(settledDist) : "—"} />
      </div>

      {txns.length ? (
        <div className="mt-3 divide-y divide-white/5 border-t border-white/5">
          {txns
            .slice()
            .sort((a, b) => String(b.txn_date).localeCompare(String(a.txn_date)))
            .map((t) => (
              <TransactionRow key={t.id} t={t} canManage={canManage} onChanged={onChanged} />
            ))}
        </div>
      ) : null}

      {canManage && mode === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {c.status === "pending" ? (
            <button type="button" className={cx(ghostBtn, "border-emerald-500/30 text-emerald-300")} onClick={() => setMode("complete")}>
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> Mark completed
            </button>
          ) : null}
          <button type="button" className={ghostBtn} onClick={() => setMode("transaction")}>
            <Plus className="mr-1 inline h-3.5 w-3.5" /> Status, calls and distributions
          </button>
          <TestToggle id={c.id} isTest={Boolean(c.is_test)} onChanged={onChanged} />
        </div>
      ) : null}

      {mode === "complete" ? (
        <CompleteForm
          id={c.id}
          onCancel={() => setMode(null)}
          onDone={async () => {
            setMode(null);
            await onChanged();
          }}
        />
      ) : null}
      {mode === "transaction" ? (
        <TransactionForm
          commitment={c}
          canTransact={live && c.status !== "bought_back"}
          onCancel={() => setMode(null)}
          onDone={async () => {
            setMode(null);
            await onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

/** Test holdings reach only test partners, never a real one. */
function TestToggle({ id, isTest, onChanged }: { id: string; isTest: boolean; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        className={ghostBtn}
        disabled={busy}
        title={isTest ? "Show this holding to its partner as a real record" : "Hide this holding from real partners"}
        onClick={async () => {
          if (!isTest && !window.confirm("Mark this holding as test data? Real partners will no longer see it.")) return;
          setBusy(true);
          setError("");
          try {
            await setCommitmentTest(id, !isTest);
            await onChanged();
          } catch (err: any) {
            setError(err?.message || "Could not change it.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {isTest ? "Mark as real" : "Mark as test"}
      </button>
      {error ? <Err>{error}</Err> : null}
    </span>
  );
}

const Stat = ({ k, v }: { k: string; v: string }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{k}</p>
    <p className="mt-0.5 text-sm tabular-nums text-slate-200">{v}</p>
  </div>
);

function CompleteForm({ id, onDone, onCancel }: { id: string; onDone: () => Promise<void>; onCancel: () => void }) {
  const [ownership, setOwnership] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bp = toBp(ownership);

  return (
    <div className="mt-3 space-y-2.5 rounded border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
      <p className="text-[11px] leading-relaxed text-slate-300">
        Completing puts this deal in the partner’s portal and <span className="font-semibold">locks</span> the amount
        and ownership — they cannot be edited afterwards.
      </p>
      <p className="text-[11px] leading-relaxed text-slate-400">
        This partner’s Completion and Ownership Statement (payment receipt) and Share Certificate must be filed under
        Ownership on the deal’s Investor Portal tab first.
      </p>
      <div>
        <label className={label} htmlFor={`own-${id}`}>
          Ownership (%)
        </label>
        <input
          id={`own-${id}`}
          inputMode="decimal"
          value={ownership}
          onChange={(e) => setOwnership(e.target.value)}
          placeholder="12.5"
          className={input}
          autoFocus
        />
      </div>
      {error ? <Err>{error}</Err> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={ghostBtn} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={primaryBtn}
          disabled={bp === null || busy}
          onClick={async () => {
            if (bp === null) return;
            setBusy(true);
            setError("");
            try {
              await completeCommitment(id, bp);
              await onDone();
            } catch (err: any) {
              setError(err?.message || "Could not complete the subscription.");
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
          Complete and publish
        </button>
      </div>
    </div>
  );
}

/**
 * Status first, then the two kinds of money movement. Calls and distributions
 * stay closed until the subscription is completed (and after a buyback); the
 * status is readable at every stage.
 */
function TransactionForm({
  commitment,
  canTransact,
  onDone,
  onCancel,
}: {
  commitment: Record<string, any>;
  canTransact: boolean;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const commitmentId: string = commitment.id;
  const [tab, setTab] = useState<"status" | "call" | "distribution">("status");
  const type: "call" | "distribution" = tab === "distribution" ? "distribution" : "call";
  const [amount, setAmount] = useState("");
  const [txnDate, setTxnDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [settled, setSettled] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [sanction, setSanction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pence = toPence(amount);
  const ready =
    Boolean(pence && txnDate) &&
    (!settled || evidence.trim().length > 0) &&
    (type === "call" || sanction.trim().length > 0);

  return (
    <div className="mt-3 space-y-2.5 rounded border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap gap-1">
        {(["status", "call", "distribution"] as const).map((t) => {
          const locked = t !== "status" && !canTransact;
          return (
            <button
              key={t}
              type="button"
              disabled={locked}
              title={locked ? "Available once the subscription is completed" : undefined}
              onClick={() => setTab(t)}
              className={cx(
                "rounded px-3 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
                tab === t ? "bg-acp-bronze/15 text-acp-bronze" : "text-slate-400 hover:bg-white/5",
              )}
            >
              {t === "status" ? "Status" : t === "call" ? "Capital call" : "Distribution"}
            </button>
          );
        })}
      </div>

      {tab === "status" ? (
        <>
          <StatusPanel c={commitment} />
          {!canTransact && commitment.status === "pending" ? (
            <p className="text-[10px] leading-relaxed text-slate-500">
              Capital calls and distributions open once the subscription is marked completed.
            </p>
          ) : null}
          <div className="flex justify-end">
            <button type="button" className={ghostBtn} onClick={onCancel}>
              Close
            </button>
          </div>
        </>
      ) : (
        <>
      <p className="text-[10px] leading-relaxed text-slate-500">
        {type === "call"
          ? "Money the partner pays in. It counts towards Paid on their dashboard once settled."
          : "Money returned to the partner. It needs a CFO sanction reference, and counts towards Returned once settled."}
      </p>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <label className={label}>Amount (£)</label>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50,000" className={input} />
        </div>
        <div>
          <label className={label}>{type === "call" ? "Call date" : "Distribution date"}</label>
          <input type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} className={input} />
        </div>
        {type === "call" ? (
          <div>
            <label className={label}>Due date (optional)</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={input} />
          </div>
        ) : (
          <div>
            <label className={label}>CFO sanction reference</label>
            <input value={sanction} onChange={(e) => setSanction(e.target.value)} placeholder="CFO-2026-014" className={input} />
          </div>
        )}
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
        <input type="checkbox" checked={settled} onChange={(e) => setSettled(e.target.checked)} className="accent-acp-bronze" />
        Already settled (money has moved)
      </label>
      {settled ? (
        <div>
          <label className={label}>Evidence link</label>
          <input
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="Link to the bank confirmation or remittance"
            className={input}
          />
        </div>
      ) : null}

      {error ? <Err>{error}</Err> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={ghostBtn} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={primaryBtn}
          disabled={!ready || busy}
          onClick={async () => {
            if (!pence) return;
            setBusy(true);
            setError("");
            try {
              await recordTransaction({
                commitment_id: commitmentId,
                type,
                amount_pence: pence,
                txn_date: txnDate,
                due_date: type === "call" && dueDate ? dueDate : null,
                settled,
                evidence_link: settled ? evidence.trim() : null,
                cfo_sanction_ref: type === "distribution" ? sanction.trim() : null,
              });
              await onDone();
            } catch (err: any) {
              setError(err?.message || "Could not record the transaction.");
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
          Record {type === "call" ? "call" : "distribution"}
        </button>
      </div>
        </>
      )}
    </div>
  );
}

function TransactionRow({
  t,
  canManage,
  onChanged,
}: {
  t: Record<string, any>;
  canManage: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [settling, setSettling] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kind = t.type === "call" ? "Capital call" : t.type === "distribution" ? "Distribution" : "Buyback";

  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="min-w-0 text-slate-400">
          <span className="text-slate-300">{kind}</span> · {formatDate(t.txn_date)}
          {t.due_date && !t.settled ? ` · due ${formatDate(t.due_date)}` : ""}
          {" · "}
          <span className={t.settled ? "text-emerald-400" : "text-amber-300"}>{t.settled ? "settled" : "unsettled"}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="tabular-nums text-slate-200">{gbp(t.amount_pence)}</span>
          {canManage && !t.settled && !settling ? (
            <button type="button" onClick={() => setSettling(true)} className="text-[10px] font-semibold text-acp-bronze hover:underline">
              Settle
            </button>
          ) : null}
        </span>
      </div>
      {settling ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="Evidence link (bank confirmation)"
            className={cx(input, "h-8 flex-1 py-1 text-xs")}
            autoFocus
          />
          <button
            type="button"
            className={primaryBtn}
            disabled={!evidence.trim() || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await settleTransaction(t.id, evidence.trim());
                await onChanged();
              } catch (err: any) {
                setError(err?.message || "Could not settle.");
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : "Mark settled"}
          </button>
          <button type="button" className={ghostBtn} onClick={() => setSettling(false)} disabled={busy}>
            Cancel
          </button>
          {error ? <p className="w-full text-[10px] text-rose-300">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
