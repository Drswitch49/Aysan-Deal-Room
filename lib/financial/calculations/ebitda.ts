export interface EbitdaInput {
  operatingIncome?: number;
  netIncome?: number;
  depreciationAndAmortization?: number;
  interestExpense?: number;
  taxExpense?: number;
  addBacks?: number;
}

export interface EbitdaResult {
  ebitda: number;
  normalizedEbitda: number;
  addBacks: number;
  isValid: boolean;
}

export function calculateEbitda(input: EbitdaInput): EbitdaResult {
  const depreciation = input.depreciationAndAmortization || 0;
  const addBacks = input.addBacks || 0;

  let ebitda = 0;
  let isValid = false;

  if (input.operatingIncome !== undefined) {
    ebitda = input.operatingIncome + depreciation;
    isValid = true;
  } else if (
    input.netIncome !== undefined &&
    input.interestExpense !== undefined &&
    input.taxExpense !== undefined
  ) {
    // Standard Net Income -> EBITDA bridge
    ebitda = input.netIncome + input.interestExpense + input.taxExpense + depreciation;
    isValid = true;
  } else if (input.netIncome !== undefined) {
    // Coarse fallback
    ebitda = input.netIncome + depreciation;
    isValid = true;
  }

  return {
    ebitda,
    normalizedEbitda: ebitda + addBacks,
    addBacks,
    isValid,
  };
}
