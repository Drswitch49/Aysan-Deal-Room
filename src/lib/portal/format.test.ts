/**
 * Portal formatting and the activity feed.
 *
 * These are the rules a partner actually reads off the screen: money in pence
 * rendered en-GB, basis points rendered as a percentage, and an activity line
 * that is never invented. A regression here is not cosmetic — it misstates a
 * figure to a capital partner.
 */
import { describe, it, expect } from "vitest";
import { gbp, pct, formatDate, activityLine } from "./format";

describe("gbp", () => {
  it("renders pence as en-GB currency with no pence when whole", () => {
    expect(gbp(25_000_000)).toBe("£250,000");
    expect(gbp(0)).toBe("£0");
  });

  it("shows pence only when they are non-zero", () => {
    expect(gbp(150_050)).toBe("£1,500.50");
  });

  it("renders nothing as £0 rather than a blank", () => {
    expect(gbp(null)).toBe("£0");
    expect(gbp(undefined)).toBe("£0");
  });

  it("accepts a bigint, which is how the column is stored", () => {
    expect(gbp(25_000_000n)).toBe("£250,000");
  });
});

describe("pct", () => {
  it("turns basis points into a percentage", () => {
    expect(pct(1250)).toBe("12.5%");
    expect(pct(6100)).toBe("61%");
    expect(pct(0)).toBe("0%");
  });

  it("returns an empty string for nothing, not 0%", () => {
    // "0%" and "not yet reported" mean very different things about a holding.
    expect(pct(null)).toBe("");
    expect(pct(undefined)).toBe("");
  });
});

describe("formatDate", () => {
  it("uses the house format", () => {
    expect(formatDate("2026-08-12")).toBe("12 Aug 2026");
  });

  it("returns an empty string for nothing usable", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate("not a date")).toBe("");
  });
});

describe("activityLine", () => {
  it("renders a settled capital call with its figure and acquisition", () => {
    expect(
      activityLine("call_settled", { amount_pence: 25_000_000, deal: "Acquisition 01" }),
    ).toBe("Capital call settled · £250,000 · Acquisition 01");
  });

  it("renders a distribution", () => {
    expect(activityLine("distribution", { amount_pence: 50_000 })).toBe("Distribution declared · £500");
  });

  it("hides an event type nobody defined rather than printing a raw key", () => {
    expect(activityLine("some_new_backend_event", {})).toBeNull();
  });

  it("renders lifecycle events without inventing a figure", () => {
    expect(activityLine("access_activated", {})).toBe("Portal access activated");
    expect(activityLine("bought_back", { deal: "Acquisition 01" })).toBe(
      "Holding bought back · Acquisition 01",
    );
  });
});
