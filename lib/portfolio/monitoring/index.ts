import type { CompanyHistory } from "../aggregation/index.js";
import type { PortfolioAlertRecord, PortfolioMetricRecord } from "../db.js";
import { analyzeQoqTrend } from "../trends/index.js";

/**
 * Calculates the number of days between the first day of a YYYY-MM period and a reference date.
 */
export function getDaysSincePeriod(periodStr: string, referenceDate: Date = new Date()): number {
  const [year, month] = periodStr.split("-").map(Number);
  if (isNaN(year) || isNaN(month)) return 0;
  const periodDate = new Date(year, month - 1, 1);
  const diffTime = referenceDate.getTime() - periodDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Runs deterministic threshold checks and trend analysis to generate alert records.
 */
export function evaluateCompanyAlerts(
  history: CompanyHistory,
  referenceDateStr?: string
): PortfolioAlertRecord[] {
  const alerts: PortfolioAlertRecord[] = [];
  const { companyId, companyName, metrics } = history;
  const referenceDate = referenceDateStr ? new Date(referenceDateStr) : new Date();

  // If no metrics exist, trigger critical reporting inactivity alert
  if (metrics.length === 0) {
    alerts.push({
      companyId,
      companyName,
      alertType: "reporting",
      severity: "critical",
      explanation: "No historical metrics have been reported for this company.",
      triggeredAt: referenceDate.toISOString(),
    });
    return alerts;
  }

  // Find the latest metric record chronologically
  const latestIndex = metrics.length - 1;
  const latestMetric = metrics[latestIndex];

  // 1. Debt Service Coverage Ratio (DSCR)
  const dscr = latestMetric.dscr;
  if (dscr < 1.20) {
    alerts.push({
      companyId,
      companyName,
      alertType: "financial",
      severity: "critical",
      explanation: `DSCR is critical at ${dscr.toFixed(2)}x (threshold: < 1.20x)`,
      triggeredAt: referenceDate.toISOString(),
    });
  } else if (dscr < 1.30) {
    alerts.push({
      companyId,
      companyName,
      alertType: "financial",
      severity: "medium",
      explanation: `DSCR is stressed at ${dscr.toFixed(2)}x (threshold: < 1.30x)`,
      triggeredAt: referenceDate.toISOString(),
    });
  }

  // 2. Leverage Multiple
  const leverage = latestMetric.leverage;
  if (leverage > 4.5) {
    alerts.push({
      companyId,
      companyName,
      alertType: "financial",
      severity: "critical",
      explanation: `Leverage is critical at ${leverage.toFixed(2)}x EBITDA (threshold: > 4.5x)`,
      triggeredAt: referenceDate.toISOString(),
    });
  } else if (leverage > 3.5) {
    alerts.push({
      companyId,
      companyName,
      alertType: "financial",
      severity: "medium",
      explanation: `Leverage is elevated at ${leverage.toFixed(2)}x EBITDA (threshold: > 3.5x)`,
      triggeredAt: referenceDate.toISOString(),
    });
  }

  // 3. Operational: Churn Rate
  if (latestMetric.churnRate !== undefined) {
    const churn = latestMetric.churnRate;
    if (churn > 3.0) {
      alerts.push({
        companyId,
        companyName,
        alertType: "operational",
        severity: "medium",
        explanation: `Churn rate is elevated at ${churn.toFixed(2)}% (threshold: > 3.0%)`,
        triggeredAt: referenceDate.toISOString(),
      });
    }
  }

  // 4. Revenue Volatility (QoQ Decline)
  const revTrend = analyzeQoqTrend(metrics, "revenue", latestIndex);
  if (revTrend) {
    if (revTrend.percentChange <= -15.0) {
      alerts.push({
        companyId,
        companyName,
        alertType: "financial",
        severity: "critical",
        explanation: `Revenue has declined critically by ${Math.abs(revTrend.percentChange).toFixed(1)}% QoQ (threshold: > 15.0%)`,
        triggeredAt: referenceDate.toISOString(),
      });
    } else if (revTrend.percentChange <= -8.0) {
      alerts.push({
        companyId,
        companyName,
        alertType: "financial",
        severity: "medium",
        explanation: `Revenue has declined by ${Math.abs(revTrend.percentChange).toFixed(1)}% QoQ (threshold: > 8.0%)`,
        triggeredAt: referenceDate.toISOString(),
      });
    }
  }

  // 5. Headcount Contraction (QoQ Decline)
  const hcTrend = analyzeQoqTrend(metrics, "headcount", latestIndex);
  if (hcTrend) {
    if (hcTrend.percentChange <= -15.0) {
      alerts.push({
        companyId,
        companyName,
        alertType: "operational",
        severity: "critical",
        explanation: `Headcount has contracted critically by ${Math.abs(hcTrend.percentChange).toFixed(1)}% QoQ (threshold: > 15.0%)`,
        triggeredAt: referenceDate.toISOString(),
      });
    }
  }

  // 6. Reporting Inactivity (Days since latest reporting period)
  const daysSince = getDaysSincePeriod(latestMetric.reportingPeriod, referenceDate);
  if (daysSince > 60) {
    alerts.push({
      companyId,
      companyName,
      alertType: "reporting",
      severity: "critical",
      explanation: `No metrics reported for ${daysSince} days (threshold: > 60 days, last period: ${latestMetric.reportingPeriod})`,
      triggeredAt: referenceDate.toISOString(),
    });
  } else if (daysSince > 30) {
    alerts.push({
      companyId,
      companyName,
      alertType: "reporting",
      severity: "medium",
      explanation: `No metrics reported for ${daysSince} days (threshold: > 30 days, last period: ${latestMetric.reportingPeriod})`,
      triggeredAt: referenceDate.toISOString(),
    });
  }

  return alerts;
}
