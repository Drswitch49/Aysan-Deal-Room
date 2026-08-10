import { describe, it, expect } from "vitest";
import { stripLetterhead } from "./settings";

const BODY = `We are pleased to confirm our non-binding intention to acquire 100% of the issued share capital of Project Jonah on the following principal terms:

Consideration: £525,000 total EV comprising cash at completion of £341,000, a Vendor Loan Note of £105,000 over 36 months at 5% per annum, and deferred consideration of £79,000.

We look forward to your positive response.`;

describe("stripLetterhead", () => {
  it("removes the LOI letterhead, leaving the message", () => {
    const withHead = `LETTER OF INTENT

From: Aysan Capital Partners
To: [Vendor name] - Project Jonah
Date: 10 August 2026

${BODY}`;
    expect(stripLetterhead(withHead)).toBe(BODY);
  });

  it("removes a Subject:/To: preamble from a model-written follow-up", () => {
    expect(stripLetterhead(`Subject: Follow-up & Discovery Outcomes\nTo: broker@example.com\n\nHi John,\n\nThanks for your time.`))
      .toBe("Hi John,\n\nThanks for your time.");
  });

  it("leaves a body that has no letterhead alone", () => {
    expect(stripLetterhead(BODY)).toBe(BODY);
  });

  it("keeps header-looking text that appears inside the message", () => {
    const body = `Hi John,\n\nPlease send the pack.\n\nTo: confirm, we need the aged debtors report.`;
    expect(stripLetterhead(body)).toBe(body);
  });

  it("does not mistake a first line that merely starts with a word for a header", () => {
    const body = `Following our call today, here are the next steps.`;
    expect(stripLetterhead(body)).toBe(body);
  });
});
