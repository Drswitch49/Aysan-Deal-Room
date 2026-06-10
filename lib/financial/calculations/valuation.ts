export interface ValuationInput {
  enterpriseValue: number;
  normalizedEbitda: number;
  revenue: number;
}

export interface ValuationResult {
  enterpriseValue: number;
  evToEbitdaMultiple: number | null;
  evToRevenueMultiple: number | null;
  isValid: boolean;
}

export function calculateValuation(input: ValuationInput): ValuationResult {
  const ev = input.enterpriseValue;
  const ebitda = input.normalizedEbitda;
  const revenue = input.revenue;

  let evToEbitdaMultiple: number | null = null;
  let evToRevenueMultiple: number | null = null;
  let isValid = false;

  if (ebitda > 0) {
    evToEbitdaMultiple = Number((ev / ebitda).toFixed(2));
    isValid = true;
  } else if (ebitda < 0) {
    evToEbitdaMultiple = -1.0; // flag negative EBITDA multiple
    isValid = true;
  }

  if (revenue > 0) {
    evToRevenueMultiple = Number((ev / revenue).toFixed(2));
    isValid = true;
  }

  return {
    enterpriseValue: ev,
    evToEbitdaMultiple,
    evToRevenueMultiple,
    isValid,
  };
}
