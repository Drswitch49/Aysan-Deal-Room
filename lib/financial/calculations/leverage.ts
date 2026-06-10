export interface LeverageInput {
  totalDebt: number;
  normalizedEbitda: number;
  interestExpense?: number;
}

export interface LeverageResult {
  leverageRatio: number | null; // null if insufficient ebitda
  interestCoverage: number | null; // null if zero interest or no EBITDA
  isLeverageValid: boolean;
  isInterestCoverageValid: boolean;
}

export function calculateLeverage(input: LeverageInput): LeverageResult {
  const ebitda = input.normalizedEbitda;
  const debt = input.totalDebt;
  const interest = input.interestExpense || 0;

  let leverageRatio: number | null = null;
  let isLeverageValid = false;

  if (ebitda > 0) {
    leverageRatio = Number((debt / ebitda).toFixed(2));
    isLeverageValid = true;
  } else if (ebitda <= 0 && debt > 0) {
    // Negative EBITDA with debt implies infinite/extremely high leverage
    leverageRatio = 99.99; // Cap at max representation
    isLeverageValid = true;
  } else if (debt === 0) {
    leverageRatio = 0.0;
    isLeverageValid = true;
  }

  let interestCoverage: number | null = null;
  let isInterestCoverageValid = false;

  if (interest > 0) {
    interestCoverage = Number((ebitda / interest).toFixed(2));
    isInterestCoverageValid = true;
  } else if (interest === 0 && ebitda > 0) {
    interestCoverage = 99.99; // Essentially infinite coverage
    isInterestCoverageValid = true;
  }

  return {
    leverageRatio,
    interestCoverage,
    isLeverageValid,
    isInterestCoverageValid,
  };
}
