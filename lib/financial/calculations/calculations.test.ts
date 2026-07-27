/**
 * Golden-number tests for the pure financial calculators (Phase 5c).
 * These pin the engine's arithmetic so refactors can't silently change
 * DSCR/EBITDA/leverage/liquidity/valuation outputs.
 */
import { describe, it, expect } from "vitest";
import { calculateDscr } from "./dscr.js";
import { calculateEbitda } from "./ebitda.js";
import { calculateLeverage } from "./leverage.js";
import { calculateLiquidityAndMargins } from "./liquidity.js";
import { calculateValuation } from "./valuation.js";

describe("calculateDscr", () => {
  it("computes EBITDA and cash-flow DSCR", () => {
    const r = calculateDscr({ normalizedEbitda: 425_000, annualDebtService: 180_000, operatingCashFlow: 390_000 });
    expect(r).toEqual({ dscr: 2.36, dscrCashFlow: 2.17, isValid: true });
  });
  it("caps infinite coverage at 99.99 when no debt service and positive EBITDA", () => {
    expect(calculateDscr({ normalizedEbitda: 100_000, annualDebtService: 0 }).dscr).toBe(99.99);
  });
  it("returns 0 when no debt service and non-positive EBITDA", () => {
    expect(calculateDscr({ normalizedEbitda: -50_000, annualDebtService: 0 }).dscr).toBe(0);
  });
  it("is invalid for negative debt service", () => {
    expect(calculateDscr({ normalizedEbitda: 100_000, annualDebtService: -1 }).isValid).toBe(false);
  });
});

describe("calculateEbitda", () => {
  it("uses operating income + D&A when available", () => {
    const r = calculateEbitda({ operatingIncome: 300_000, depreciationAndAmortization: 50_000, addBacks: 25_000 });
    expect(r).toEqual({ ebitda: 350_000, normalizedEbitda: 375_000, addBacks: 25_000, isValid: true });
  });
  it("bridges from net income + interest + tax + D&A", () => {
    const r = calculateEbitda({ netIncome: 200_000, interestExpense: 30_000, taxExpense: 45_000, depreciationAndAmortization: 25_000 });
    expect(r.ebitda).toBe(300_000);
    expect(r.isValid).toBe(true);
  });
  it("falls back coarsely to net income + D&A", () => {
    expect(calculateEbitda({ netIncome: 120_000, depreciationAndAmortization: 10_000 }).ebitda).toBe(130_000);
  });
  it("is invalid with no usable inputs", () => {
    expect(calculateEbitda({}).isValid).toBe(false);
  });
});

describe("calculateLeverage", () => {
  it("computes debt/EBITDA and interest coverage", () => {
    const r = calculateLeverage({ totalDebt: 900_000, normalizedEbitda: 425_000, interestExpense: 60_000 });
    expect(r.leverageRatio).toBe(2.12);
    expect(r.interestCoverage).toBe(7.08);
    expect(r.isLeverageValid).toBe(true);
    expect(r.isInterestCoverageValid).toBe(true);
  });
  it("caps leverage at 99.99 for negative EBITDA with debt", () => {
    expect(calculateLeverage({ totalDebt: 500_000, normalizedEbitda: -10_000 }).leverageRatio).toBe(99.99);
  });
  it("zero debt → leverage 0", () => {
    expect(calculateLeverage({ totalDebt: 0, normalizedEbitda: -10_000 }).leverageRatio).toBe(0);
  });
  it("zero interest with positive EBITDA → coverage capped 99.99", () => {
    expect(calculateLeverage({ totalDebt: 0, normalizedEbitda: 100 }).interestCoverage).toBe(99.99);
  });
});

describe("calculateLiquidityAndMargins", () => {
  it("computes ratios and margins", () => {
    const r = calculateLiquidityAndMargins({
      currentAssets: 500_000, currentLiabilities: 250_000,
      revenue: 1_780_000, costOfGoodsSold: 1_100_000, netIncome: 200_000,
    });
    expect(r.currentRatio).toBe(2);
    expect(r.netWorkingCapital).toBe(250_000);
    expect(r.grossMargin).toBe(0.382);
    expect(r.netMargin).toBe(0.1124);
  });
  it("omits gross margin when COGS unknown", () => {
    const r = calculateLiquidityAndMargins({ currentAssets: 1, currentLiabilities: 1, revenue: 100, netIncome: 10 });
    expect(r.grossMargin).toBeNull();
  });
  it("caps current ratio when no liabilities", () => {
    expect(calculateLiquidityAndMargins({ currentAssets: 5, currentLiabilities: 0, revenue: 0, netIncome: 0 }).currentRatio).toBe(99.99);
  });
});

describe("calculateValuation", () => {
  it("computes EV multiples", () => {
    const r = calculateValuation({ enterpriseValue: 2_000_000, normalizedEbitda: 425_000, revenue: 1_780_000 });
    expect(r.evToEbitdaMultiple).toBe(4.71);
    expect(r.evToRevenueMultiple).toBe(1.12);
    expect(r.isValid).toBe(true);
  });
  it("flags negative EBITDA multiple as -1", () => {
    expect(calculateValuation({ enterpriseValue: 1, normalizedEbitda: -5, revenue: 0 }).evToEbitdaMultiple).toBe(-1);
  });
  it("is invalid with zero EBITDA and zero revenue", () => {
    expect(calculateValuation({ enterpriseValue: 1, normalizedEbitda: 0, revenue: 0 }).isValid).toBe(false);
  });
});
