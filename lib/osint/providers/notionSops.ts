/**
 * OSINT source: ACP's Standard Operating Procedures in Notion.
 *
 * The SOPs are where ACP's acquisition doctrine lives — the deal-assessment
 * criteria, EBITDA/valuation floors, red lines and process gates. Feeding them
 * to Claude is what turns a generic company summary into a judgement against
 * ACP's own mandate.
 *
 * Reads the Notion REST API directly (no SDK dependency). Requires an internal
 * integration token in NOTION_API_KEY, with the SOP pages shared to it. Absent
 * a token the provider reports itself unconfigured and the scan continues.
 */
import { getServerEnv } from "../../core/env.js";
import { logger } from "../../core/logger.js";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
/** Default phrase used to locate SOP pages when no explicit ids are configured. */
const DEFAULT_SOP_QUERY = "SOP";
/** Per-page character cap — SOPs are long and several are sent per scan. */
const MAX_CHARS_PER_SOP = 6_000;
const MAX_SOPS = 5;

export interface NotionSop {
  id: string;
  title: string;
  url: string;
  lastEdited: string;
  content: string;
}

export interface NotionSopResult {
  configured: boolean;
  found: boolean;
  sops: NotionSop[];
  error?: string;
}

/** SOPs change rarely; cache them for the life of the serverless instance. */
let cache: { at: number; value: NotionSopResult } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

async function notion<T>(path: string, init: RequestInit & { token: string }): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(`${NOTION_API}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "content-type": "application/json",
      ...(rest.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Notion ${path} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** Notion returns text as `rich_text` arrays on a per-block-type key. */
function blockText(block: Record<string, any>): string {
  const body = block?.[block?.type];
  const rich = body?.rich_text ?? body?.title;
  if (!Array.isArray(rich)) return "";
  const text = rich.map((r: any) => r?.plain_text ?? "").join("");
  if (!text.trim()) return "";
  switch (block.type) {
    case "heading_1": return `\n# ${text}`;
    case "heading_2": return `\n## ${text}`;
    case "heading_3": return `\n### ${text}`;
    case "bulleted_list_item":
    case "numbered_list_item": return `- ${text}`;
    case "to_do": return `- [${body?.checked ? "x" : " "}] ${text}`;
    default: return text;
  }
}

/** Flatten a page's top-level blocks to plain text (one level, no recursion —
 *  SOP bodies are mostly headings and lists, and depth costs latency). */
async function readPageText(token: string, pageId: string): Promise<string> {
  const data = await notion<{ results: Array<Record<string, any>> }>(
    `/blocks/${pageId}/children?page_size=100`,
    { method: "GET", token },
  );
  return (data.results ?? [])
    .map(blockText)
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_CHARS_PER_SOP);
}

function pageTitle(page: Record<string, any>): string {
  const props = page?.properties ?? {};
  for (const value of Object.values<any>(props)) {
    if (value?.type === "title" && Array.isArray(value.title)) {
      const t = value.title.map((r: any) => r?.plain_text ?? "").join("").trim();
      if (t) return t;
    }
  }
  return "Untitled";
}

async function loadSops(): Promise<NotionSopResult> {
  const env = getServerEnv();
  const token = env.NOTION_API_KEY;
  if (!token) {
    return { configured: false, found: false, sops: [], error: "NOTION_API_KEY not set" };
  }

  try {
    // Explicit page ids win; otherwise search the workspace by name.
    const explicit = (env.NOTION_SOP_PAGE_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let pages: Array<{ id: string; title: string; url: string; lastEdited: string }>;

    if (explicit.length > 0) {
      pages = await Promise.all(
        explicit.slice(0, MAX_SOPS).map(async (id) => {
          const page = await notion<Record<string, any>>(`/pages/${id}`, { method: "GET", token });
          return {
            id,
            title: pageTitle(page),
            url: page.url ?? "",
            lastEdited: page.last_edited_time ?? "",
          };
        }),
      );
    } else {
      const search = await notion<{ results: Array<Record<string, any>> }>("/search", {
        method: "POST",
        token,
        body: JSON.stringify({
          query: env.NOTION_SOP_QUERY ?? DEFAULT_SOP_QUERY,
          filter: { value: "page", property: "object" },
          sort: { direction: "descending", timestamp: "last_edited_time" },
          page_size: MAX_SOPS,
        }),
      });
      pages = (search.results ?? []).map((p) => ({
        id: p.id,
        title: pageTitle(p),
        url: p.url ?? "",
        lastEdited: p.last_edited_time ?? "",
      }));
    }

    const sops = await Promise.all(
      pages.map(async (p) => ({
        ...p,
        content: await readPageText(token, p.id).catch(() => ""),
      })),
    );

    const usable = sops.filter((s) => s.content.trim());
    return { configured: true, found: usable.length > 0, sops: usable };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message }, "Notion SOP fetch failed (continuing without SOPs)");
    return { configured: true, found: false, sops: [], error: message };
  }
}

/** Fetch the ACP SOPs, cached per instance. Never throws. */
export async function fetchNotionSops(): Promise<NotionSopResult> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const value = await loadSops();
  // Only cache useful results — a transient failure shouldn't blank the SOPs
  // for the next ten minutes of scans.
  if (!value.configured || value.found) cache = { at: Date.now(), value };
  return value;
}

/** Render the SOPs as prompt context. Empty string when none are available. */
export function formatSopsForPrompt(result: NotionSopResult): string {
  if (!result.found) return "";
  return result.sops
    .map((s) => `### ${s.title}\n(Notion SOP, last edited ${s.lastEdited || "unknown"})\n${s.content}`)
    .join("\n\n---\n\n");
}
