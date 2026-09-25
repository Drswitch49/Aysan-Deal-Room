/**
 * Capital Partners tab (Build Pack Section 12.1 and 12.2).
 *
 * The list answers the questions an admin actually has: who is certified, who
 * can sign in, who has committed what, and who has gone stale. The drawer is
 * the partner record: details, certification, portal access, commitments and
 * the audit trail.
 *
 * Two behaviours matter more than the layout:
 *
 *  · "Issue portal access" is disabled with the reason shown when the database
 *    would refuse it — but the database still refuses if the button is bypassed.
 *    The UI explains; it does not decide.
 *
 *  · The temporary password is shown once, here, and emailed to the partner.
 *    While the portal is in notify-only mode that email goes to the admin
 *    address instead, and this says so rather than implying the partner has it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";
import {
  createPartner,
  erasePartner,
  getPartner,
  listPartners,
  partnerAccess,
  updatePartner,
  type AccessGrant,
  type PartnerListRow,
  type PartnerRecord,
} from "../../api/admin/partners";
import { formatDate, gbp } from "../../lib/portal/format";
import { dealLabel, dealSubLabel } from "../../lib/portal/commitments";
import { CommitmentCard, NewCommitmentForm } from "./CommitmentPanels";
import { cx } from "../../utils/cx";

const TYPE_LABEL: Record<string, string> = {
  holdco_equity: "Holdco equity",
  deal_equity: "Deal equity",
  prospective: "Prospective",
};

const CERT_LABEL: Record<string, string> = {
  not_certified: "Not certified",
  pending: "Pending",
  valid: "Valid",
  expired: "Expired",
};

const PORTAL_LABEL: Record<string, string> = {
  none: "None",
  pending: "Invited",
  full: "Active",
  read_only: "Read only",
  revoked: "Revoked",
};

const input =
  "w-full rounded border border-white/10 bg-[#0F1115] px-3 py-2 text-sm text-white outline-none focus:border-acp-bronze";
const label = "mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500";
const primaryBtn =
  "rounded bg-acp-bronze px-3.5 py-2 text-xs font-bold text-[#0F1115] transition hover:bg-acp-bronze-light disabled:cursor-not-allowed disabled:opacity-40";
const ghostBtn =
  "rounded border border-white/10 px-3.5 py-2 text-xs font-semibold text-slate-300 transition hover:border-acp-bronze/40 disabled:opacity-40";

function Pill({ tone, children }: { tone: "ok" | "warn" | "bad" | "mute"; children: React.ReactNode }) {
  const tones = {
    ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    bad: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    mute: "border-white/10 bg-white/5 text-slate-400",
  } as const;
  return (
    <span className={cx("inline-flex rounded-full border px-2 py-[3px] text-[10px] font-semibold", tones[tone])}>
      {children}
    </span>
  );
}

const certTone = (row: { certification_status: string; certified_now: boolean }) =>
  row.certified_now ? "ok" : row.certification_status === "pending" ? "warn" : "bad";

const portalTone = (mode: string) =>
  mode === "full" ? "ok" : mode === "pending" || mode === "read_only" ? "warn" : mode === "revoked" ? "bad" : "mute";

export function CapitalPartnersTab({ canManage, canErase = false }: { canManage: boolean; canErase?: boolean }) {
  const [rows, setRows] = useState<PartnerListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<"all" | "certified" | "portal" | "stale">("all");

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await listPartners({ noCache: true });
      setRows(res.rows);
    } catch (err: any) {
      setError(err?.message || "Could not load capital partners.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (!rows) return [];
    switch (filter) {
      case "certified":
        return rows.filter((r) => r.certified_now);
      case "portal":
        return rows.filter((r) => r.login_mode === "full" || r.login_mode === "pending");
      case "stale":
        return rows.filter((r) => r.staleness_flag);
      default:
        // Passed and ended partners are hidden by default; they are history.
        return rows.filter((r) => r.status !== "passed" && r.status !== "ended");
    }
  }, [rows, filter]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {(["all", "certified", "portal", "stale"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cx(
                "rounded px-3 py-1.5 text-[11px] font-semibold capitalize transition",
                filter === f ? "bg-acp-bronze/15 text-acp-bronze" : "text-slate-400 hover:bg-white/5",
              )}
            >
              {f === "portal" ? "Portal active" : f}
            </button>
          ))}
        </div>
        {canManage ? (
          <button type="button" onClick={() => setAdding(true)} className={primaryBtn}>
            <Plus className="mr-1 inline h-3.5 w-3.5" /> Add partner
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 rounded border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-emerald-300/70 hover:text-emerald-200">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {!rows ? (
        <p className="py-10 text-center text-xs text-slate-500">Loading capital partners…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 px-6 py-12 text-center">
          <p className="text-sm text-slate-300">No capital partners here yet.</p>
          <p className="mt-2 text-xs text-slate-500">
            Adding a stakeholder with type “Investor” creates a partner record automatically, or use Add partner.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/5">
          <table className="w-full min-w-[560px] text-left">
            <thead className="bg-white/[0.02]">
              <tr className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                <th className="px-3 py-2.5 font-semibold">Partner</th>
                <th className="px-3 py-2.5 font-semibold">Type</th>
                <th className="px-3 py-2.5 text-right font-semibold">Committed</th>
                <th className="hidden px-3 py-2.5 font-semibold 2xl:table-cell">Perimeter</th>
                <th className="px-3 py-2.5 font-semibold">Certification</th>
                <th className="px-3 py-2.5 font-semibold">Portal</th>
                <th className="hidden px-3 py-2.5 font-semibold xl:table-cell">Last touch</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setOpenId(row.id)}
                  className="cursor-pointer border-t border-white/5 transition hover:bg-white/[0.03]"
                >
                  <td className="max-w-[200px] px-3 py-2.5">
                    <p className="truncate text-xs font-semibold text-slate-200">{row.name}</p>
                    <p className="truncate text-[10px] text-slate-500">{row.email}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-400">{TYPE_LABEL[row.type] ?? row.type}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-slate-200">
                    {row.committed_pence ? gbp(row.committed_pence) : "n/a"}
                  </td>
                  <td className="hidden px-3 py-2.5 text-xs text-slate-400 2xl:table-cell">
                    {row.perimeter_flag ? "Inside" : "Outside"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <Pill tone={certTone(row)}>
                      {row.certified_now && row.certification_date
                        ? `Valid to ${formatDate(addYear(row.certification_date))}`
                        : CERT_LABEL[row.certification_status] ?? row.certification_status}
                    </Pill>
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill tone={portalTone(row.login_mode)}>{PORTAL_LABEL[row.login_mode] ?? row.login_mode}</Pill>
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2.5 text-xs text-slate-400 xl:table-cell">
                    {row.last_touch ? formatDate(row.last_touch) : "—"}
                    {row.staleness_flag ? (
                      <span className="ml-1.5 text-amber-400" title="No contact in 90 days">
                        <AlertTriangle className="inline h-3 w-3" />
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <AddPartnerDialog
          onClose={() => setAdding(false)}
          onCreated={async (id) => {
            setAdding(false);
            await load();
            setOpenId(id);
          }}
        />
      ) : null}

      {openId ? (
        <PartnerDrawer
          id={openId}
          canManage={canManage}
          canErase={canErase}
          onClose={() => setOpenId(null)}
          onChanged={load}
          onErased={async (message) => {
            setOpenId(null);
            setNotice(message);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Add partner ───────────────────────────────────────────────────────────

function AddPartnerDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    type: "prospective" as "holdco_equity" | "deal_equity" | "prospective",
    entity: "",
    phone: "",
    source: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!form.name.trim() || !form.email.trim()) {
      setError("A name and an email address are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await createPartner({
        name: form.name.trim(),
        email: form.email.trim(),
        type: form.type,
        entity: form.entity || null,
        phone: form.phone || null,
        source: form.source || null,
        notes: form.notes || null,
      });
      await onCreated(created.id);
    } catch (err: any) {
      setError(err?.message || "Could not create the partner.");
      setBusy(false);
    }
  }

  return (
    <Overlay title="Add capital partner" onClose={onClose}>
      <div className="space-y-3">
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div>
          <label className={label}>Name</label>
          <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className={label}>Email</label>
          <input
            className={input}
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Type</label>
            <select
              className={input}
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}
            >
              <option value="prospective">Prospective</option>
              <option value="deal_equity">Deal equity</option>
              <option value="holdco_equity">Holdco equity</option>
            </select>
          </div>
          <div>
            <label className={label}>Entity</label>
            <input
              className={input}
              value={form.entity}
              onChange={(e) => setForm({ ...form, entity: e.target.value })}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Phone</label>
            <input className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className={label}>Source</label>
            <input
              className={input}
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className={label}>Notes</label>
          <textarea
            className={cx(input, "min-h-[72px]")}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Creating a partner grants no access. Record a current certification first, then issue portal access from the
          record.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={primaryBtn} disabled={busy} onClick={submit}>
            {busy ? "Saving…" : "Create partner"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ─── Partner record ────────────────────────────────────────────────────────

type DrawerTab = "details" | "certification" | "access" | "commitments" | "audit";

function PartnerDrawer({
  id,
  canManage,
  canErase,
  onClose,
  onChanged,
  onErased,
}: {
  id: string;
  canManage: boolean;
  canErase: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onErased: (message: string) => Promise<void>;
}) {
  const [erasing, setErasing] = useState(false);
  const [addingCommitment, setAddingCommitment] = useState(false);
  const [record, setRecord] = useState<PartnerRecord | null>(null);
  const [tab, setTab] = useState<DrawerTab>("details");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [grant, setGrant] = useState<AccessGrant | null>(null);

  const load = useCallback(async () => {
    try {
      setRecord(await getPartner(id, { noCache: true }));
    } catch (err: any) {
      setError(err?.message || "Could not load the partner record.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      await onChanged();
    } catch (err: any) {
      setError(err?.message || "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  if (!record) {
    return (
      <Overlay title="Capital partner" onClose={onClose}>
        {error ? <ErrorNote>{error}</ErrorNote> : <p className="text-xs text-slate-500">Loading…</p>}
      </Overlay>
    );
  }

  const p = record.investor;
  const certified = p.certified_now;
  const canIssue = canManage && certified;
  const issueReason = !canManage
    ? "Your role cannot issue portal access."
    : !certified
      ? "Certification is not valid, or was signed more than twelve months ago."
      : "";

  return (
    <Overlay title={p.name} subtitle={p.email} onClose={onClose} wide>
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-white/5">
        {(["details", "certification", "access", "commitments", "audit"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cx(
              "shrink-0 border-b-2 px-3 py-2 text-xs font-semibold capitalize transition",
              tab === t ? "border-acp-bronze text-acp-bronze" : "border-transparent text-slate-400 hover:text-slate-200",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "details" ? <DetailsTab record={record} canManage={canManage} busy={busy} run={run} /> : null}
      {tab === "certification" ? <CertificationTab record={record} canManage={canManage} busy={busy} run={run} /> : null}

      {tab === "access" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field k="Status" v={PORTAL_LABEL[record.access.login_mode] ?? record.access.login_mode} />
            <Field k="Account bound" v={record.access.auth_bound ? "Yes" : "No"} />
            <Field k="First sign-in" v={record.access.first_login_at ? formatDate(record.access.first_login_at) : "—"} />
            <Field k="Last sign-in" v={record.access.last_login_at ? formatDate(record.access.last_login_at) : "—"} />
            <Field
              k="Terms accepted"
              v={record.access.terms_accepted_at ? formatDate(record.access.terms_accepted_at) : "Not yet"}
            />
            <Field k="Documents opened (30d)" v={String(record.access.documents_opened_30d)} />
          </div>

          {grant ? <GrantPanel grant={grant} onDismiss={() => setGrant(null)} /> : null}

          <div className="rounded border border-white/5 bg-white/[0.02] p-4">
            <p className="mb-1 text-xs font-semibold text-slate-200">Portal access</p>
            <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
              {issueReason ||
                "Issuing access creates the sign-in, emails a temporary password and records an invite. The partner sets their own password on first sign-in."}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!canIssue || busy}
                title={issueReason}
                className={primaryBtn}
                onClick={() =>
                  run(async () => {
                    const res = await partnerAccess({ investor_id: id, action: "issue" });
                    setGrant(res);
                  })
                }
              >
                {busy ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : <KeyRound className="mr-1 inline h-3.5 w-3.5" />}
                {record.access.auth_bound ? "Re-issue access" : "Issue portal access"}
              </button>

              {record.access.auth_bound ? (
                <button
                  type="button"
                  disabled={!canManage || busy}
                  className={ghostBtn}
                  onClick={() =>
                    run(async () => {
                      const res = await partnerAccess({ investor_id: id, action: "reset_password" });
                      setGrant(res as AccessGrant);
                    })
                  }
                >
                  Reset password
                </button>
              ) : null}

              {record.access.login_mode === "revoked" ? (
                <button
                  type="button"
                  disabled={!canManage || busy}
                  className={ghostBtn}
                  onClick={() => run(() => partnerAccess({ investor_id: id, action: "restore" }))}
                >
                  Restore access
                </button>
              ) : record.access.auth_bound ? (
                <button
                  type="button"
                  disabled={!canManage || busy}
                  className={cx(ghostBtn, "border-rose-500/30 text-rose-300")}
                  onClick={() => {
                    const reason = window.prompt("Why is access being withdrawn? This is recorded against the partner.");
                    if (!reason || reason.trim().length < 3) return;
                    void run(() => partnerAccess({ investor_id: id, action: "revoke", reason: reason.trim() }));
                  }}
                >
                  <ShieldOff className="mr-1 inline h-3.5 w-3.5" /> Revoke access
                </button>
              ) : null}
            </div>
          </div>

          {record.invites.length ? (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Invites</p>
              <div className="rounded border border-white/5">
                {record.invites.map((i) => (
                  <div key={i.id} className="flex items-center justify-between border-b border-white/5 px-3 py-2 text-xs last:border-b-0">
                    <span className="text-slate-300">Issued {formatDate(i.issued_at)}</span>
                    <span className="text-slate-500">
                      {i.status === "active" ? `Expires ${formatDate(i.expires_at)}` : i.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {canErase ? (
            <div className="rounded border border-rose-500/25 bg-rose-500/[0.04] p-4">
              <p className="text-xs font-bold text-rose-300">Danger zone</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Permanently delete this partner and everything recorded about them — including commitments, capital
                transactions and the audit trail. This cannot be undone.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => setErasing(true)}
                className="mt-3 rounded border border-rose-500/40 px-3.5 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-40"
              >
                <Trash2 className="mr-1 inline h-3.5 w-3.5" /> Permanently delete partner
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {erasing ? (
        <EraseDialog
          record={record}
          onCancel={() => setErasing(false)}
          onErased={async (message) => {
            setErasing(false);
            await onErased(message);
          }}
        />
      ) : null}

      {tab === "commitments" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-md text-[11px] leading-relaxed text-slate-500">
              A deal appears in this partner’s portal once their commitment to it is marked completed. Pending
              commitments stay private.
            </p>
            {canManage && !addingCommitment ? (
              <button type="button" className={primaryBtn} onClick={() => setAddingCommitment(true)}>
                <Plus className="mr-1 inline h-3.5 w-3.5" /> Record commitment
              </button>
            ) : null}
          </div>

          {addingCommitment ? (
            <NewCommitmentForm
              investorId={p.id}
              onCancel={() => setAddingCommitment(false)}
              onDone={async () => {
                setAddingCommitment(false);
                await load();
                await onChanged();
              }}
            />
          ) : null}

          {record.commitments.length === 0 && !addingCommitment ? (
            <p className="rounded-lg border border-dashed border-white/10 py-8 text-center text-xs text-slate-500">
              No commitments recorded yet.
            </p>
          ) : (
            record.commitments.map((c: any) => (
              <CommitmentCard
                key={c.id}
                c={c}
                heading={dealLabel(c.deals)}
                sub={dealSubLabel(c.deals)}
                canManage={canManage}
                onChanged={async () => {
                  await load();
                  await onChanged();
                }}
              />
            ))
          )}
        </div>
      ) : null}

      {tab === "audit" ? (
        <div className="rounded border border-white/5">
          {record.audit.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">Nothing recorded yet.</p>
          ) : (
            record.audit.map((a) => (
              <div key={a.id} className="border-b border-white/5 px-3 py-2.5 last:border-b-0">
                <p className="text-xs text-slate-300">{a.details ?? a.action}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {formatDate(a.occurred_at)} · {a.operator ?? "system"}
                  {a.operator_role ? ` (${a.operator_role})` : ""}
                  {a.reason ? ` · ${a.reason}` : ""}
                </p>
              </div>
            ))
          )}
        </div>
      ) : null}
    </Overlay>
  );
}

function DetailsTab({
  record,
  canManage,
  busy,
  run,
}: {
  record: PartnerRecord;
  canManage: boolean;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const p = record.investor;
  const [form, setForm] = useState({
    name: p.name,
    entity: p.entity ?? "",
    phone: p.phone ?? "",
    type: p.type,
    warmth: p.warmth ?? 0,
    perimeter_flag: p.perimeter_flag,
    last_touch: p.last_touch ?? "",
    notes: p.notes ?? "",
  });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Name</label>
          <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className={label}>Entity</label>
          <input className={input} value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })} />
        </div>
        <div>
          <label className={label}>Type</label>
          <select
            className={input}
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}
          >
            <option value="prospective">Prospective</option>
            <option value="deal_equity">Deal equity</option>
            <option value="holdco_equity">Holdco equity</option>
          </select>
        </div>
        <div>
          <label className={label}>Phone</label>
          <input className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <label className={label}>Warmth (0–3)</label>
          <input
            className={input}
            type="number"
            min={0}
            max={3}
            value={form.warmth}
            onChange={(e) => setForm({ ...form, warmth: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className={label}>Last touch</label>
          <input
            className={input}
            type="date"
            value={form.last_touch ? String(form.last_touch).slice(0, 10) : ""}
            onChange={(e) => setForm({ ...form, last_touch: e.target.value })}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={form.perimeter_flag}
          onChange={(e) => setForm({ ...form, perimeter_flag: e.target.checked })}
          className="h-4 w-4 accent-acp-bronze"
        />
        Inside the perimeter
        <span className="text-slate-500">— admin knowledge only; unlocks nothing in the portal</span>
      </label>

      <div>
        <label className={label}>Notes</label>
        <textarea
          className={cx(input, "min-h-[72px]")}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canManage || busy}
          className={primaryBtn}
          onClick={() =>
            run(() =>
              updatePartner(p.id, {
                ...form,
                last_touch: form.last_touch || null,
                entity: form.entity || null,
                phone: form.phone || null,
                notes: form.notes || null,
              }),
            )
          }
        >
          Save details
        </button>
      </div>
    </div>
  );
}

function CertificationTab({
  record,
  canManage,
  busy,
  run,
}: {
  record: PartnerRecord;
  canManage: boolean;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const p = record.investor;
  const [form, setForm] = useState({
    certification_status: p.certification_status,
    certification_kind: (p.certification_kind ?? "hnw") as "hnw" | "self_cert_sophisticated",
    certification_date: p.certification_date ?? "",
    certification_evidence_link: p.certification_evidence_link ?? "",
  });

  return (
    <div className="space-y-3">
      <div className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-[11px] leading-relaxed text-amber-200/90">
        Certification is what makes a partner eligible for portal access and, later, for offers. A valid certification
        needs a kind, the date it was signed and a link to the evidence, and it lapses twelve months after signing.
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Status</label>
          <select
            className={input}
            value={form.certification_status}
            onChange={(e) =>
              setForm({ ...form, certification_status: e.target.value as typeof form.certification_status })
            }
          >
            <option value="not_certified">Not certified</option>
            <option value="pending">Pending</option>
            <option value="valid">Valid</option>
            <option value="expired">Expired</option>
          </select>
        </div>
        <div>
          <label className={label}>Kind</label>
          <select
            className={input}
            value={form.certification_kind}
            onChange={(e) => setForm({ ...form, certification_kind: e.target.value as typeof form.certification_kind })}
          >
            <option value="hnw">Certified high net worth</option>
            <option value="self_cert_sophisticated">Self-certified sophisticated</option>
          </select>
        </div>
        <div>
          <label className={label}>Date signed</label>
          <input
            className={input}
            type="date"
            value={form.certification_date ? String(form.certification_date).slice(0, 10) : ""}
            onChange={(e) => setForm({ ...form, certification_date: e.target.value })}
          />
        </div>
        <div>
          <label className={label}>Evidence link</label>
          <input
            className={input}
            value={form.certification_evidence_link}
            onChange={(e) => setForm({ ...form, certification_evidence_link: e.target.value })}
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <p className="text-[11px] text-slate-500">
          {p.certified_now ? (
            <span className="text-emerald-400">
              <BadgeCheck className="mr-1 inline h-3.5 w-3.5" />
              Certified now
            </span>
          ) : (
            "Not certified as at today."
          )}
        </p>
        <button
          type="button"
          disabled={!canManage || busy}
          className={primaryBtn}
          onClick={() =>
            run(() =>
              updatePartner(p.id, {
                ...form,
                certification_date: form.certification_date || null,
                certification_evidence_link: form.certification_evidence_link || null,
              }),
            )
          }
        >
          Save certification
        </button>
      </div>
    </div>
  );
}

/** What a permanent delete removes, and the steps to take before doing it. */
function EraseDialog({
  record,
  onCancel,
  onErased,
}: {
  record: PartnerRecord;
  onCancel: () => void;
  onErased: (message: string) => Promise<void>;
}) {
  const p = record.investor;
  const [understood, setUnderstood] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const txns = record.commitments.reduce(
    (n, c) => n + (Array.isArray(c.capital_transactions) ? c.capital_transactions.length : 0),
    0,
  );
  const matches = typed.trim().toLowerCase() === String(p.email).trim().toLowerCase();
  const hasMoney = record.commitments.length > 0 || txns > 0;

  const erase = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await erasePartner(p.id, typed.trim());
      const login =
        res.login === "deleted"
          ? " Their portal login was deleted."
          : res.login === "unlinked"
            ? " Their login is shared with another role, so only the partner link was removed from it."
            : "";
      await onErased(`${p.name} was permanently deleted.${login}`);
    } catch (err: any) {
      setError(err?.message || "The partner could not be deleted.");
      setBusy(false);
    }
  };

  const erased: Array<[string, string]> = [
    ["Partner record and details", "name, email, phone, entity, notes, certification"],
    ["Portal access", `login, ${record.invites.length} invite(s), terms acceptance`],
    ["Commitments", String(record.commitments.length)],
    ["Capital transactions", `${txns} (calls, distributions, buybacks)`],
    ["HoldCo shareholdings", "all"],
    ["Documents", String(record.documents.length)],
    ["Activity, access and email logs", "all"],
    ["Audit trail", `${record.audit.length} entr${record.audit.length === 1 ? "y" : "ies"}, with no record of this delete`],
    ["Linked stakeholder card", "if one exists"],
  ];

  return (
    <Overlay
      title="Permanently delete partner"
      subtitle={`${p.name} · ${p.email}`}
      onClose={busy ? () => undefined : onCancel}
    >
      <div className="space-y-4">
        <div className="flex gap-2.5 rounded border border-rose-500/30 bg-rose-500/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
          <p className="text-xs leading-relaxed text-rose-200">
            <span className="font-bold">This is a hard delete and cannot be undone.</span> Everything below is erased
            from the database immediately. There is no restore in the app, and no audit entry will show it ever
            existed.
          </p>
        </div>

        {hasMoney ? (
          <div className="flex gap-2.5 rounded border border-amber-500/30 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <p className="text-xs leading-relaxed text-amber-200">
              This partner has financial records: {record.commitments.length} commitment(s) and {txns} capital
              transaction(s). They will be erased too, and any figures that include them will change.
            </p>
          </div>
        ) : null}

        <div>
          <p className={label}>What will be erased</p>
          <dl className="divide-y divide-white/5 rounded border border-white/5">
            {erased.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
                <dt className="text-slate-300">{k}</dt>
                <dd className="text-right text-slate-500">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <p className={label}>Before you delete</p>
          <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-slate-400">
            <li>
              Keep a copy of anything you are required to retain — subscription documents, capital history,
              certification evidence. Check the Commitments and Audit tabs first.
            </li>
            <li>
              If the partner still needs to hear from you, contact them now: their login stops working immediately
              and any unsent emails to them are cancelled.
            </li>
            <li>
              If you only want to stop their access, use <span className="text-slate-200">Revoke access</span>{" "}
              instead — it keeps the record.
            </li>
          </ol>
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="mt-0.5 accent-rose-500"
          />
          I understand this permanently erases this partner and cannot be undone.
        </label>

        <div>
          <label className={label} htmlFor="erase-confirm">
            Type <span className="normal-case text-slate-300">{p.email}</span> to confirm
          </label>
          <input
            id="erase-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={p.email}
            className={input}
          />
        </div>

        {error ? <ErrorNote>{error}</ErrorNote> : null}

        <div className="flex justify-end gap-2">
          <button type="button" className={ghostBtn} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!understood || !matches || busy}
            onClick={() => void erase()}
            className="rounded bg-rose-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1 inline h-3.5 w-3.5" />
            )}
            Permanently delete
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function GrantPanel({ grant, onDismiss }: { grant: AccessGrant; onDismiss: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (value: string, what: string) => {
    void navigator.clipboard?.writeText(value);
    setCopied(what);
    window.setTimeout(() => setCopied(null), 1800);
  };

  return (
    <div className="rounded border border-acp-bronze/30 bg-acp-bronze/5 p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="text-xs font-bold text-acp-bronze">Access issued — shown once</p>
        <button type="button" onClick={onDismiss} className="text-slate-500 hover:text-slate-300">
          <X className="h-4 w-4" />
        </button>
      </div>
      <DeliveryNote grant={grant} />
      <dl className="space-y-2 text-xs">
        <CopyRow label="Portal" value={grant.portalUrl} onCopy={copy} copied={copied} />
        <CopyRow label="Email" value={grant.email} onCopy={copy} copied={copied} />
        <CopyRow label="Temporary password" value={grant.password} onCopy={copy} copied={copied} mono />
        {grant.link ? <CopyRow label="Sign-in link" value={grant.link} onCopy={copy} copied={copied} /> : null}
      </dl>
      <p className="mt-3 text-[11px] text-slate-500">
        The partner is asked to choose their own password the first time they sign in.
      </p>
    </div>
  );
}

/** Say what really happened to the credentials email — never assume it went. */
function DeliveryNote({ grant }: { grant: AccessGrant }) {
  const d = grant.delivery;
  if (d?.status === "sent" && !d.notifyOnly) {
    return (
      <p className="mb-3 text-[11px] leading-relaxed text-emerald-400">
        These details have been emailed to {d.sentTo ?? grant.email}.
      </p>
    );
  }
  if (d?.status === "sent") {
    return (
      <p className="mb-3 text-[11px] leading-relaxed text-amber-300">
        The portal is in notify-only mode, so this email went to {d.sentTo ?? "the admin address"}, not to the
        partner. Send these details on yourself.
      </p>
    );
  }
  return (
    <p className="mb-3 rounded border border-rose-500/25 bg-rose-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-rose-300">
      <span className="font-semibold">The email to {grant.email} was not sent.</span>{" "}
      {d?.reason ?? "The server did not report a delivery result."} Send these details on yourself for now.
    </p>
  );
}

function CopyRow({
  label: k,
  value,
  onCopy,
  copied,
  mono,
}: {
  label: string;
  value: string;
  onCopy: (v: string, what: string) => void;
  copied: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{k}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <span className={cx("truncate text-slate-200", mono && "font-mono tracking-wide")}>{value}</span>
        <button type="button" onClick={() => onCopy(value, k)} className="shrink-0 text-slate-500 hover:text-acp-bronze">
          {copied === k ? <span className="text-[10px] text-emerald-400">Copied</span> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </dd>
    </div>
  );
}

// ─── Shared bits ───────────────────────────────────────────────────────────

const Field = ({ k, v }: { k: string; v: string }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{k}</p>
    <p className="mt-0.5 text-xs text-slate-200">{v}</p>
  </div>
);

const ErrorNote = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-3 rounded border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{children}</div>
);

function Overlay({
  title,
  subtitle,
  onClose,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div
        className={cx(
          "my-8 w-full rounded-xl border border-white/10 bg-[#161B22] p-6 shadow-2xl",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-xl font-semibold text-white">{title}</h2>
            {subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-slate-500 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Certification lapses twelve months after it was signed (rule R6). */
function addYear(date: string): string {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString();
}
