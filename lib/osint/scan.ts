/**
 * OSINT scan — Companies House + ACP's Notion SOPs + the deal's own Supabase
 * record, synthesized by Claude.
 *
 * Sources (each best-effort; a missing one is reported, never fatal):
 *   1. Companies House  — registry truth: status, filings, officers, SIC codes.
 *   2. Notion SOPs      — ACP's acquisition criteria, so the output is a
 *                         judgement against our own mandate rather than a
 *                         generic company summary.
 *   3. Supabase         — the deal row, analysed document summaries, team notes.
 *
 * News is an optional extra rather than a pipeline source: it only runs when
 * NEWS_API_KEY is configured, and never blocks the scan.
 *
 * Results land on the deal row (osint jsonb + osint_summary).
 */
import { z } from "zod";
import { askClaudeJson } from "../ai/client.js";
import { searchCompaniesHouse } from "../../api/_osint/providers/companiesHouse.js";
import { fetchCompanyNews } from "../../api/_osint/providers/news.js";
import { fetchNotionSops, formatSopsForPrompt, type NotionSopResult } from "./providers/notionSops.js";
import { loadDealContext, formatDealContextForPrompt, type DealContext } from "./providers/dealContext.js";
import { getServerEnv } from "../core/env.js";
import { logger } from "../core/logger.js";

export const osintSynthesisSchema = z.object({
  synthesis: z.string().catch(""),
  keyInsights: z.array(z.string()).catch([]),
  riskFlags: z.array(z.string()).catch([]),
  industry: z.string().catch("Unknown"),
  /** How the target reads against the SOP criteria; "Unknown" when no SOPs. */
  sopAlignment: z.string().catch("Unknown — ACP SOPs were not available."),
  sopBreaches: z.array(z.string()).catch([]),
  verificationGaps: z.array(z.string()).catch([]),
});
export type OsintSynthesis = z.infer<typeof osintSynthesisSchema>;

export interface OsintScanResult {
  companyName: string;
  enrichedAt: string;
  /** Which sources actually contributed — shown in the UI and used for support. */
  sources: {
    companiesHouse: { used: boolean; found: boolean; error?: string };
    notionSops: { used: boolean; found: boolean; count: number; titles: string[]; error?: string };
    supabase: { used: boolean; documents: number; notes: number };
    news: { used: boolean; found: boolean; count: number };
  };
  companiesHouse: unknown;
  notionSops: unknown;
  dealContext: unknown;
  news: unknown;
  synthesis: OsintSynthesis;
}

const SYNTHESIS_SYSTEM = `You are the OSINT and deal-screening analyst at Aysan Capital Partners (ACP), a UK private equity and acquisition firm.

You are given, for one acquisition target:
1. COMPANIES HOUSE — UK statutory registry data (status, incorporation, officers, SIC codes).
2. ACP SOPs — Aysan Capital Partners' own Standard Operating Procedures, straight from our Notion. These define our acquisition criteria, thresholds, red lines and process gates.
3. ACP DEAL RECORD — what our own system already holds on this deal: intake fields, financials, analysed document summaries, and notes written by the deal team.
4. NEWS — recent press coverage, when available.

Synthesize these into a screening assessment that reads as if an ACP analyst wrote it, and judge the target AGAINST OUR SOP CRITERIA — not against generic private-equity heuristics.

Respond ONLY with a valid JSON object matching exactly:
{
  "synthesis": "2-3 paragraph professional intelligence summary: what the company does, its corporate/registry standing, the financial picture from our own record, and any reputational signals.",
  "keyInsights": ["Insight 1", "Insight 2"],
  "riskFlags": ["Risk flag 1 (e.g. overdue filings, director churn, customer concentration, adverse news)"],
  "industry": "Best-guess industry sector, or 'Unknown'",
  "sopAlignment": "How this target reads against the ACP SOP criteria you were given — cite the specific criterion. If no SOPs were provided, say so plainly rather than inventing criteria.",
  "sopBreaches": ["Each SOP threshold or red line this deal fails, quoted from the SOP"],
  "verificationGaps": ["What we still need to confirm before this can progress"]
}

RULES:
- Never fabricate facts. Use only what the sources give you.
- Never invent an SOP rule. If the SOPs are missing or silent on something, say so — an honest gap is more useful than a plausible guess.
- Where sources contradict each other (e.g. registry status vs our deal record), call the discrepancy out explicitly.
- If the data is thin, say so in the synthesis and keep the lists short.`;

/** Run the configured OSINT sources and synthesize them with Claude. */
export async function runOsintScan(
  companyName: string,
  website?: string | null,
  dealId?: string | null,
): Promise<OsintScanResult> {
  const newsConfigured = Boolean(getServerEnv().NEWS_API_KEY);

  const [ch, sops, dealCtx, news] = await Promise.all([
    searchCompaniesHouse(companyName).catch((err) => ({
      found: false,
      error: err instanceof Error ? err.message : String(err),
      company: null,
    })),
    fetchNotionSops(),
    dealId
      ? loadDealContext(dealId).catch((err) => {
          logger.warn({ err, dealId }, "deal context load failed (continuing without it)");
          return null;
        })
      : Promise.resolve(null),
    newsConfigured
      ? fetchCompanyNews(companyName).catch(() => ({ found: false, articles: [] }))
      : Promise.resolve(null),
  ]);

  const sopResult = sops as NotionSopResult;
  const sopText = formatSopsForPrompt(sopResult);
  const dealText = dealCtx ? formatDealContextForPrompt(dealCtx as DealContext) : "";

  const userContent = `Target company: ${companyName}${website ? `\nWebsite: ${website}` : ""}

═══ 1. COMPANIES HOUSE ═══
${JSON.stringify(ch, null, 1).slice(0, 5000)}

═══ 2. ACP SOPs (Notion) ═══
${sopText || "No ACP SOPs were available for this scan — do not invent acquisition criteria."}

═══ 3. ACP DEAL RECORD (Supabase) ═══
${dealText || "No deal record was supplied."}

═══ 4. NEWS ═══
${news ? JSON.stringify(news, null, 1).slice(0, 3000) : "Not collected (news source not configured)."}`;

  const synthesis = await askClaudeJson(osintSynthesisSchema, {
    system: SYNTHESIS_SYSTEM,
    maxTokens: 4000,
    effort: "high",
    messages: [{ role: "user", content: userContent }],
  });

  return {
    companyName,
    enrichedAt: new Date().toISOString(),
    sources: {
      companiesHouse: {
        used: true,
        found: Boolean((ch as { found?: boolean }).found),
        error: (ch as { error?: string }).error,
      },
      notionSops: {
        used: sopResult.configured,
        found: sopResult.found,
        count: sopResult.sops.length,
        titles: sopResult.sops.map((s) => s.title),
        error: sopResult.error,
      },
      supabase: {
        used: Boolean(dealCtx),
        documents: dealCtx ? (dealCtx as DealContext).documents.length : 0,
        notes: dealCtx ? (dealCtx as DealContext).notes.length : 0,
      },
      news: {
        used: newsConfigured,
        found: Boolean((news as { found?: boolean } | null)?.found),
        count: ((news as { articles?: unknown[] } | null)?.articles ?? []).length,
      },
    },
    companiesHouse: ch,
    // Titles/urls only — the SOP bodies are ACP doctrine, not deal data, and
    // would repeat the same text on every deal row.
    notionSops: sopResult.sops.map(({ id, title, url, lastEdited }) => ({ id, title, url, lastEdited })),
    dealContext: dealCtx,
    news,
    synthesis,
  };
}
