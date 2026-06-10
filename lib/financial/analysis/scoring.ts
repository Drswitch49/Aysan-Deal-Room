import { INITIAL_SCORING_CONFIG, type ScoringModelConfig } from "../config/scoring.js";
import type { Anomaly } from "./anomalies.js";

export interface ScoreInput {
  dscr: number | null;
  leverageRatio: number | null;
  ebitdaMargin: number | null;
  currentRatio: number | null;
  cashFlowStabilityRating?: "high" | "moderate" | "low" | number;
  revenueTrendRating?: "growing" | "stable" | "declining" | number;
  osintCredibilityRating?: "high" | "low" | boolean;
  workflowCompletenessRating?: number; // 0 to 1
  anomalies: Anomaly[];
}

export interface ScorecardFactor {
  score: number;
  maxScore: number;
  explanation: string;
}

export interface ScorecardDeduction {
  reason: string;
  impact: number;
}

export interface ScorecardResult {
  dealScore: number;
  maxScore: number;
  factors: {
    dscr: ScorecardFactor;
    leverage: ScorecardFactor;
    ebitdaMargin: ScorecardFactor;
    liquidity: ScorecardFactor;
    cashFlowStability: ScorecardFactor;
    revenueTrend: ScorecardFactor;
    osintCredibility: ScorecardFactor;
    workflowCompleteness: ScorecardFactor;
  };
  deductions: ScorecardDeduction[];
  confidenceScore: number;
}

export function evaluateDealScore(
  input: ScoreInput,
  config: ScoringModelConfig = INITIAL_SCORING_CONFIG
): ScorecardResult {
  let confidenceCount = 0;
  let totalPossibleConfidence = 5; // Track how many metrics we actually received

  // 1. DSCR (25 pts)
  let dscrScore = 0;
  let dscrExplanation = "No DSCR data available.";
  if (input.dscr !== null) {
    confidenceCount++;
    for (const cfg of config.thresholds.dscr) {
      if (input.dscr >= cfg.threshold) {
        dscrScore = cfg.points;
        break;
      }
    }
    dscrExplanation = `DSCR of ${input.dscr} earns ${dscrScore}/${config.weights.dscr} points.`;
  }

  // 2. Leverage Ratio (20 pts)
  let leverageScore = 0;
  let leverageExplanation = "No leverage ratio data available.";
  if (input.leverageRatio !== null) {
    confidenceCount++;
    for (const cfg of config.thresholds.leverage) {
      if (input.leverageRatio <= cfg.threshold) {
        leverageScore = cfg.points;
        break;
      }
    }
    leverageExplanation = `Leverage ratio of ${input.leverageRatio}x earns ${leverageScore}/${config.weights.leverage} points.`;
  }

  // 3. EBITDA Margin (15 pts)
  let marginScore = 0;
  let marginExplanation = "No EBITDA margin data available.";
  if (input.ebitdaMargin !== null) {
    confidenceCount++;
    for (const cfg of config.thresholds.ebitdaMargin) {
      if (input.ebitdaMargin >= cfg.threshold) {
        marginScore = cfg.points;
        break;
      }
    }
    marginExplanation = `EBITDA margin of ${(input.ebitdaMargin * 100).toFixed(1)}% earns ${marginScore}/${config.weights.ebitdaMargin} points.`;
  }

  // 4. Current Ratio / Liquidity (10 pts)
  let liquidityScore = 0;
  let liquidityExplanation = "No current ratio data available.";
  if (input.currentRatio !== null) {
    confidenceCount++;
    for (const cfg of config.thresholds.currentRatio) {
      if (input.currentRatio >= cfg.threshold) {
        liquidityScore = cfg.points;
        break;
      }
    }
    liquidityExplanation = `Current ratio of ${input.currentRatio} earns ${liquidityScore}/${config.weights.currentRatio} points.`;
  }

  // 5. Cash Flow Stability (10 pts)
  let cashFlowScore = 0;
  let cashFlowExplanation = "No cash flow stability data available.";
  if (input.cashFlowStabilityRating !== undefined) {
    const val = input.cashFlowStabilityRating;
    if (typeof val === "number") {
      confidenceCount++;
      totalPossibleConfidence++;
      if (val >= 0.70) {
        cashFlowScore = config.weights.cashFlowStability;
      } else if (val >= 0.40) {
        cashFlowScore = Math.round(config.weights.cashFlowStability * 0.6);
      } else {
        cashFlowScore = 0;
      }
      cashFlowExplanation = `Cash flow conversion rate of ${(val * 100).toFixed(0)}% earns ${cashFlowScore}/${config.weights.cashFlowStability} points.`;
    } else {
      if (val === "high") {
        cashFlowScore = config.weights.cashFlowStability;
      } else if (val === "moderate") {
        cashFlowScore = Math.round(config.weights.cashFlowStability * 0.6);
      } else {
        cashFlowScore = 0;
      }
      cashFlowExplanation = `Cash flow stability rated as '${val}' earns ${cashFlowScore}/${config.weights.cashFlowStability} points.`;
    }
  }

  // 6. Revenue Trend (10 pts)
  let revTrendScore = 0;
  let revTrendExplanation = "No revenue growth trend available.";
  if (input.revenueTrendRating !== undefined) {
    const val = input.revenueTrendRating;
    if (typeof val === "number") {
      confidenceCount++;
      totalPossibleConfidence++;
      if (val >= 0.05) {
        revTrendScore = config.weights.revenueTrend;
      } else if (val >= -0.05) {
        revTrendScore = Math.round(config.weights.revenueTrend * 0.7);
      } else {
        revTrendScore = 0;
      }
      revTrendExplanation = `Revenue growth of ${(val * 100).toFixed(1)}% earns ${revTrendScore}/${config.weights.revenueTrend} points.`;
    } else {
      if (val === "growing") {
        revTrendScore = config.weights.revenueTrend;
      } else if (val === "stable") {
        revTrendScore = Math.round(config.weights.revenueTrend * 0.7);
      } else {
        revTrendScore = 0;
      }
      revTrendExplanation = `Revenue trend rated as '${val}' earns ${revTrendScore}/${config.weights.revenueTrend} points.`;
    }
  }

  // 7. OSINT Credibility (5 pts)
  let osintScore = 0;
  let osintExplanation = "No OSINT credibility metrics available.";
  if (input.osintCredibilityRating !== undefined) {
    const val = input.osintCredibilityRating;
    if (val === true || val === "high") {
      osintScore = config.weights.osintCredibility;
      osintExplanation = "Clean OSINT record and active online presence verified.";
    } else {
      osintScore = 0;
      osintExplanation = "OSINT scan is incomplete or indicates high credibility risks.";
    }
  }

  // 8. Workflow Completeness (5 pts)
  let completenessScore = 0;
  let completenessExplanation = "No document checklist data available.";
  if (input.workflowCompletenessRating !== undefined) {
    const val = input.workflowCompletenessRating; // 0 to 1
    completenessScore = Math.round(val * config.weights.completeness);
    completenessExplanation = `Checklist completeness of ${(val * 100).toFixed(0)}% earns ${completenessScore}/${config.weights.completeness} points.`;
  }

  // Deductions calculation
  const deductions: ScorecardDeduction[] = [];
  
  // Apply deductions based on anomalies detected
  for (const anomaly of input.anomalies) {
    if (anomaly.id === "negative_ebitda") {
      deductions.push({
        reason: "Negative EBITDA",
        impact: config.deductions.negativeEbitda,
      });
    } else if (anomaly.id === "liquidity_deficit") {
      deductions.push({
        reason: "Working Capital Deficit",
        impact: config.deductions.missingLiabilities, // use missing liabilities penalty
      });
    } else if (anomaly.id === "weak_debt_coverage") {
      deductions.push({
        reason: "Weak debt service coverage",
        impact: -10,
      });
    } else if (anomaly.id === "income_exceeds_revenue") {
      deductions.push({
        reason: "Logical Revenue Discrepancies",
        impact: config.deductions.revenueInconsistencies,
      });
    }
  }

  // Add specific checks for documentation completeness and OSINT warning flags
  if (input.osintCredibilityRating === false) {
    deductions.push({
      reason: "Weak online presence / Credibility warnings",
      impact: config.deductions.weakOnlinePresence,
    });
  }

  if (input.workflowCompletenessRating !== undefined && input.workflowCompletenessRating < 0.5) {
    deductions.push({
      reason: "Incomplete deal documents (under 50% uploaded)",
      impact: config.deductions.incompleteDocuments,
    });
  }

  // Sum scores
  const rawSum =
    dscrScore +
    leverageScore +
    marginScore +
    liquidityScore +
    cashFlowScore +
    revTrendScore +
    osintScore +
    completenessScore;

  const totalDeductions = deductions.reduce((acc, item) => acc + item.impact, 0);
  
  // Final Score is clamped between 0 and 100
  const dealScore = Math.max(0, Math.min(100, rawSum + totalDeductions));

  // Compute confidence score (ratio of received metrics over total required)
  const confidenceScore = Number((confidenceCount / totalPossibleConfidence).toFixed(2));

  return {
    dealScore,
    maxScore: 100,
    factors: {
      dscr: { score: dscrScore, maxScore: config.weights.dscr, explanation: dscrExplanation },
      leverage: { score: leverageScore, maxScore: config.weights.leverage, explanation: leverageExplanation },
      ebitdaMargin: { score: marginScore, maxScore: config.weights.ebitdaMargin, explanation: marginExplanation },
      liquidity: { score: liquidityScore, maxScore: config.weights.currentRatio, explanation: liquidityExplanation },
      cashFlowStability: { score: cashFlowScore, maxScore: config.weights.cashFlowStability, explanation: cashFlowExplanation },
      revenueTrend: { score: revTrendScore, maxScore: config.weights.revenueTrend, explanation: revTrendExplanation },
      osintCredibility: { score: osintScore, maxScore: config.weights.osintCredibility, explanation: osintExplanation },
      workflowCompleteness: { score: completenessScore, maxScore: config.weights.completeness, explanation: completenessExplanation },
    },
    deductions,
    confidenceScore,
  };
}
