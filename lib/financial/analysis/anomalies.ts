export interface Anomaly {
  id: string;
  name: string;
  severity: "high" | "medium" | "low";
  explanation: string;
}

export interface AnomalyInput {
  revenue: number;
  netIncome: number;
  ebitda: number;
  normalizedEbitda: number;
  costOfGoodsSold?: number;
  currentAssets: number;
  currentLiabilities: number;
  totalDebt: number;
  annualDebtService: number;
  dscr: number | null;
  leverageRatio: number | null;
  enterpriseValue: number;
}

export function detectAnomalies(input: AnomalyInput): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // 1. Negative EBITDA
  if (input.normalizedEbitda < 0) {
    anomalies.push({
      id: "negative_ebitda",
      name: "Negative EBITDA",
      severity: "high",
      explanation: `The company has a negative normalized EBITDA (£${input.normalizedEbitda.toLocaleString()}), indicating core operational losses.`,
    });
  }

  // 2. Negative EBITDA with High Valuation
  if (input.normalizedEbitda < 0 && input.enterpriseValue > 0) {
    anomalies.push({
      id: "negative_ebitda_high_valuation",
      name: "Valuation Discrepancy",
      severity: "high",
      explanation: "Enterprise value is positive despite negative normalized EBITDA, which prevents standard EBITDA multiple valuation.",
    });
  }

  // 3. Logical Check: Net Income > Revenue
  if (input.netIncome > input.revenue && input.revenue > 0) {
    anomalies.push({
      id: "income_exceeds_revenue",
      name: "Logical Data Discrepancy",
      severity: "high",
      explanation: `Net income (£${input.netIncome.toLocaleString()}) exceeds total revenue (£${input.revenue.toLocaleString()}), which is logically impossible.`,
    });
  }

  // 4. Missing COGS
  if (input.revenue > 0 && input.costOfGoodsSold !== undefined && input.costOfGoodsSold <= 0) {
    anomalies.push({
      id: "missing_cogs",
      name: "Missing COGS / Expenses",
      severity: "medium",
      explanation: "Cost of Goods Sold (COGS) is reported as zero or negative on positive revenues, which likely indicates missing expense logs.",
    });
  }

  // 5. Weak Debt Coverage (DSCR < 1.0)
  if (input.dscr !== null && input.dscr < 1.0 && input.annualDebtService > 0) {
    anomalies.push({
      id: "weak_debt_coverage",
      name: "Weak Debt Coverage",
      severity: "high",
      explanation: `DSCR of ${input.dscr} is below 1.0, meaning current EBITDA is insufficient to cover annual debt principal and interest obligations.`,
    });
  }

  // 6. Excessive Leverage (> 5.5x)
  if (input.leverageRatio !== null && input.leverageRatio > 5.5) {
    anomalies.push({
      id: "excessive_leverage",
      name: "Excessive Leverage Ratio",
      severity: "high",
      explanation: `Leverage Ratio of ${input.leverageRatio}x exceeds the standard conservative threshold (5.5x), indicating high debt relative to earnings.`,
    });
  }

  // 7. Net Working Capital Deficit (Current Ratio < 1.0)
  if (input.currentLiabilities > input.currentAssets) {
    const ratio = (input.currentAssets / input.currentLiabilities).toFixed(2);
    anomalies.push({
      id: "liquidity_deficit",
      name: "Working Capital Deficit",
      severity: "high",
      explanation: `Current assets (£${input.currentAssets.toLocaleString()}) are less than current liabilities (£${input.currentLiabilities.toLocaleString()}) (Ratio: ${ratio}), representing short-term liquidity risk.`,
    });
  }

  return anomalies;
}
