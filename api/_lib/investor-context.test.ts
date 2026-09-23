/**
 * The certification window (rule R6).
 *
 * This is the read-path twin of is_certified_now() in migration 0019. If the
 * two ever disagree, a partner sees a door the database will not open, or the
 * reverse — so the boundaries are pinned here rather than left to be rediscovered.
 */
import { describe, it, expect } from "vitest";
import { isCertifiedNow } from "./investor-context.js";

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

describe("isCertifiedNow", () => {
  it("accepts a valid certification signed inside twelve months", () => {
    expect(isCertifiedNow("valid", daysAgo(30))).toBe(true);
    expect(isCertifiedNow("valid", daysAgo(364))).toBe(true);
  });

  it("refuses one signed more than twelve months ago", () => {
    // Thirteen months is the case acceptance Test 5 issues an invite against.
    expect(isCertifiedNow("valid", daysAgo(400))).toBe(false);
  });

  it("refuses every status but valid, however recent the date", () => {
    for (const status of ["not_certified", "pending", "expired", "", null, undefined]) {
      expect(isCertifiedNow(status, daysAgo(1))).toBe(false);
    }
  });

  it("refuses a valid status with no date or an unparseable one", () => {
    expect(isCertifiedNow("valid", null)).toBe(false);
    expect(isCertifiedNow("valid", "")).toBe(false);
    expect(isCertifiedNow("valid", "not a date")).toBe(false);
  });

  it("refuses a future-dated certification's expiry from wrapping", () => {
    // A date in the future is still inside the window, and should not be
    // rejected by an off-by-one in the comparison.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(isCertifiedNow("valid", tomorrow.toISOString().slice(0, 10))).toBe(true);
  });
});
