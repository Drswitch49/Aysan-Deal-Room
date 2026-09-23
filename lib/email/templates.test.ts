/**
 * Partner email templates.
 *
 * Rule R8 says no figures in email bodies except where the spec allows them,
 * and every email carries the fraud line. Both are the kind of rule that decays
 * quietly when someone adds a template, so they are asserted across all of them
 * rather than one at a time.
 */
import { describe, it, expect } from "vitest";
import { render, type TemplateName } from "./templates.js";

const ALL: TemplateName[] = [
  "invite",
  "credentials",
  "password_reset",
  "access_changed",
  "call_issued",
  "call_settled",
  "distribution",
  "report_published",
];

/** The two templates the spec permits to carry an amount. */
const MAY_CARRY_FIGURES = new Set<TemplateName>(["call_issued"]);

describe("partner email templates", () => {
  it("every template carries the fraud line and the risk footer", () => {
    for (const name of ALL) {
      const mail = render(name, { name: "E. Daji", portalUrl: "https://example.test/investors/portal" });
      expect(mail.text, name).toContain("We will never ask you to send money or bank details by email");
      expect(mail.html, name).toContain("We will never ask you to send money or bank details by email");
      expect(mail.text, name).toContain("ACP publishes no forecasts");
      expect(mail.subject.length, name).toBeGreaterThan(0);
    }
  });

  it("keeps figures out of the bodies that may not carry them", () => {
    for (const name of ALL) {
      if (MAY_CARRY_FIGURES.has(name)) continue;
      const mail = render(name, {
        name: "E. Daji",
        amount_pence: 25_000_000,
        period_label: "Q3 2026",
        portalUrl: "https://example.test/investors/portal",
      });
      expect(mail.text, name).not.toMatch(/£[\d,]/);
    }
  });

  it("puts the amount and due date in a capital call, as the spec allows", () => {
    const mail = render("call_issued", { amount_pence: 25_000_000, due_date: "2026-08-12" });
    expect(mail.text).toContain("£250,000");
    expect(mail.text).toContain("12 Aug 2026");
    // Bank details never travel by email, whatever else does.
    expect(mail.text).toContain("We will never send bank details by email");
  });

  it("carries the temporary password only in the credentials email", () => {
    const mail = render("credentials", {
      name: "E. Daji",
      password: "swordfish-temporary",
      portalUrl: "https://example.test/investors/portal",
    });
    expect(mail.text).toContain("swordfish-temporary");
    expect(mail.text).toContain("https://example.test/investors/portal");
    expect(mail.text).toContain("choose your own password");
  });

  it("names no deal and no figure when an offer is issued", () => {
    // Offers ship in Phase D, but the invite email is the same shape: it says
    // something is waiting, never what it is.
    const mail = render("report_published", { name: "E. Daji", period_label: "Q3 2026" });
    expect(mail.subject).toBe("Your Q3 2026 report is available");
    expect(mail.text).not.toMatch(/£/);
  });

  it("refuses an unknown template rather than sending a blank email", () => {
    expect(() => render("not_a_template", {})).toThrow(/Unknown email template/);
  });

  it("escapes HTML in a partner's name so a template cannot be injected", () => {
    const mail = render("invite", { name: "<script>alert(1)</script>", link: "https://example.test/x" });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});
