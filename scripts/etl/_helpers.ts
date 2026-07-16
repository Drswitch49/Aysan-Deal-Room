/**
 * ETL helpers — Airtable value coercion + the id-map (Airtable id ↔ Supabase uuid).
 */
import { query } from "./_db.js";

// ─── Airtable field-value coercion ─────────────────────────────────────────

/** Trimmed string, or null. */
export function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // aiText fields arrive as { state, value, isStale }
  if (typeof v === "object" && v !== null && "value" in (v as any)) {
    const val = (v as any).value;
    return val == null ? null : String(val).trim() || null;
  }
  return null;
}

/** Number, or null. */
export function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return num(v[0]);
  const n = Number(String(v).replace(/[£$,]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/** Integer, or null. */
export function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

/** Boolean (Airtable checkbox → true/undefined). */
export function bool(v: unknown): boolean {
  return v === true || v === "true" || v === 1;
}

/** ISO timestamp string, or null. */
export function ts(v: unknown): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return null;
  const d = new Date(s as string);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Date-only (YYYY-MM-DD), or null. */
export function dateOnly(v: unknown): string | null {
  const t = ts(v);
  return t ? t.slice(0, 10) : null;
}

/** First value of a lookup/array field, coerced to string. */
export function firstStr(v: unknown): string | null {
  if (Array.isArray(v)) return str(v[0]);
  return str(v);
}

/** All Airtable record ids from a linked-record field (array of ids). */
export function linkIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.startsWith("rec"));
}

/** First linked record id, or null. */
export function firstLinkId(v: unknown): string | null {
  return linkIds(v)[0] ?? null;
}

export interface Attachment {
  url: string;
  filename?: string;
  type?: string;
  size?: number;
}

/** Attachment array (multipleAttachments) → normalized list. */
export function attachments(v: unknown): Attachment[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a) => a && typeof a === "object" && "url" in a)
    .map((a: any) => ({ url: a.url, filename: a.filename, type: a.type, size: a.size }));
}

// ─── id-map (backed by etl_id_map table; idempotent) ───────────────────────

type MapKey = string; // `${airtableTable}:${airtableId}`
const memo = new Map<MapKey, string>();

const k = (airtableTable: string, airtableId: string) => `${airtableTable}:${airtableId}`;

/** Load the whole id-map into memory once (single query over the persistent pg connection). */
export async function loadIdMap(): Promise<void> {
  memo.clear();
  const rows = await query<{ airtable_table: string; airtable_id: string; supabase_id: string }>(
    "select airtable_table, airtable_id, supabase_id from etl_id_map",
  );
  for (const row of rows) {
    memo.set(k(row.airtable_table, row.airtable_id), row.supabase_id);
  }
}

/** Record a mapping (persist + memoize). Multiple airtable rows may map to one uuid. */
export async function setId(
  airtableTable: string,
  airtableId: string,
  supabaseTable: string,
  supabaseId: string,
): Promise<void> {
  await query(
    `insert into etl_id_map (airtable_table, airtable_id, supabase_table, supabase_id)
     values ($1, $2, $3, $4)
     on conflict (airtable_table, airtable_id) do update set supabase_table = excluded.supabase_table, supabase_id = excluded.supabase_id`,
    [airtableTable, airtableId, supabaseTable, supabaseId],
  );
  memo.set(k(airtableTable, airtableId), supabaseId);
}

/** Look up the Supabase uuid for an Airtable record id (from any source table). */
export function getId(airtableTable: string, airtableId: string): string | null {
  return memo.get(k(airtableTable, airtableId)) ?? null;
}

/** Resolve a deal uuid from a linked-record field that may point at any deal source table. */
export function resolveDealId(linkFieldValue: unknown): string | null {
  for (const id of linkIds(linkFieldValue)) {
    for (const table of ["Active_Pipeline", "Deal_Inbox", "Review_Queue", "Archive"]) {
      const found = getId(table, id);
      if (found) return found;
    }
  }
  return null;
}
