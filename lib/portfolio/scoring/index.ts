import type { CompanyHistory } from "../aggregation/index.js";
import type { PortfolioAlertRecord, PortfolioHealthRecord } from "../db.js";
import { getDaysSincePeriod } from "../monitoring/index.js";
import { analyzeQoqTrend } from "../trends/index.js";

/**
 * Calculates the portfolio health score for a company deterministically.
 */
export function calculateCompanyHealthScore(
  history: CompanyHistory,
  activeAlerts: PortfolioAlertRecord[],
  referenceDateStr?: string
): PortfolioHealthRecord {
  const { companyId, companyName, metrics } = history;
  const referenceDate = referenceDateStr ? new Date(referenceDateStr) : new Date();

  // If no metrics, return 0 health score with critical risk
  if (metrics.length === 0) {
    return {
      companyId,
      companyName,
      portfolioScore: 0,
      riskLevel: "high",
      activeAlerts: activeAlerts.length,
      trendSummary: "No metric records available for scoring.",
      updatedAt: referenceDate.toISOString(),
    };
  }

  const latestIndex = metrics.length - 1;
  const latest = metrics[latestIndex];

  // 1. Financial Stability (Max 40 points)
  let financialScore = 0;
  // DSCR component (Max 20)
  if (latest.dscr >= 1.30) {
    financialScore += 20;
  } else if (latest.dscr >= 1.20) {
    financialScore += 10;
  } else {
    financialScore += 0;
  }
  // Leverage component (Max 20)
  if (latest.leverage <= 3.5) {
    financialScore += 20;
  } else if (latest.leverage <= 4.5) {
    financialScore += 10;
  } else {
    financialScore += 0;
  }

  // 2. Operational Health (Max 30 points)
  let operationalScore = 0;
  // Headcount QoQ component (Max 15)
  const hcTrend = analyzeQoqTrend(metrics, "headcount", latestIndex);
  if (!hcTrend || hcTrend.percentChange >= 0) {
    operationalScore += 15;
  } else if (hcTrend.percentChange > -15.0) {
    operationalScore += 7;
  } else {
    operationalScore += 0;
  }
  // Churn component (Max 15)
  if (latest.churnRate === undefined) {
    operationalScore += 15; // default if not reported
  } else if (latest.churnRate <= 1.5) {
    operationalScore += 15;
  } else if (latest.churnRate <= 3.0) {
    operationalScore += 7;
  } else {
    operationalScore += 0;
  }

  // 3. Reporting Cadence (Max 20 points)
  let reportingScore = 0;
  const daysSince = getDaysSincePeriod(latest.reportingPeriod, referenceDate);
  if (daysSince <= 30) {
    reportingScore += 20;
  } else if (daysSince <= 60) {
    reportingScore += 10;
  } else {
    reportingScore += 0;
  }

  // 4. Risk Deductions (Max 10 points)
  let riskScore = 10;
  const criticalCount = activeAlerts.filter((a) => a.severity === "critical").length;
  const mediumCount = activeAlerts.filter((a) => a.severity === "medium").length;
  
  riskScore -= criticalCount * 10;
  riskScore -= mediumCount * 5;
  if (riskScore < 0) riskScore = 0;

  // Final Score Summation
  const portfolioScore = Math.max(0, Math.min(100, financialScore + operationalScore + reportingScore + riskScore));

  // Determine Risk Level
  let riskLevel: "low" | "medium" | "high" = "low";
  if (portfolioScore < 60) {
    riskLevel = "high";
  } else if (portfolioScore < 80) {
    riskLevel = "medium";
  }

  // Build Trend Summary
  const trends: string[] = [];
  if (latest.dscr < 1.30) {
    trends.push(`DSCR stressed at ${latest.dscr.toFixed(2)}x`);
  }
  if (latest.leverage > 3.5) {
    trends.push(`Leverage elevated at ${latest.leverage.toFixed(1)}x`);
  }
  if (hcTrend && hcTrend.percentChange < 0) {
    trends.push(`Headcount down ${Math.abs(hcTrend.percentChange).toFixed(1)}% QoQ`);
  }
  if (latest.churnRate !== undefined && latest.churnRate > 1.5) {
    trends.push(`Churn at ${latest.churnRate.toFixed(1)}%`);
  }

  const trendSummary = trends.length > 0 
    ? `Emerging issues: ${trends.join(", ")}.`
    : "Financial and operational metrics stable; reporting on track.";

  return {
    companyId,
    companyName,
    portfolioScore,
    riskLevel,
    activeAlerts: activeAlerts.length,
    trendSummary,
    updatedAt: referenceDate.toISOString(),
  };
}

/**
 * Calculates portfolio-wide average health index
 */
export function calculatePortfolioHealthIndex(healths: PortfolioHealthRecord[]): number {
  if (healths.length === 0) return 100;
  const sum = healths.reduce((acc, h) => acc + h.portfolioScore, 0);
  return Math.round(sum / healths.length);
}
