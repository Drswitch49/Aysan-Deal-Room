export interface DscrInput {
  normalizedEbitda: number;
  annualDebtService: number; // Principal + Interest payments
  operatingCashFlow?: number;
}

export interface DscrResult {
  dscr: number | null;
  dscrCashFlow: number | null;
  isValid: boolean;
}

export function calculateDscr(input: DscrInput): DscrResult {
  const ebitda = input.normalizedEbitda;
  const debtService = input.annualDebtService;
  const ocf = input.operatingCashFlow;

  let dscr: number | null = null;
  let dscrCashFlow: number | null = null;
  let isValid = false;

  if (debtService > 0) {
    dscr = Number((ebitda / debtService).toFixed(2));
    if (ocf !== undefined && ocf > 0) {
      dscrCashFlow = Number((ocf / debtService).toFixed(2));
    }
    isValid = true;
  } else if (debtService === 0) {
    if (ebitda > 0) {
      dscr = 99.99; // Cap for infinite coverage
      isValid = true;
    } else {
      dscr = 0.0;
      isValid = true;
    }
  }

  return {
    dscr,
    dscrCashFlow,
    isValid,
  };
}
