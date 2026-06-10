export interface ThresholdConfig<T> {
  threshold: T;
  points: number;
}

export interface ScoringModelConfig {
  weights: {
    dscr: number;           // Max 25
    leverage: number;       // Max 20
    ebitdaMargin: number;   // Max 15
    currentRatio: number;   // Max 10
    cashFlowStability: number; // Max 10
    revenueTrend: number;   // Max 10
    osintCredibility: number;  // Max 5
    completeness: number;   // Max 5
  };
  thresholds: {
    dscr: ThresholdConfig<number>[];
    leverage: ThresholdConfig<number>[];
    ebitdaMargin: ThresholdConfig<number>[];
    currentRatio: ThresholdConfig<number>[];
  };
  deductions: {
    missingLiabilities: number;    // -10
    negativeEbitda: number;        // -15
    revenueInconsistencies: number;// -10
    weakOnlinePresence: number;    // -5
    incompleteDocuments: number;   // -5
  };
}

export const INITIAL_SCORING_CONFIG: ScoringModelConfig = {
  weights: {
    dscr: 25,
    leverage: 20,
    ebitdaMargin: 15,
    currentRatio: 10,
    cashFlowStability: 10,
    revenueTrend: 10,
    osintCredibility: 5,
    completeness: 5,
  },
  thresholds: {
    dscr: [
      { threshold: 1.5, points: 25 },
      { threshold: 1.25, points: 20 },
      { threshold: 1.1, points: 15 },
      { threshold: 1.0, points: 10 },
      { threshold: 0, points: 0 },
    ],
    leverage: [
      { threshold: 2.0, points: 20 },
      { threshold: 3.5, points: 15 },
      { threshold: 4.5, points: 10 },
      { threshold: 5.5, points: 5 },
      { threshold: 999.0, points: 0 }, // fallback
    ],
    ebitdaMargin: [
      { threshold: 0.20, points: 15 },
      { threshold: 0.15, points: 12 },
      { threshold: 0.10, points: 8 },
      { threshold: 0.05, points: 4 },
      { threshold: -99.0, points: 0 },
    ],
    currentRatio: [
      { threshold: 1.5, points: 10 },
      { threshold: 1.2, points: 8 },
      { threshold: 1.0, points: 5 },
      { threshold: 0, points: 0 },
    ],
  },
  deductions: {
    missingLiabilities: -10,
    negativeEbitda: -15,
    revenueInconsistencies: -10,
    weakOnlinePresence: -5,
    incompleteDocuments: -5,
  },
};
