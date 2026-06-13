/**
 * Inngest Workflows: OSINT Scraping + Portfolio Processing
 *
 * Granular step-by-step execution updating progress to Airtable.
 */

import { inngest } from "../_utils/inngest.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { airtableFetchRecord, airtableUpdate, airtableCreate } from "../_utils/airtable.js";
import { searchCompaniesHouse } from "../_osint/providers/companiesHouse.js";
import { fetchCompanyNews } from "../_osint/providers/news.js";
import { runPortfolioIntelligence } from "../_services/portfolio.js";

// ─── Claude Synthesis ─────────────────────────────────────────────────────────

export async function synthesizeWithClaude(
  companyName: string,
  enrichmentData: {
    website?: any;
    companiesHouse?: any;
    linkedIn?: any;
    news?: any[];
  }
): Promise<{
  synthesis: string;
  industry: string;
  keyInsights: string[];
  riskProfile: string;
  riskFlags: string[];
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      synthesis: "AI synthesis unavailable — ANTHROPIC_API_KEY not configured.",
      industry: "Unknown",
      keyInsights: [],
      riskProfile: "Unavailable",
      riskFlags: ["No AI key configured"],
    };
  }

  // Cap length to avoid context bloat
  const dataContext = JSON.stringify(enrichmentData, null, 2).substring(0, 15000);

  const systemPrompt = `You are a senior investment associate at Aysan Capital Partners.
Synthesize the provided raw OSINT enrichment data. Focus strictly on brevity, clarity, and partner-grade signal density.

STRICT RULES:
- ONLY reference information explicitly present in the provided raw data.
- If a data point is missing/scraper failed, mark as "incomplete" or "unavailable". Do NOT fabricate or assume any info.
- Flag weak online presence, address discrepancies, or warning patterns.

Respond ONLY with a valid JSON object matching this schema:
{
  "synthesis": "1 short paragraph or structured bullet points under 80 words summarizing company activities and web footprint profile.",
  "industry": "1-3 words representing the primary industry sector.",
  "keyInsights": ["Insight (max 3 high-impact, decision-relevant insights, each under 12 words)"],
  "riskProfile": "1 short, direct sentence summarizing risk flags.",
  "riskFlags": ["Critical risk concern (max 3 short bullets, each under 10 words)"]
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
        model: "claude-3-5-sonnet-20241022",
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
      throw new Error(`Claude API returned status ${res.status}`);
    }

    const payload = await res.json();
    let raw = payload.content?.[0]?.text || "{}";
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    const parsed = JSON.parse(raw);
    return {
      synthesis: parsed.synthesis || "Unavailable",
      industry: parsed.industry || "Unknown",
      keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights : [],
      riskProfile: parsed.riskProfile || "Unavailable",
      riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
    };
  } catch (err: any) {
    console.error("[OSINT Synthesis] Claude failed:", err.message);
    return {
      synthesis: `AI synthesis failed: ${err.message}`,
      industry: "Unknown",
      keyInsights: [],
      riskProfile: "Failure",
      riskFlags: [`Synthesis error: ${err.message}`],
    };
  }
}

// ─── 1. OSINT Scraping Workflow ───────────────────────────────────────────────

const onOsintScrapeRequested = inngest.createFunction(
  {
    id: "osint-scrape-workflow",
    name: "OSINT: Company Enrichment Pipeline",
    retries: 2,
    concurrency: {
      limit: 2, // Max 2 concurrent Playwright sessions on Vercel Pro
    },
    triggers: [{ event: "osint/scrape_requested" }],
  },
  async ({ event, step }) => {
    const { dealId, companyName, website } = event.data;
    const PIPELINE_TABLE = TABLES.PIPELINE || "Active_Pipeline";

    try {
      // Step 1: Mark as Queued in Airtable
      await step.run("mark-queued", async () => {
        await airtableUpdate(PIPELINE_TABLE, dealId, {
          OSINT_Status: "Queued",
          OSINT_Started_At: new Date().toISOString(),
          OSINT_Failure_Reason: "",
        });
      });

      // Fetch additional deal details
      const dealRecord = await step.run("fetch-deal-details", async () => {
        const record = await airtableFetchRecord(PIPELINE_TABLE, dealId);
        return record?.fields || {};
      });
      const linkedInUrl: string = (dealRecord as any)["LinkedIn_URL"] || "";

      // Step 2: Mark as Scraping Website
      await step.run("mark-scraping-website", async () => {
        await airtableUpdate(PIPELINE_TABLE, dealId, {
          OSINT_Status: "Scraping Website",
        });
      });

      // Step 3: Run Website Scrape, Companies House, and News concurrently
      const [websiteResult, chResult, newsResult] = await Promise.all([
        step.run("scrape-website", async () => {
          if (!website) {
            return { success: false, error: "No website URL provided" };
          }
          const { scrapeCompanyWebsite } = await import("../../lib/playwright/website.js");
          return scrapeCompanyWebsite(website);
        }),
        step.run("search-companies-house", async () => {
          return searchCompaniesHouse(companyName);
        }),
        step.run("fetch-news", async () => {
          return fetchCompanyNews(companyName);
        }),
      ]);

      // Step 4: Mark as Extracting Metadata
      await step.run("mark-extracting-metadata", async () => {
        await airtableUpdate(PIPELINE_TABLE, dealId, {
          OSINT_Status: "Extracting Metadata",
        });
      });

      // Step 5: LinkedIn Enrichment
      const linkedinResult = await step.run("scrape-linkedin", async () => {
        const targetLinkedinUrl =
          linkedInUrl ||
          (websiteResult.success && (websiteResult as any).socialAndSchema?.socialLinks?.linkedin) ||
          "";

        const { enrichFromLinkedIn } = await import("../../lib/playwright/linkedin.js");
        return enrichFromLinkedIn({
          linkedInUrl: targetLinkedinUrl || undefined,
          companyName,
          website,
        });
      });

      // Step 6: Mark as Analyzing Company
      await step.run("mark-analyzing-company", async () => {
        await airtableUpdate(PIPELINE_TABLE, dealId, {
          OSINT_Status: "Analyzing Company",
        });
      });

      // Step 7: Run Claude AI synthesis
      const synthesisResult = await step.run("claude-synthesis", async () => {
        return synthesizeWithClaude(companyName, {
          website: websiteResult.success ? websiteResult : undefined,
          companiesHouse: chResult.found ? chResult : undefined,
          linkedIn: linkedinResult.found ? linkedinResult.data : undefined,
          news: newsResult.articles && newsResult.articles.length > 0 ? newsResult.articles : undefined,
        });
      });

      // Step 8: Mark as Generating Risk Profile
      await step.run("mark-generating-risk-profile", async () => {
        await airtableUpdate(PIPELINE_TABLE, dealId, {
          OSINT_Status: "Generating Risk Profile",
        });
      });

      // Step 9: Persist Completed results to Airtable
      await step.run("persist-enrichment-completed", async () => {
        const compiledResult = {
          dealId,
          companyName,
          enrichedAt: new Date().toISOString(),
          websiteResult,
          chResult,
          newsResult,
          linkedinResult,
        };

        const updatePayload: Record<string, any> = {
          OSINT_Status: "Completed",
          OSINT_Completed_At: new Date().toISOString(),
          OSINT_Data: JSON.stringify(compiledResult),
          OSINT_Summary: synthesisResult.synthesis || "",
          OSINT_Key_Insights: (synthesisResult.keyInsights || []).join("\n• "),
          OSINT_Risk_Flags: (synthesisResult.riskFlags || []).join("\n• "),
          Sector: synthesisResult.industry !== "Unknown" ? synthesisResult.industry : undefined,
        };

        if (chResult?.company?.companyNumber) {
          updatePayload["Companies_House_Number"] = chResult.company.companyNumber;
        }

        if (linkedinResult?.data?.linkedInUrl) {
          updatePayload["LinkedIn_URL"] = linkedinResult.data.linkedInUrl;
        }

        await airtableUpdate(PIPELINE_TABLE, dealId, updatePayload);
      });

      return {
        success: true,
        dealId,
        companyName,
        status: "Completed",
      };
    } catch (err: any) {
      console.error(`[OSINT Workflow] Pipeline failed for ${companyName}:`, err.message);

      // Handle failure persistence
      await step.run("persist-enrichment-failed", async () => {
        await airtableUpdate(PIPELINE_TABLE, dealId, {
          OSINT_Status: "Failed",
          OSINT_Completed_At: new Date().toISOString(),
          OSINT_Failure_Reason: err.message || "Unknown pipeline error",
        });
      });

      throw err; // Propagate for Inngest retries
    }
  }
);

// ─── 2. Portfolio Processing Workflow ────────────────────────────────────────

const onPortfolioProcessRequested = inngest.createFunction(
  {
    id: "portfolio-process-workflow",
    name: "Portfolio: KPI Aggregation + Intelligence",
    retries: 2,
    triggers: [{ event: "portfolio/process_requested" }],
  },
  async ({ event, step }) => {
    const portfolioResult = await step.run("aggregate-portfolio", async () => {
      return runPortfolioIntelligence();
    });

    await step.run("persist-snapshot", async () => {
      try {
        await airtableCreate("Portfolio_Snapshots", {
          Snapshot_Date: new Date().toISOString().split("T")[0],
          KPIs: JSON.stringify(portfolioResult.kpis),
          Summary: portfolioResult.summary,
          Action_Items: portfolioResult.actionItems.join("\n"),
          Risk_Alerts: portfolioResult.riskAlerts.join("\n"),
          Raw_Data: JSON.stringify(portfolioResult).substring(0, 50_000),
          Triggered_By: event.data.triggeredBy || "scheduled",
        });
      } catch (err: any) {
        console.warn("[Portfolio] Portfolio_Snapshots table not found — skipping snapshot write:", err.message);
      }
    });

    return {
      success: true,
      kpis: portfolioResult.kpis,
    };
  }
);

// ─── Export ──────────────────────────────────────────────────────────────────

export const osintWorkflows = [onOsintScrapeRequested, onPortfolioProcessRequested];
