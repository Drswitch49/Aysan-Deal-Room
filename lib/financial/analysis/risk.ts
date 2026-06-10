export interface RiskMarker {
  id: string;
  name: string;
  level: "critical" | "high" | "medium" | "low";
  description: string;
}

export interface RiskInput {
  dscr: number | null;
  leverageRatio: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  currentRatio: number | null;
  evToEbitdaMultiple: number | null;
  cashFlowConversion?: number; // operatingCashFlow / EBITDA
}

export function evaluateFinancialRisk(input: RiskInput): RiskMarker[] {
  const risks: RiskMarker[] = [];

  // 1. Debt coverage risk
  if (input.dscr !== null) {
    if (input.dscr < 1.0) {
      risks.push({
        id: "dscr_critical",
        name: "Critical Debt Service Coverage",
        level: "critical",
        description: `DSCR of ${input.dscr} indicates the business is running at an operating deficit relative to its debt obligations.`,
      });
    } else if (input.dscr < 1.25) {
      risks.push({
        id: "dscr_high",
        name: "Elevated Debt Service Coverage",
        level: "high",
        description: `DSCR of ${input.dscr} is thin, leaving little safety margin to absorb cash flow fluctuations.`,
      });
    }
  }

  // 2. Leverage risk
  if (input.leverageRatio !== null) {
    if (input.leverageRatio > 5.5) {
      risks.push({
        id: "leverage_critical",
        name: "Excessive Financial Leverage",
        level: "critical",
        description: `Leverage Ratio of ${input.leverageRatio}x is extremely high, representing institutional refinancing risk.`,
      });
    } else if (input.leverageRatio > 4.0) {
      risks.push({
        id: "leverage_high",
        name: "High Financial Leverage",
        level: "high",
        description: `Leverage Ratio of ${input.leverageRatio}x represents high debt levels that may limit credit availability.`,
      });
    }
  }

  // 3. Margin risk
  if (input.grossMargin !== null && input.grossMargin < 0.20) {
    risks.push({
      id: "margin_low_gross",
      name: "Thin Gross Margin",
      level: "high",
      description: `Gross margin of ${(input.grossMargin * 100).toFixed(1)}% is low, indicating high raw production/service costs.`,
    });
  }

  if (input.netMargin !== null && input.netMargin < 0.05) {
    risks.push({
      id: "margin_low_net",
      name: "Thin Net Margin",
      level: "medium",
      description: `Net margin of ${(input.netMargin * 100).toFixed(1)}% indicates highly compressed net profitability.`,
    });
  }

  // 4. Liquidity risk
  if (input.currentRatio !== null) {
    if (input.currentRatio < 1.0) {
      risks.push({
        id: "liquidity_deficit",
        name: "Liquidity Deficit",
        level: "high",
        description: `Current ratio of ${input.currentRatio} indicates short-term liabilities exceed short-term liquid assets.`,
      });
    } else if (input.currentRatio < 1.2) {
      risks.push({
        id: "liquidity_tight",
        name: "Tight Working Capital",
        level: "medium",
        description: `Current ratio of ${input.currentRatio} indicates tight operational liquidity buffer.`,
      });
    }
  }

  // 5. Valuation Multiple risk
  if (input.evToEbitdaMultiple !== null && input.evToEbitdaMultiple > 8.0) {
    risks.push({
      id: "valuation_high",
      name: "Premium Valuation Multiple",
      level: "medium",
      description: `EBITDA multiple of ${input.evToEbitdaMultiple}x is premium, requiring exceptional growth to justify entry value.`,
    });
  }

  // 6. Cash conversion risk
  if (input.cashFlowConversion !== undefined && input.cashFlowConversion < 0.5) {
    risks.push({
      id: "cash_conversion_low",
      name: "Weak Cash Conversion",
      level: "medium",
      description: `Cash flow conversion rate of ${(input.cashFlowConversion * 100).toFixed(0)}% indicates poor EBITDA conversion into cash.`,
    });
  }

  return risks;
}
