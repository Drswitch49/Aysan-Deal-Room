/**
 * OSINT Orchestrator — Enrichment Pipeline
 *
 * Runs all OSINT providers in a controlled sequence and produces a unified
 * enrichment payload ready for Claude synthesis and Airtable persistence.
 *
 * Provider order:
 *  1. Companies House (REST API, no browser) — always runs
 *  2. LinkedIn (Playwright, session required) — graceful skip if unconfigured
 *  3. News (NewsAPI / DuckDuckGo fallback) — always runs
 *  4. Claude synthesis — summarizes all enrichment into structured intelligence
 *
 * Architecture: designed to run inside an Inngest step — all operations are
 * idempotent and safe to retry.
 */

import { searchCompaniesHouse } from "./providers/companiesHouse.js";
import { fetchCompanyNews } from "./providers/news.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OsintInput {
  dealId: string;
  companyName: string;
  linkedInUrl?: string;
  website?: string;
}

export interface OsintEnrichmentResult {
  dealId: string;
  companyName: string;
  enrichedAt: string;
  providers: {
    companiesHouse: { used: boolean; found: boolean; error?: string };
    linkedin: { used: boolean; found: boolean; error?: string };
    news: { used: boolean; found: boolean; articlesCount: number };
  };
  companiesHouseData?: any;
  linkedInData?: any;
  newsArticles?: any[];
  claudeSynthesis?: string;
  keyInsights?: string[];
  riskFlags?: string[];
  rawSummary?: string;
}

// ─── Claude Synthesis ─────────────────────────────────────────────────────────

async function synthesizeWithClaude(
  companyName: string,
  enrichmentData: {
    companiesHouse?: any;
    linkedIn?: any;
    news?: any[];
  }
): Promise<{
  synthesis: string;
  keyInsights: string[];
  riskFlags: string[];
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      synthesis: "AI synthesis unavailable — ANTHROPIC_API_KEY not configured.",
      keyInsights: [],
      riskFlags: [],
    };
  }

  const dataContext = JSON.stringify(enrichmentData, null, 2).substring(0, 12_000);

  const systemPrompt = `You are a senior investment associate at Aysan Capital Partners.
You have received raw OSINT enrichment data about a target company from multiple sources.
Your task is to synthesize this data into structured intelligence for deal evaluation.

RULES:
- Only reference information present in the provided data.
- Do NOT fabricate details, officer names, or financial figures.
- Flag any concerning patterns as risk items.

Respond ONLY with valid JSON:
{
  "synthesis": "2-3 paragraph executive intelligence summary of the company, its market position, and notable characteristics",
  "keyInsights": ["Insight 1", "Insight 2", "Insight 3"],
  "riskFlags": ["Risk or concern 1 (if any)"]
}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1500,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Company: ${companyName}\n\nEnrichment Data:\n${dataContext}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      return { synthesis: "AI synthesis failed.", keyInsights: [], riskFlags: [] };
    }

    const payload = await res.json();
    let raw = payload.content?.[0]?.text || "{}";
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    const parsed = JSON.parse(raw);
    return {
      synthesis: parsed.synthesis || "",
      keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights : [],
      riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
    };
  } catch (err: any) {
    console.error("[OSINT Synthesis] Claude failed:", err.message);
    return {
      synthesis: `AI synthesis failed: ${err.message}`,
      keyInsights: [],
      riskFlags: [],
    };
  }
}

// ─── Main Orchestrator ───────────────────────────────────────────────────────

/**
 * Runs the full OSINT enrichment pipeline for a target company.
 * Designed to run inside an Inngest step — idempotent and retry-safe.
 */
export async function runOsintEnrichment(
  input: OsintInput
): Promise<OsintEnrichmentResult> {
  const { dealId, companyName, linkedInUrl, website } = input;
  const enrichedAt = new Date().toISOString();

  console.log(`[OSINT] Starting enrichment for: ${companyName} (deal: ${dealId})`);

  // Run all providers concurrently (Companies House + News)
  // LinkedIn runs separately (requires browser, slower)
  const [chResult, newsResult] = await Promise.all([
    searchCompaniesHouse(companyName),
    fetchCompanyNews(companyName),
  ]);

  // LinkedIn enrichment is removed as per operational guidelines
  const liResult = { found: false, error: "LinkedIn scraping is disabled", data: undefined };

  console.log(
    `[OSINT] Providers done — CH: ${chResult.found}, LI: ${liResult.found}, News: ${newsResult.articles.length} articles`
  );

  // Synthesize with Claude
  const synthesis = await synthesizeWithClaude(companyName, {
    companiesHouse: chResult.found ? chResult.company : undefined,
    linkedIn: liResult.found ? liResult.data : undefined,
    news: newsResult.articles.length > 0 ? newsResult.articles : undefined,
  });

  return {
    dealId,
    companyName,
    enrichedAt,
    providers: {
      companiesHouse: {
        used: true,
        found: chResult.found,
        error: chResult.error,
      },
      linkedin: {
        used: Boolean(process.env.LINKEDIN_SESSION_DATA),
        found: liResult.found,
        error: liResult.error,
      },
      news: {
        used: true,
        found: newsResult.found,
        articlesCount: newsResult.articles.length,
      },
    },
    companiesHouseData: chResult.found ? chResult : undefined,
    linkedInData: liResult.found ? liResult.data : undefined,
    newsArticles: newsResult.articles.length > 0 ? newsResult.articles : undefined,
    claudeSynthesis: synthesis.synthesis,
    keyInsights: synthesis.keyInsights,
    riskFlags: synthesis.riskFlags,
  };
}
