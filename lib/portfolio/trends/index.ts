import type { PortfolioMetricRecord } from "../db.js";

export interface TrendAnalysisResult {
  metric: string;
  currentValue: number;
  priorValue: number;
  percentChange: number; // e.g. -15.5 for a 15.5% decline
  status: "growth" | "stable" | "decline" | "flat";
}

/**
 * Evaluates Quarter-over-Quarter trend for a specific metric key
 */
export function analyzeQoqTrend(
  history: PortfolioMetricRecord[],
  key: "revenue" | "ebitda" | "dscr" | "leverage" | "headcount",
  currentPeriodIndex: number
): TrendAnalysisResult | null {
  if (currentPeriodIndex < 3) return null; // Insufficient history for QoQ

  const currentRec = history[currentPeriodIndex];
  const priorRec = history[currentPeriodIndex - 3];

  const currentValue = currentRec[key] ?? 0;
  const priorValue = priorRec[key] ?? 0;

  if (priorValue === 0) return null;

  const percentChange = Number((((currentValue - priorValue) / priorValue) * 100).toFixed(2));
  
  let status: "growth" | "stable" | "decline" | "flat" = "flat";
  if (percentChange > 2.0) status = "growth";
  else if (percentChange < -2.0) status = "decline";
  else status = "stable";

  return {
    metric: key,
    currentValue,
    priorValue,
    percentChange,
    status,
  };
}

/**
 * Evaluates Month-over-Month trend for a specific metric key
 */
export function analyzeMomTrend(
  history: PortfolioMetricRecord[],
  key: "revenue" | "ebitda" | "dscr" | "leverage" | "headcount",
  currentPeriodIndex: number
): TrendAnalysisResult | null {
  if (currentPeriodIndex < 1) return null;

  const currentRec = history[currentPeriodIndex];
  const priorRec = history[currentPeriodIndex - 1];

  const currentValue = currentRec[key] ?? 0;
  const priorValue = priorRec[key] ?? 0;

  if (priorValue === 0) return null;

  const percentChange = Number((((currentValue - priorValue) / priorValue) * 100).toFixed(2));
  
  let status: "growth" | "stable" | "decline" | "flat" = "flat";
  if (percentChange > 1.0) status = "growth";
  else if (percentChange < -1.0) status = "decline";
  else status = "stable";

  return {
    metric: key,
    currentValue,
    priorValue,
    percentChange,
    status,
  };
}
