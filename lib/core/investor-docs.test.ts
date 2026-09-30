import { describe, expect, it } from "vitest";
import {
  DOC_CATEGORIES,
  DOC_TYPES,
  DOC_TYPE_INFO,
  evaluateDealGate,
  evaluatePartnerGate,
  standardTitle,
  unlockedCategories,
  workingDaysBetween,
  type GateDeal,
} from "./investor-docs";

const signed = (keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, { by: "cfo@acp", role: "cfo", at: "2026-09-01", reference: "memo" }]));

const pdf = { cloudinary_public_id: "a/b", file_format: "pdf" };

const sanctioned: GateDeal = {
  dscr_status: "above_floor",
  commitments: [{ investor_id: "p1", status: "pending", committed_pence: 100, paid_pence: 100, is_test: false }],
};

describe("the standard", () => {
  it("has 11 documents in 7 categories, each category holding at least one", () => {
    expect(DOC_TYPES).toHaveLength(11);
    expect(DOC_CATEGORIES).toHaveLength(7);
    for (const cat of DOC_CATEGORIES) {
      expect(DOC_TYPES.some((t) => DOC_TYPE_INFO[t].category === cat), cat).toBe(true);
    }
  });

  it("names documents Acquisition nn · Document name · YYYY-MM-DD · vn", () => {
    expect(
      standardTitle({ acquisitionNo: 1, docType: "term_sheet", date: new Date("2026-09-30T10:00:00Z"), version: 2 }),
    ).toBe("Acquisition 01 · Term Sheet · 2026-09-30 · v2");
  });
});

describe("evaluateDealGate", () => {
  it("lets C1 through with nothing but a file", () => {
    expect(evaluateDealGate({ doc_type: "onboarding_pack", ...pdf }, { dscr_status: null, commitments: [] }).ready).toBe(true);
  });

  it("holds the brief until the DSCR sanction and legal counsel approval exist, naming both", () => {
    const gate = evaluateDealGate({ doc_type: "brief", ...pdf }, { ...sanctioned, dscr_status: "not_yet_reported" });
    expect(gate.ready).toBe(false);
    expect(gate.blockers.join(" ")).toMatch(/DSCR sanction/);
    expect(gate.blockers.join(" ")).toMatch(/Legal counsel approval/);
    expect(
      evaluateDealGate({ doc_type: "brief", ...pdf, signoffs: signed(["legal_counsel_approval"]) }, sanctioned).ready,
    ).toBe(true);
  });

  it("refuses an offer document that is not a PDF, because it cannot be watermarked", () => {
    const gate = evaluateDealGate(
      { doc_type: "diligence_pack", cloudinary_public_id: "x", file_format: "docx", signoffs: signed(["legal_counsel_approval"]) },
      sanctioned,
    );
    expect(gate.blockers.join(" ")).toMatch(/PDF/);
  });

  it("adds the buyback formula sanction for the term sheet", () => {
    const gate = evaluateDealGate({ doc_type: "term_sheet", ...pdf, signoffs: signed(["legal_counsel_approval"]) }, sanctioned);
    expect(gate.blockers.join(" ")).toMatch(/buyback formula/);
  });

  it("holds ownership documents until every subscribing partner has paid", () => {
    const deal: GateDeal = {
      dscr_status: "above_floor",
      commitments: [
        { investor_id: "p1", status: "pending", committed_pence: 100, paid_pence: 100, is_test: false },
        { investor_id: "p2", status: "pending", committed_pence: 100, paid_pence: 40, is_test: false },
      ],
    };
    const gate = evaluateDealGate({ doc_type: "share_certificate", ...pdf, signoffs: signed(["shares_allotted"]) }, deal);
    expect(gate.blockers).toContain("Funds not yet received from 1 subscribing partner (CFO)");
  });

  it("ignores test subscriptions unless evaluating for a test partner", () => {
    const deal: GateDeal = {
      dscr_status: "above_floor",
      commitments: [{ investor_id: "t", status: "completed", committed_pence: 100, paid_pence: 100, is_test: true }],
    };
    const doc = { doc_type: "quarterly_report", ...pdf, signoffs: signed(["figures_certified"]) };
    expect(evaluateDealGate(doc, deal).ready).toBe(false);
    expect(evaluateDealGate(doc, deal, { includeTest: true }).ready).toBe(true);
  });

  it("warns, without blocking, when a notice goes out more than 5 working days after its event", () => {
    const gate = evaluateDealGate(
      { doc_type: "partner_notice", notice_type: "deal_killed", event_date: "2026-09-01", ...pdf },
      { dscr_status: null, commitments: [] },
      { now: new Date("2026-09-15") },
    );
    expect(gate.ready).toBe(true);
    expect(gate.warnings).toHaveLength(1);
  });
});

describe("partner gate and category order", () => {
  it("keeps offer documents from a partner whose certification has lapsed", () => {
    expect(evaluatePartnerGate({ doc_type: "brief" }, { certifiedNow: false })).toHaveLength(1);
    expect(evaluatePartnerGate({ doc_type: "legal_pack" }, { certifiedNow: false })).toHaveLength(0);
  });

  it("opens each category only when every category above it is complete", () => {
    expect(unlockedCategories(new Set(), false)).toEqual(new Set(["certification", "notices"]));
    expect(unlockedCategories(new Set(["brief", "diligence_pack"]), true)).toEqual(
      new Set(["certification", "notices", "offer"]),
    );
    const all = unlockedCategories(
      new Set(["brief", "diligence_pack", "term_sheet", "legal_pack", "completion_statement", "share_certificate", "quarterly_report"]),
      true,
    );
    expect(all.size).toBe(7);
  });
});

describe("workingDaysBetween", () => {
  it("skips weekends", () => {
    // Friday 4 Sep 2026 to Monday 7 Sep 2026 is one working day.
    expect(workingDaysBetween(new Date("2026-09-04"), new Date("2026-09-07"))).toBe(1);
  });
});
