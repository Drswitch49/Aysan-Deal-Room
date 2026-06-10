export interface LiquidityInput {
  currentAssets: number;
  currentLiabilities: number;
  revenue: number;
  costOfGoodsSold?: number;
  netIncome: number;
}

export interface LiquidityResult {
  currentRatio: number | null;
  netWorkingCapital: number;
  grossMargin: number | null;
  netMargin: number | null;
  isValid: boolean;
}

export function calculateLiquidityAndMargins(input: LiquidityInput): LiquidityResult {
  const assets = input.currentAssets;
  const liabilities = input.currentLiabilities;
  const rev = input.revenue;
  const cogs = input.costOfGoodsSold !== undefined ? input.costOfGoodsSold : 0;
  const netInc = input.netIncome;

  let currentRatio: number | null = null;
  let isValid = true;

  if (liabilities > 0) {
    currentRatio = Number((assets / liabilities).toFixed(2));
  } else if (liabilities === 0 && assets > 0) {
    currentRatio = 99.99; // Essentially infinite ratio
  } else {
    currentRatio = 0.0;
  }

  let grossMargin: number | null = null;
  if (rev > 0) {
    // If COGS is not provided, we can fallback to Gross Margin being null or 1.0 (if COGS = 0)
    if (input.costOfGoodsSold !== undefined) {
      grossMargin = Number(((rev - cogs) / rev).toFixed(4));
    }
  }

  let netMargin: number | null = null;
  if (rev > 0) {
    netMargin = Number((netInc / rev).toFixed(4));
  }

  return {
    currentRatio,
    netWorkingCapital: assets - liabilities,
    grossMargin,
    netMargin,
    isValid,
  };
}
