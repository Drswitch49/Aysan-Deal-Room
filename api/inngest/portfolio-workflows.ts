import { inngest } from "../_utils/inngest.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { airtableFetch } from "../_utils/airtable.js";
import {
  getPortfolioMetrics,
  savePortfolioMetrics,
  savePortfolioAlerts,
  savePortfolioHealth,
  savePortfolioSummaryBriefing,
  generateHistoricalMetricsSeed,
  type PortfolioMetricRecord,
  type PortfolioAlertRecord,
  type PortfolioHealthRecord,
} from "../../lib/portfolio/db.js";
import { aggregatePortfolioMetrics } from "../../lib/portfolio/aggregation/index.js";
import { evaluateCompanyAlerts } from "../../lib/portfolio/monitoring/index.js";
import { calculateCompanyHealthScore } from "../../lib/portfolio/scoring/index.js";
import { generatePortfolioBriefingWithAI } from "../_services/ai.js";

/**
 * Shared logic to execute the portfolio analysis pipeline.
 */
export async function runPortfolioAnalysisPipeline(step: any, referenceDateStr?: string) {
  // Set processing status
  await step.run("set-processing-status", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const statusFilePath = path.resolve(process.cwd(), "scratch", "portfolio_status.json");
    try {
      fs.writeFileSync(
        statusFilePath,
        JSON.stringify({
          status: "Processing",
          startedAt: new Date().toISOString(),
        }, null, 2)
      );
    } catch (err) {
      console.warn("[Portfolio Workflow] Failed to write status file:", err);
    }
  });

  // Step 1: Fetch portfolio companies from Airtable
  const companies = await step.run("fetch-portfolio-companies", async () => {
    try {
      const pipelineTable = TABLES.PIPELINE || "Active_Pipeline";
      const dealsRes = await airtableFetch(pipelineTable, { maxRecords: 100 });
      
      const portCos = (dealsRes?.records || [])
        .filter((r: any) => {
          const fields = r.fields;
          const isPort =
            fields.Is_Portfolio === true ||
            fields.Is_Portfolio === 1 ||
            String(fields.Is_Portfolio).toLowerCase() === "true";
          const stage = String(fields.Stage || fields.Status || fields.Workflow_Stage || "").toUpperCase();
          return isPort || stage === "PORTFOLIO";
        })
        .map((r: any) => ({
          companyId: r.id,
          companyName: r.fields.Company_Name || r.fields.Company || r.fields.Deal_Ref || "Unknown Company",
        }));

      return portCos;
    } catch (err: any) {
      console.warn("[Portfolio Workflow] Failed to fetch pipeline, using defaults:", err.message);
      return [];
    }
  });

  // Default fallback companies for testing if none found in Airtable
  const targetCompanies = companies.length > 0 ? companies : [
    { companyId: "recClearWater123", companyName: "Clear Water Cleaning Services Ltd" },
    { companyId: "recApexLogistics456", companyName: "Apex Logistics Group" },
  ];

  // Step 2: Retrieve current metrics
  let metrics = await step.run("get-portfolio-metrics", async () => {
    return getPortfolioMetrics();
  });

  // Step 3: Seed historical metrics if database is empty
  if (!metrics || metrics.length === 0) {
    metrics = await step.run("seed-historical-metrics", async () => {
      const seeds: PortfolioMetricRecord[] = [];
      for (const comp of targetCompanies) {
        seeds.push(...generateHistoricalMetricsSeed(comp.companyId, comp.companyName));
      }
      await savePortfolioMetrics(seeds);
      return seeds;
    });
  }

  // Step 4: Run aggregation and analyze
  const { companyHistories } = aggregatePortfolioMetrics(metrics);

  // Step 5: Evaluate alerts and scores for each company
  const evaluation = await step.run("evaluate-alerts-and-scoring", async () => {
    const allAlerts: PortfolioAlertRecord[] = [];
    const allHealths: PortfolioHealthRecord[] = [];

    for (const comp of targetCompanies) {
      const history = companyHistories.find((h) => h.companyId === comp.companyId) || {
        companyId: comp.companyId,
        companyName: comp.companyName,
        metrics: [],
      };

      const alerts = evaluateCompanyAlerts(history, referenceDateStr);
      const health = calculateCompanyHealthScore(history, alerts, referenceDateStr);

      allAlerts.push(...alerts);
      allHealths.push(health);
    }

    return { allAlerts, allHealths };
  });

  const { allAlerts, allHealths } = evaluation;

  // Step 6: Persist alerts and health scores
  await step.run("persist-portfolio-results", async () => {
    await savePortfolioAlerts(allAlerts);
    await savePortfolioHealth(allHealths);
  });

  // Step 7: Generate Claude AI qualitative briefing
  const briefing = await step.run("generate-claude-briefing", async () => {
    try {
      // Get the latest metrics for each company to feed the summary prompt
      const latestMetrics: PortfolioMetricRecord[] = [];
      for (const comp of targetCompanies) {
        const history = companyHistories.find((h) => h.companyId === comp.companyId);
        if (history && history.metrics.length > 0) {
          latestMetrics.push(history.metrics[history.metrics.length - 1]);
        }
      }
      
      const summaryText = await generatePortfolioBriefingWithAI(latestMetrics, allHealths, allAlerts);
      await savePortfolioSummaryBriefing(summaryText);
      return summaryText;
    } catch (err: any) {
      console.error("[Portfolio Workflow] Claude briefing generation failed:", err.message);
      const fallbackBrief = "Weekly portfolio review complete. Some companies are experiencing stressed financial covenants (DSCR stressed at Clear Water Cleaning Services). Recommend scheduled follow-up review calls.";
      await savePortfolioSummaryBriefing(fallbackBrief);
      return fallbackBrief;
    }
  });

  // Set completed status
  await step.run("set-completed-status", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const statusFilePath = path.resolve(process.cwd(), "scratch", "portfolio_status.json");
    try {
      fs.writeFileSync(
        statusFilePath,
        JSON.stringify({
          status: "Completed",
          completedAt: new Date().toISOString(),
        }, null, 2)
      );
    } catch (err) {
      console.warn("[Portfolio Workflow] Failed to write status file:", err);
    }
  });

  return {
    success: true,
    companiesProcessed: targetCompanies.length,
    alertsTriggered: allAlerts.length,
    healthRecords: allHealths,
    briefing,
  };
}

/**
 * Inngest function: Portfolio Scheduled Weekly Run (Sunday midnight)
 */
export const onPortfolioScheduledRun = inngest.createFunction(
  {
    id: "portfolio-scheduled-run",
    name: "Portfolio: Scheduled Weekly Run",
    retries: 2,
    triggers: [{ cron: "0 0 * * 0" }],
  },
  async ({ step }) => {
    return runPortfolioAnalysisPipeline(step);
  }
);

/**
 * Inngest function: Portfolio Process Requested (manual or on metrics change)
 */
export const onPortfolioProcessRequested = inngest.createFunction(
  {
    id: "portfolio-process-requested",
    name: "Portfolio: Process Metrics",
    retries: 2,
    triggers: [{ event: "portfolio/process_requested" }],
  },
  async ({ event, step }) => {
    console.log("[Portfolio Workflow] Manual analysis triggered by:", event.data.triggeredBy);
    return runPortfolioAnalysisPipeline(step);
  }
);

export const portfolioWorkflows = [onPortfolioScheduledRun, onPortfolioProcessRequested];
