/**
 * Negotiation Log: write section 19's log row to `negotiation_exchanges` and
 * sync it to the Notion Negotiation Log (Optimisation Brief v1.1, s4.5, 6a
 * stage 9). Live figures are stripped before either write (H-08).
 *
 * Notion needs NOTION_API_KEY (already used for the SOPs) and
 * NOTION_NEGOTIATION_LOG_DB_ID, the database the integration is shared with.
 * Without the database id the row is still stored in Postgres and the result
 * says so; nothing fails silently.
 */
import { adminClient } from "../data/supabase/client.js";
import { stripFigures } from "./generate.js";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export interface LogRow {
  exchange_no: number;
  direction: "outbound" | "inbound";
  deal_ref: string;
  counterparty: string;
  counterparty_role: "broker" | "seller" | "lender" | "adviser";
  move_type: string;
  techniques: string[];
  moved: string;
  next_move: string;
  live_figures: string;
}

async function notion<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Notion ${path} returned ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

const para = (text: string) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }] } });

export async function writeNegotiationLog(opts: { dealId: string; intelligenceRunId: string; row: LogRow; actor: string }) {
  const row: LogRow = {
    ...opts.row,
    counterparty: stripFigures(opts.row.counterparty),
    move_type: stripFigures(opts.row.move_type),
    next_move: stripFigures(opts.row.next_move),
    live_figures: "None (H-08)",
  };

  const db = adminClient();
  const { data: existing } = await db.from("negotiation_exchanges").select("exchange_no").eq("deal_id", opts.dealId).order("exchange_no", { ascending: false }).limit(1);
  const exchangeNo = Math.max(row.exchange_no, (existing?.[0]?.exchange_no ?? 0) + 1);

  const { data: saved, error } = await db.from("negotiation_exchanges").insert({
    deal_id: opts.dealId,
    intelligence_run_id: opts.intelligenceRunId,
    exchange_no: exchangeNo,
    direction: row.direction,
    deal_ref: row.deal_ref,
    counterparty: row.counterparty,
    counterparty_role: row.counterparty_role,
    move_type: row.move_type,
    techniques: row.techniques,
    moved: "pending",
    next_move: row.next_move,
    created_by: opts.actor,
  }).select("*").single();
  if (error) throw new Error(`negotiation_exchanges.insert: ${error.message}`);

  const token = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_NEGOTIATION_LOG_DB_ID;
  if (!token || !databaseId) {
    return { exchange: saved, notion: { synced: false, reason: !token ? "NOTION_API_KEY is not set" : "NOTION_NEGOTIATION_LOG_DB_ID is not set" } };
  }

  try {
    // Find the database's title property rather than assuming its name.
    const dbMeta = await notion<{ properties: Record<string, { type: string }> }>(`/databases/${databaseId}`, token);
    const titleProp = Object.entries(dbMeta.properties).find(([, p]) => p.type === "title")?.[0] ?? "Name";
    const page = await notion<{ id: string }>("/pages", token, {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: { [titleProp]: { title: [{ text: { content: `${row.deal_ref} · Exchange ${exchangeNo} · ${row.direction}` } }] } },
        children: [
          para(`Exchange: ${exchangeNo} · ${row.direction}`),
          para(`Deal ref: ${row.deal_ref}`),
          para(`Counterparty / role: ${row.counterparty}`),
          para(`Move type: ${row.move_type}`),
          para(`Techniques: ${row.techniques.join(", ")}`),
          para("Moved: Pending"),
          para(`Next move: ${row.next_move}`),
          para("Live figures: None (H-08)"),
        ],
      }),
    });
    await db.from("negotiation_exchanges").update({ notion_page_id: page.id, notion_synced_at: new Date().toISOString() }).eq("id", saved.id);
    return { exchange: { ...saved, notion_page_id: page.id }, notion: { synced: true } };
  } catch (err) {
    return { exchange: saved, notion: { synced: false, reason: err instanceof Error ? err.message : String(err) } };
  }
}
