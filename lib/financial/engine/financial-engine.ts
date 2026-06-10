import { calculateEbitda } from "../calculations/ebitda.js";
import { calculateLeverage } from "../calculations/leverage.js";
import { calculateDscr } from "../calculations/dscr.js";
import { calculateValuation } from "../calculations/valuation.js";
import { calculateLiquidityAndMargins } from "../calculations/liquidity.js";
import { detectAnomalies, type Anomaly } from "../analysis/anomalies.js";
import { evaluateFinancialRisk, type RiskMarker } from "../analysis/risk.js";
import { evaluateDealScore, type ScorecardResult } from "../analysis/scoring.js";

export interface RawFinancialsInput {
  revenue?: any;
  costOfGoodsSold?: any;
  netIncome?: any;
  operatingIncome?: any;
  depreciationAndAmortization?: any;
  addBacks?: any;
  currentAssets?: any;
  currentLiabilities?: any;
  totalDebt?: any;
  annualDebtService?: any;
  interestExpense?: any;
  enterpriseValue?: any;
  cashFlowStabilityRating?: "high" | "moderate" | "low" | number;
  revenueTrendRating?: "growing" | "stable" | "declining" | number;
  osintCredibilityRating?: "high" | "low" | boolean;
  workflowCompletenessRating?: number;
}

export interface StructuredFinancialReport {
  success: boolean;
  status: "valid" | "incomplete" | "insufficient_data" | "failed";
  missingFields: string[];
  calculatedMetrics?: {
    revenue: number;
    costOfGoodsSold: number;
    netIncome: number;
    operatingIncome: number;
    depreciationAndAmortization: number;
    ebitda: number;
    normalizedEbitda: number;
    addBacks: number;
    currentAssets: number;
    currentLiabilities: number;
    totalDebt: number;
    annualDebtService: number;
    interestExpense: number;
    enterpriseValue: number;
    dscr: number | null;
    leverageRatio: number | null;
    interestCoverage: number | null;
    evToEbitdaMultiple: number | null;
    evToRevenueMultiple: number | null;
    currentRatio: number | null;
    netWorkingCapital: number;
    grossMargin: number | null;
    netMargin: number | null;
  };
  anomalies: Anomaly[];
  risks: RiskMarker[];
  scorecard?: ScorecardResult;
  error?: string;
}

function parseNumber(val: any): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === "number") return val;
  const cleaned = String(val).replace(/[^0-9.-]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export function validateFinancialsInput(input: RawFinancialsInput) {
  const missingFields: string[] = [];
  
  if (input.revenue === undefined || input.revenue === null || String(input.revenue).trim() === "") {
    missingFields.push("revenue");
  }
  if (input.netIncome === undefined || input.netIncome === null || String(input.netIncome).trim() === "") {
    missingFields.push("netIncome");
  }
  if (input.currentAssets === undefined || input.currentAssets === null || String(input.currentAssets).trim() === "") {
    missingFields.push("currentAssets");
  }
  if (input.currentLiabilities === undefined || input.currentLiabilities === null || String(input.currentLiabilities).trim() === "") {
    missingFields.push("currentLiabilities");
  }

  if (missingFields.length > 0) {
    // Insufficient if top line metrics are missing
    const status = missingFields.includes("revenue") || missingFields.includes("netIncome")
      ? "insufficient_data"
      : "incomplete";
    return { status, missingFields };
  }

  return { status: "valid", missingFields: [] };
}

export function executeFinancialEngine(input: RawFinancialsInput): StructuredFinancialReport {
  try {
    const validation = validateFinancialsInput(input);
    if (validation.status === "insufficient_data") {
      return {
        success: false,
        status: "insufficient_data",
        missingFields: validation.missingFields,
        anomalies: [],
        risks: [],
        error: `Insufficient financial data. Missing critical fields: ${validation.missingFields.join(", ")}`,
      };
    }

    // Normalize input fields
    const revenue = parseNumber(input.revenue);
    const costOfGoodsSold = parseNumber(input.costOfGoodsSold);
    const netIncome = parseNumber(input.netIncome);
    const operatingIncome = input.operatingIncome !== undefined ? parseNumber(input.operatingIncome) : undefined;
    const depreciationAndAmortization = parseNumber(input.depreciationAndAmortization);
    const addBacks = parseNumber(input.addBacks);
    const currentAssets = parseNumber(input.currentAssets);
    const currentLiabilities = parseNumber(input.currentLiabilities);
    const totalDebt = parseNumber(input.totalDebt);
    const annualDebtService = parseNumber(input.annualDebtService);
    const interestExpense = parseNumber(input.interestExpense);
    const enterpriseValue = parseNumber(input.enterpriseValue);

    // 1. EBITDA Calculations
    const ebitdaResult = calculateEbitda({
      operatingIncome,
      netIncome,
      depreciationAndAmortization,
      interestExpense,
      taxExpense: 0, // Incurred tax can be added if available, defaults to 0
      addBacks,
    });

    const normEbitda = ebitdaResult.normalizedEbitda;

    // 2. Leverage Calculations
    const leverageResult = calculateLeverage({
      totalDebt,
      normalizedEbitda: normEbitda,
      interestExpense,
    });

    // 3. DSCR Calculations
    const dscrResult = calculateDscr({
      normalizedEbitda: normEbitda,
      annualDebtService,
    });

    // 4. Valuation Calculations
    const valuationResult = calculateValuation({
      enterpriseValue,
      normalizedEbitda: normEbitda,
      revenue,
    });

    // 5. Liquidity & Margins
    const liquidityResult = calculateLiquidityAndMargins({
      currentAssets,
      currentLiabilities,
      revenue,
      costOfGoodsSold: input.costOfGoodsSold !== undefined ? costOfGoodsSold : undefined,
      netIncome,
    });

    // 6. Anomalies check
    const anomalies = detectAnomalies({
      revenue,
      netIncome,
      ebitda: ebitdaResult.ebitda,
      normalizedEbitda: normEbitda,
      costOfGoodsSold: input.costOfGoodsSold !== undefined ? costOfGoodsSold : undefined,
      currentAssets,
      currentLiabilities,
      totalDebt,
      annualDebtService,
      dscr: dscrResult.dscr,
      leverageRatio: leverageResult.leverageRatio,
      enterpriseValue,
    });

    // 7. Risks check
    const risks = evaluateFinancialRisk({
      dscr: dscrResult.dscr,
      leverageRatio: leverageResult.leverageRatio,
      grossMargin: liquidityResult.grossMargin,
      netMargin: liquidityResult.netMargin,
      currentRatio: liquidityResult.currentRatio,
      evToEbitdaMultiple: valuationResult.evToEbitdaMultiple,
      cashFlowConversion: normEbitda > 0 ? (parseNumber(input.operatingIncome || netIncome) / normEbitda) : undefined,
    });

    // 8. Deterministic Deal Scoring
    const scorecard = evaluateDealScore({
      dscr: dscrResult.dscr,
      leverageRatio: leverageResult.leverageRatio,
      ebitdaMargin: revenue > 0 ? (normEbitda / revenue) : 0,
      currentRatio: liquidityResult.currentRatio,
      cashFlowStabilityRating: input.cashFlowStabilityRating,
      revenueTrendRating: input.revenueTrendRating,
      osintCredibilityRating: input.osintCredibilityRating,
      workflowCompletenessRating: input.workflowCompletenessRating,
      anomalies,
    });

    return {
      success: true,
      status: validation.status,
      missingFields: validation.missingFields,
      calculatedMetrics: {
        revenue,
        costOfGoodsSold,
        netIncome,
        operatingIncome: operatingIncome !== undefined ? operatingIncome : (netIncome + interestExpense),
        depreciationAndAmortization,
        ebitda: ebitdaResult.ebitda,
        normalizedEbitda: normEbitda,
        addBacks,
        currentAssets,
        currentLiabilities,
        totalDebt,
        annualDebtService,
        interestExpense,
        enterpriseValue,
        dscr: dscrResult.dscr,
        leverageRatio: leverageResult.leverageRatio,
        interestCoverage: leverageResult.interestCoverage,
        evToEbitdaMultiple: valuationResult.evToEbitdaMultiple,
        evToRevenueMultiple: valuationResult.evToRevenueMultiple,
        currentRatio: liquidityResult.currentRatio,
        netWorkingCapital: liquidityResult.netWorkingCapital,
        grossMargin: liquidityResult.grossMargin,
        netMargin: liquidityResult.netMargin,
      },
      anomalies,
      risks,
      scorecard,
    };
  } catch (err: any) {
    console.error("[Financial Engine] Execution crashed:", err);
    return {
      success: false,
      status: "failed",
      missingFields: [],
      anomalies: [],
      risks: [],
      error: err.message || "Failed to execute calculations engine",
    };
  }
}
