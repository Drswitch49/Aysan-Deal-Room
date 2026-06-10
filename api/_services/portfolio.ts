/**
 * Portfolio Intelligence Service
 *
 * Aggregates real operational KPIs from Airtable and generates a Claude-powered
 * portfolio intelligence summary.
 *
 * Designed to run inside an Inngest step (idempotent, retry-safe).
 * Runs on Vercel Pro (300s) — Airtable API calls are fast (<5s each).
 *
 * KPIs computed:
 *  - Total active / stalled deals
 *  - Pipeline value (weighted + total)
 *  - Stage distribution
 *  - Average deal size
 *  - Document completion rates
 *  - Transcript coverage
 *  - Deals with overdue next actions
 *  - Lender assignment coverage
 *  - OSINT enrichment coverage
 */

import { airtableFetch } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PortfolioKPIs {
  // Deal counts
  totalActiveDeals: number;
  stalledDeals: number;
  dealsInNegotiation: number;

  // Pipeline value
  totalPipelineValue: number;
  weightedPipelineValue: number;
  averageDealSize: number;

  // Stage distribution
  stageDistribution: Record<string, number>;

  // Operational health
  overdueDeals: number;
  dealsWithoutNextAction: number;
  dealsWithTranscripts: number;
  transcriptCoverageRate: number;

  // Document health
  totalDocuments: number;
  approvedDocuments: number;
  documentApprovalRate: number;

  // Intelligence coverage
  dealsWithOsint: number;
  dealsWithLenders: number;
  lenderCoverageRate: number;

  // Timing
  snapshotAt: string;
}

export interface PortfolioIntelligenceResult {
  kpis: PortfolioKPIs;
  summary: string;
  actionItems: string[];
  riskAlerts: string[];
  rawAt: string;
}

// ─── Stage Weights for Weighted Pipeline ─────────────────────────────────────
// Higher weights for more advanced deal stages (closer to close).

const STAGE_WEIGHTS: Record<string, number> = {
  Intro: 0.05,
  "IM Review": 0.15,
  "1st Call": 0.25,
  "2nd Call": 0.35,
  Negotiation: 0.55,
  "Heads of Terms": 0.70,
  "Due Diligence": 0.85,
  Completion: 0.95,
  Dead: 0,
  Killed: 0,
};

// ─── Claude Portfolio Summary ─────────────────────────────────────────────────

async function generatePortfolioSummary(kpis: PortfolioKPIs): Promise<{
  summary: string;
  actionItems: string[];
  riskAlerts: string[];
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      summary: "Portfolio intelligence summary unavailable — ANTHROPIC_API_KEY not configured.",
      actionItems: [],
      riskAlerts: [],
    };
  }

  const kpiText = JSON.stringify(kpis, null, 2);

  const systemPrompt = `You are a senior deal principal at Aysan Capital Partners (ACP).
You are reviewing real-time operational KPIs from the deal pipeline.
Generate a concise portfolio intelligence briefing.

RULES:
- Only reference the provided KPI data.
- Be specific, not generic. Reference actual numbers.
- Flag genuine risks based on the data (stalled deals, overdue actions, low coverage).

Respond ONLY with valid JSON:
{
  "summary": "2-3 paragraph operational briefing covering pipeline health, velocity, and notable trends",
  "actionItems": ["Specific action 1 with deal counts or context", "Specific action 2"],
  "riskAlerts": ["Risk based on data 1 (if any)"]
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
        messages: [{ role: "user", content: `Portfolio KPIs:\n\n${kpiText}` }],
      }),
    });

    if (!res.ok) {
      return { summary: "Summary generation failed.", actionItems: [], riskAlerts: [] };
    }

    const payload = await res.json();
    let raw = payload.content?.[0]?.text || "{}";
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }
    const parsed = JSON.parse(raw);
    return {
      summary: parsed.summary || "",
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      riskAlerts: Array.isArray(parsed.riskAlerts) ? parsed.riskAlerts : [],
    };
  } catch (err: any) {
    console.error("[Portfolio] Claude failed:", err.message);
    return {
      summary: `Summary generation failed: ${err.message}`,
      actionItems: [],
      riskAlerts: [],
    };
  }
}

// ─── Main Aggregator ──────────────────────────────────────────────────────────

export async function runPortfolioIntelligence(): Promise<PortfolioIntelligenceResult> {
  const snapshotAt = new Date().toISOString();
  const todayStr = new Date().toISOString().split("T")[0];

  // Fetch all pipeline records
  const pipelineResponse = await airtableFetch(TABLES.PIPELINE || "Active_Pipeline", { maxRecords: 500 });
  const documentResponse = await airtableFetch(TABLES.DOCUMENTS || "Documents", { maxRecords: 500 });
  const transcriptResponse = await airtableFetch(
    TABLES.TRANSCRIPT_ANALYSES || "Transcript_Analyses",
    { maxRecords: 500 }
  );

  const pipelineRecords: any[] = pipelineResponse?.records || [];
  const documentRecords: any[] = documentResponse?.records || [];
  const transcriptRecords: any[] = transcriptResponse?.records || [];

  // Filter active deals (exclude killed/dead)
  const activeDeals = pipelineRecords.filter((r) => {
    const status = String(r.fields["Status"] || r.fields["Stage"] || "").toLowerCase();
    return status !== "killed" && status !== "dead";
  });

  // Stage distribution
  const stageDistribution: Record<string, number> = {};
  for (const deal of activeDeals) {
    const stage = String(deal.fields["Stage"] || deal.fields["Status"] || "Unknown");
    stageDistribution[stage] = (stageDistribution[stage] || 0) + 1;
  }

  // Pipeline value
  let totalPipelineValue = 0;
  let weightedPipelineValue = 0;
  let dealSizeCount = 0;

  for (const deal of activeDeals) {
    const ev = Number(deal.fields["EV_Ask"] || deal.fields["EV Ask"] || 0);
    const stage = String(deal.fields["Stage"] || deal.fields["Status"] || "Intro");
    const weight = STAGE_WEIGHTS[stage] ?? 0.1;

    if (ev > 0) {
      totalPipelineValue += ev;
      weightedPipelineValue += ev * weight;
      dealSizeCount++;
    }
  }

  const averageDealSize = dealSizeCount > 0 ? totalPipelineValue / dealSizeCount : 0;

  // Overdue deals (Next Action Date in the past)
  const overdueDeals = activeDeals.filter((r) => {
    const actionDate = String(r.fields["Next_Action_Date"] || r.fields["Next Action Date"] || "");
    return actionDate && actionDate < todayStr;
  }).length;

  const dealsWithoutNextAction = activeDeals.filter((r) => {
    const action = r.fields["Next_Action"] || r.fields["Next Action"];
    return !action || String(action).trim() === "";
  }).length;

  // Stalled deals (no activity in last 14 days based on modified time)
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const stalledDeals = activeDeals.filter((r) => {
    const modified = r.fields["Last_Modified"] || (r as any).createdTime || "";
    return modified && modified < fourteenDaysAgo;
  }).length;

  const dealsInNegotiation = stageDistribution["Negotiation"] || 0;

  // Transcript coverage
  const dealsWithTranscripts = new Set(
    transcriptRecords
      .filter((r) => {
        const status = String(r.fields["Processing_Status"] || "");
        return status === "completed";
      })
      .map((r) => String(r.fields["Deal_ID"] || r.fields["Deal ID"] || ""))
      .filter(Boolean)
  ).size;

  const transcriptCoverageRate =
    activeDeals.length > 0 ? (dealsWithTranscripts / activeDeals.length) * 100 : 0;

  // Document health
  const totalDocuments = documentRecords.length;
  const approvedDocuments = documentRecords.filter((r) => {
    const status = String(r.fields["Status"] || "").toLowerCase();
    return status === "approved" || status === "completed";
  }).length;

  const documentApprovalRate =
    totalDocuments > 0 ? (approvedDocuments / totalDocuments) * 100 : 0;

  // OSINT coverage
  const dealsWithOsint = activeDeals.filter((r) => {
    const osintStatus = String(r.fields["OSINT_Status"] || "");
    return osintStatus === "completed";
  }).length;

  // Lender coverage (has at least one lender assigned)
  const dealsWithLenders = activeDeals.filter((r) => {
    const lenders = r.fields["Assigned_Lenders"] || r.fields["Lenders"];
    return Array.isArray(lenders) ? lenders.length > 0 : Boolean(lenders);
  }).length;

  const lenderCoverageRate =
    activeDeals.length > 0 ? (dealsWithLenders / activeDeals.length) * 100 : 0;

  const kpis: PortfolioKPIs = {
    totalActiveDeals: activeDeals.length,
    stalledDeals,
    dealsInNegotiation,
    totalPipelineValue: Math.round(totalPipelineValue),
    weightedPipelineValue: Math.round(weightedPipelineValue),
    averageDealSize: Math.round(averageDealSize),
    stageDistribution,
    overdueDeals,
    dealsWithoutNextAction,
    dealsWithTranscripts,
    transcriptCoverageRate: Math.round(transcriptCoverageRate),
    totalDocuments,
    approvedDocuments,
    documentApprovalRate: Math.round(documentApprovalRate),
    dealsWithOsint,
    dealsWithLenders,
    lenderCoverageRate: Math.round(lenderCoverageRate),
    snapshotAt,
  };

  // Claude intelligence summary
  const intelligence = await generatePortfolioSummary(kpis);

  return {
    kpis,
    summary: intelligence.summary,
    actionItems: intelligence.actionItems,
    riskAlerts: intelligence.riskAlerts,
    rawAt: snapshotAt,
  };
}
