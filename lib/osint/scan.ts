/**
 * OSINT scan (Phase 5c redesign) — typed pipeline over the existing providers:
 * Companies House lookup, news search, and (best-effort) website scrape, then
 * a Claude synthesis. Runs as the `osint-scan` job; results land on the deal
 * row (osint jsonb + osint_summary), not Airtable.
 */
import { z } from "zod";
import { askClaudeJson } from "../ai/client.js";
import { searchCompaniesHouse } from "../../api/_osint/providers/companiesHouse.js";
import { fetchCompanyNews } from "../../api/_osint/providers/news.js";
import { logger } from "../core/logger.js";

export const osintSynthesisSchema = z.object({
  synthesis: z.string().catch(""),
  keyInsights: z.array(z.string()).catch([]),
  riskFlags: z.array(z.string()).catch([]),
  industry: z.string().catch("Unknown"),
});
export type OsintSynthesis = z.infer<typeof osintSynthesisSchema>;

export interface OsintScanResult {
  companyName: string;
  enrichedAt: string;
  companiesHouse: unknown;
  news: unknown;
  website: unknown;
  synthesis: OsintSynthesis;
}

const SYNTHESIS_SYSTEM = `You are an OSINT analyst at Aysan Capital Partners, a private equity firm.
You are given raw open-source intelligence gathered on an acquisition target: Companies House registry data, recent news articles, and website content where available.
Synthesize this into acquisition-relevant intelligence.

Respond ONLY with a valid JSON object matching exactly:
{
  "synthesis": "2-3 paragraph professional intelligence summary of the company: what it does, corporate status, financial signals, and reputation signals from news.",
  "keyInsights": ["Insight 1", "Insight 2"],
  "riskFlags": ["Risk flag 1 (e.g. overdue filings, director churn, adverse news)"],
  "industry": "Best-guess industry sector, or 'Unknown'"
}

RULES: Never fabricate facts — rely only on the provided data. If data is thin, say so in the synthesis and keep insights/flags short.`;

/** Run the OSINT providers (each best-effort) and synthesize with Claude. */
export async function runOsintScan(companyName: string, website?: string | null): Promise<OsintScanResult> {
  const [ch, news, site] = await Promise.all([
    searchCompaniesHouse(companyName).catch((err) => ({ found: false, error: err instanceof Error ? err.message : String(err), company: null })),
    fetchCompanyNews(companyName).catch((err) => ({ articles: [], error: err instanceof Error ? err.message : String(err) })),
    website ? scrapeWebsiteSafe(website) : Promise.resolve(null),
  ]);

  const userContent = `Target company: ${companyName}

COMPANIES HOUSE:
${JSON.stringify(ch, null, 1).slice(0, 4000)}

NEWS:
${JSON.stringify(news, null, 1).slice(0, 4000)}

WEBSITE:
${site ? JSON.stringify(site, null, 1).slice(0, 4000) : "Not scraped."}`;

  const synthesis = await askClaudeJson(osintSynthesisSchema, {
    system: SYNTHESIS_SYSTEM,
    maxTokens: 2000,
    messages: [{ role: "user", content: userContent }],
  });

  return {
    companyName,
    enrichedAt: new Date().toISOString(),
    companiesHouse: ch,
    news,
    website: site,
    synthesis,
  };
}

/** Website scrape is heavyweight (Playwright); never let it sink the scan. */
async function scrapeWebsiteSafe(url: string): Promise<unknown> {
  try {
    const { scrapeCompanyWebsite } = await import("../playwright/website.js");
    return await scrapeCompanyWebsite(url);
  } catch (err) {
    logger.warn({ err, url }, "website scrape failed (continuing without it)");
    return { success: false, error: err instanceof Error ? err.message : String(err), url };
  }
}
