import type { PortfolioMetricRecord } from "../db.js";

export interface AggregatedPeriodSummary {
  reportingPeriod: string;
  totalRevenue: number;
  totalEbitda: number;
  averageDscr: number;
  averageLeverage: number;
  totalHeadcount: number;
  companyCount: number;
}

export interface CompanyHistory {
  companyId: string;
  companyName: string;
  metrics: PortfolioMetricRecord[];
}

/**
 * Aggregates portfolio metrics into monthly periods and groups company history
 */
export function aggregatePortfolioMetrics(metrics: PortfolioMetricRecord[]): {
  periods: AggregatedPeriodSummary[];
  companyHistories: CompanyHistory[];
} {
  // 1. Group by Company
  const companyMap = new Map<string, { name: string; records: PortfolioMetricRecord[] }>();
  for (const m of metrics) {
    if (!companyMap.has(m.companyId)) {
      companyMap.set(m.companyId, { name: m.companyName, records: [] });
    }
    companyMap.get(m.companyId)!.records.push(m);
  }

  const companyHistories: CompanyHistory[] = [];
  for (const [id, value] of companyMap.entries()) {
    // Sort chronological (earliest to latest)
    value.records.sort((a, b) => a.reportingPeriod.localeCompare(b.reportingPeriod));
    companyHistories.push({
      companyId: id,
      companyName: value.name,
      metrics: value.records,
    });
  }

  // 2. Group by Period (YYYY-MM)
  const periodMap = new Map<string, PortfolioMetricRecord[]>();
  for (const m of metrics) {
    if (!periodMap.has(m.reportingPeriod)) {
      periodMap.set(m.reportingPeriod, []);
    }
    periodMap.get(m.reportingPeriod)!.push(m);
  }

  const periods: AggregatedPeriodSummary[] = [];
  for (const [period, records] of periodMap.entries()) {
    let revenueSum = 0;
    let ebitdaSum = 0;
    let dscrSum = 0;
    let leverageSum = 0;
    let headcountSum = 0;
    let dscrCount = 0;
    let leverageCount = 0;

    for (const r of records) {
      revenueSum += r.revenue;
      ebitdaSum += r.ebitda;
      headcountSum += r.headcount;

      if (r.dscr > 0) {
        dscrSum += r.dscr;
        dscrCount++;
      }
      if (r.leverage > 0) {
        leverageSum += r.leverage;
        leverageCount++;
      }
    }

    periods.push({
      reportingPeriod: period,
      totalRevenue: revenueSum,
      totalEbitda: ebitdaSum,
      averageDscr: dscrCount > 0 ? Number((dscrSum / dscrCount).toFixed(2)) : 0,
      averageLeverage: leverageCount > 0 ? Number((leverageSum / leverageCount).toFixed(2)) : 0,
      totalHeadcount: headcountSum,
      companyCount: records.length,
    });
  }

  // Sort chronological
  periods.sort((a, b) => a.reportingPeriod.localeCompare(b.reportingPeriod));

  return { periods, companyHistories };
}

/**
 * Computes rolling averages for a given metric across period summaries
 */
export function calculateRollingAverage(
  periods: AggregatedPeriodSummary[],
  key: "totalRevenue" | "totalEbitda" | "averageDscr" | "averageLeverage" | "totalHeadcount",
  months: number = 3
): Record<string, number> {
  const result: Record<string, number> = {};

  for (let i = 0; i < periods.length; i++) {
    const start = Math.max(0, i - months + 1);
    const slice = periods.slice(start, i + 1);
    const sum = slice.reduce((acc, p) => acc + p[key], 0);
    const avg = sum / slice.length;
    result[periods[i].reportingPeriod] = Number(avg.toFixed(2));
  }

  return result;
}
