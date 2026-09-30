/**
 * Capital gates for partner documents, applied on every read.
 *
 * The partner_documents view decides *scope* (whose portal a document may
 * reach). This module decides *release*: a document in scope reaches the
 * partner only if every gate in the Investor Portal Document Standard is met
 * right now, and only if its category is unlocked for that partner (a partner
 * never sees a category until every category above it is complete for them).
 *
 * Gates are re-checked on each read rather than stamped at release, so a
 * certification that lapses, or coverage that goes into breach, closes the
 * door on the partner's next request. document-open runs the same check, so a
 * document id cannot be opened around it.
 */
import { InternalError } from "../../lib/core/errors.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import {
  evaluateDealGate,
  evaluatePartnerGate,
  unlockedCategories,
  type DocCategory,
  type GateCommitment,
  type GateDeal,
  type GateDoc,
} from "../../lib/core/investor-docs.js";
import type { InvestorScope } from "./investor-context.js";

/** Coverage status and every subscription (with settled money paid in) per deal. */
export async function loadGateDeals(dealIds: string[]): Promise<Map<string, GateDeal>> {
  const out = new Map<string, GateDeal>();
  const ids = Array.from(new Set(dealIds.filter(Boolean)));
  if (!ids.length) return out;
  const db = adminClient();

  const [deals, commitments] = await Promise.all([
    db.from("deals").select("id, dscr_status").in("id", ids),
    db
      .from("commitments")
      .select("deal_id, investor_id, status, committed_pence, is_test, capital_transactions(type, amount_pence, settled)")
      .in("deal_id", ids),
  ]);
  if (deals.error) throw new InternalError(`deals: ${deals.error.message}`);
  if (commitments.error) throw new InternalError(`commitments: ${commitments.error.message}`);

  for (const d of deals.data ?? []) out.set(d.id, { dscr_status: d.dscr_status ?? null, commitments: [] });
  for (const c of (commitments.data ?? []) as any[]) {
    const paid = (c.capital_transactions ?? [])
      .filter((t: any) => t.type === "call" && t.settled)
      .reduce((sum: number, t: any) => sum + Number(t.amount_pence ?? 0), 0);
    const row: GateCommitment = {
      investor_id: c.investor_id,
      status: c.status,
      committed_pence: Number(c.committed_pence ?? 0),
      paid_pence: paid,
      is_test: Boolean(c.is_test),
    };
    out.get(c.deal_id)?.commitments.push(row);
  }
  return out;
}

const NO_DEAL: GateDeal = { dscr_status: null, commitments: [] };

/** The gate columns of investor_documents, which the partner view never carries. */
export const GATE_COLUMNS =
  "id, doc_type, notice_type, event_date, signoffs, file_format, cloudinary_public_id, file_link, published_at, supersedes_id, revoked_at";

export interface PartnerDocumentRow extends Record<string, any> {
  id: string;
  deal_key: string | null;
  category: DocCategory;
  doc_type: string;
  superseded: boolean;
}

export interface PartnerDocumentSet {
  rows: PartnerDocumentRow[];
  /** Categories this partner may see, per deal ("" = documents with no deal). */
  unlocked: Map<string, Set<DocCategory>>;
}

/**
 * Every document the partner may see now, with superseded versions marked.
 * Optionally narrowed to one deal.
 */
export async function partnerVisibleDocuments(scope: InvestorScope, dealKey?: string): Promise<PartnerDocumentSet> {
  const db = adminClient();
  let q = db
    .from("partner_documents")
    .select("*")
    .eq("investor_id", scope.investorId)
    .order("published_at", { ascending: false, nullsFirst: false });
  if (dealKey) q = q.eq("deal_key", dealKey);
  const { data: inScope, error } = await q;
  if (error) throw new InternalError(`partner_documents: ${error.message}`);
  const scoped = (inScope ?? []) as any[];
  if (!scoped.length) return { rows: [], unlocked: new Map() };

  const { data: full, error: fullErr } = await db
    .from("investor_documents")
    .select(GATE_COLUMNS)
    .in("id", scoped.map((r) => r.id));
  if (fullErr) throw new InternalError(`investor_documents: ${fullErr.message}`);
  const byId = new Map((full ?? []).map((d: any) => [d.id, d as GateDoc & { id: string; supersedes_id: string | null }]));

  const deals = await loadGateDeals(scoped.map((r) => r.deal_key).filter(Boolean));

  // 1. Gates.
  const passed = scoped.filter((row) => {
    const doc = byId.get(row.id);
    if (!doc) return false;
    const deal = row.deal_key ? (deals.get(row.deal_key) ?? NO_DEAL) : NO_DEAL;
    return (
      evaluateDealGate(doc, deal, { includeTest: scope.isTest }).ready &&
      evaluatePartnerGate(doc, { certifiedNow: scope.certifiedNow }).length === 0
    );
  });

  // 2. Category order, per deal, from what has been released to them.
  const released = new Map<string, Set<string>>();
  for (const row of passed) {
    if (!row.available) continue;
    const key = row.deal_key ?? "";
    if (!released.has(key)) released.set(key, new Set());
    released.get(key)!.add(row.doc_type);
  }
  const unlocked = new Map<string, Set<DocCategory>>();
  const keys = new Set(passed.map((r) => r.deal_key ?? ""));
  for (const key of keys) unlocked.set(key, unlockedCategories(released.get(key) ?? new Set(), scope.certifiedNow));

  const visible = passed.filter((row) => unlocked.get(row.deal_key ?? "")?.has(row.category));

  // 3. A version that a visible, released version supersedes stays, marked.
  const supersededIds = new Set<string>();
  for (const row of visible) {
    const sup = byId.get(row.id)?.supersedes_id;
    if (sup && row.available) supersededIds.add(sup);
  }

  return {
    rows: visible.map((row) => ({ ...row, superseded: supersededIds.has(row.id) })),
    unlocked,
  };
}
