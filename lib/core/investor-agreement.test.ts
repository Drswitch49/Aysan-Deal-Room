/**
 * The Investors Agreement text is rendered twice — in the partner's browser,
 * which hashes what was shown, and on the server, which re-renders and checks
 * the hash before storing the signature. These pin that the two agree and that
 * the merge fields and the ROFR window behave.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  addWorkingDays,
  agreementText,
  investorsAgreement,
  longDate,
  poundsText,
} from "./investor-agreement.js";

const party = {
  name: "Jane Partner",
  entity: "Partner Family Office",
  address: "1 High Street, London",
  pledgePence: 10_000_000,
  date: "2026-10-04",
};

describe("investorsAgreement", () => {
  it("merges the partner's details into the text", () => {
    const text = agreementText(investorsAgreement(party));
    expect(text).toContain("THIS AGREEMENT is made on 4 October 2026");
    expect(text).toContain("Jane Partner (Partner Family Office), residing at or having its principal place of business at 1 High Street, London");
    expect(text).toContain("capital pledge of £100,000 (the \"Pledge Amount\")");
  });

  it("hashes the same in the browser (Web Crypto) as on the server (node:crypto)", async () => {
    const text = agreementText(investorsAgreement(party));
    const server = createHash("sha256").update(text, "utf8").digest("hex");
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const browser = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(browser).toBe(server);
  });

  it("changes the text, and so the hash, when any detail changes", () => {
    const a = agreementText(investorsAgreement(party));
    const b = agreementText(investorsAgreement({ ...party, pledgePence: 10_000_100 }));
    expect(a).not.toBe(b);
  });
});

describe("formatting without Intl", () => {
  it("writes dates and amounts the same in every runtime", () => {
    expect(longDate("2026-01-09")).toBe("9 January 2026");
    expect(poundsText(10_000_000)).toBe("£100,000");
    expect(poundsText(123_456_789)).toBe("£1,234,567.89");
    expect(poundsText(500)).toBe("£5");
  });
});

describe("addWorkingDays (the 10-business-day ROFR window)", () => {
  it("skips weekends", () => {
    // Monday 5 Oct 2026 + 10 business days = Monday 19 Oct.
    expect(addWorkingDays(new Date("2026-10-05T10:00:00Z"), 10)).toBe("2026-10-19");
    // Friday 9 Oct + 1 = Monday 12 Oct.
    expect(addWorkingDays(new Date("2026-10-09T10:00:00Z"), 1)).toBe("2026-10-12");
  });

  it("skips England and Wales bank holidays", () => {
    // Thu 24 Dec 2026 + 1: Christmas Day and the substitute Boxing Day (Mon 28) are skipped.
    expect(addWorkingDays(new Date("2026-12-24T10:00:00Z"), 1)).toBe("2026-12-29");
  });
});
