/**
 * ONE-TIME ETL client (throwaway — deleted at Phase 7).
 *
 * Read-only access to Airtable for migrating data into Supabase. This is the
 * ONLY place in the repo allowed to talk to Airtable; the app itself never does.
 *
 * Run scripts with env loaded, e.g.:
 *   node --env-file=.env --import tsx scripts/etl/list-tables.ts
 */

const AIRTABLE_API_ROOT = "https://api.airtable.com/v0";
const AIRTABLE_META_ROOT = "https://api.airtable.com/v0/meta";

export function getAirtableCreds(): { apiKey: string; baseId: string } {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    throw new Error(
      "ETL requires AIRTABLE_API_KEY and AIRTABLE_BASE_ID (server-only, no VITE_). Set them in .env.",
    );
  }
  return { apiKey, baseId };
}

async function airtableGet(url: string): Promise<any> {
  const { apiKey } = getAirtableCreds();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airtable GET ${url} failed: ${res.status} ${res.statusText}\n${body}`);
  }
  return res.json();
}

export interface AirtableFieldMeta {
  id: string;
  name: string;
  type: string;
  options?: unknown;
}

export interface AirtableTableMeta {
  id: string;
  name: string;
  primaryFieldId: string;
  fields: AirtableFieldMeta[];
}

/** Authoritative list of tables + fields from the Airtable Meta API. */
export async function fetchBaseSchema(): Promise<AirtableTableMeta[]> {
  const { baseId } = getAirtableCreds();
  const data = await airtableGet(`${AIRTABLE_META_ROOT}/bases/${baseId}/tables`);
  return data.tables as AirtableTableMeta[];
}

export interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

/** Fetch ALL records from a table, auto-paginating. */
export async function fetchAllRecords(tableName: string): Promise<AirtableRecord[]> {
  const { baseId } = getAirtableCreds();
  const out: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const page = await airtableGet(url.toString());
    out.push(...(page.records as AirtableRecord[]));
    offset = page.offset;
  } while (offset);
  return out;
}
