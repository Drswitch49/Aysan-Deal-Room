/**
 * WBS engine against the Optimisation Brief v1.1 acceptance tests
 * (section 8). The fixture is ACP-033 Inspired Health as the brief
 * describes it: physio/MSK, direct-debit membership, systems licensed month
 * to month from the sellers, filed EBITDA positive.
 */
import { describe, expect, it } from "vitest";
import { buildWbsScorecard, linearScore, effectiveWeights, rankScheduleA, type ClaudeWbs, type WbsConfig } from "./wbs";
import { WBS_FIELD_KEYS, WBS_V2_PROPOSED } from "../../src/lib/acp/wbsSpec";

const notes = Array.from({ length: 40 }, (_, i) => `note line ${i + 1}`).join("\n");

const f = (value: unknown, status: string, source = "L1") => ({ value, status, source, next_action: null }) as never;

function acp033(): ClaudeWbs {
  const fields: Record<string, unknown> = Object.fromEntries(WBS_FIELD_KEYS.map((k) => [k, { value: null, status: "unknown", source: null, next_action: null }]));
  Object.assign(fields, {
    ebitda_filed_y1_y3: f([{ year: "YE24", ebitda_gbp: 180000 }, { year: "YE25", ebitda_gbp: 209000 }], "filed", "L3"),
    ebitda_seller_stated: f(265000, "vendor", "L4"),
    maintainable_ebitda_cases: f({ conservative_gbp: 117000, base_gbp: 140000, upside_gbp: 193000 }, "estimated", "L5"),
    cash_model: f("direct_debit_membership", "vendor", "L6"),
    recurring_pct: f(50, "vendor", "L7"),
    ip_owned_by_company: f("rolling_licence", "vendor", "L8"),
    patient_data_controller: f("seller_entity", "vendor", "L8"),
    subcontracted_practitioner_pct: f(45, "vendor", "L9"),
    accreditations: f([{ name: "HCPC", holder: "person", person_name: "Alexandra", revenue_critical: false }], "vendor", "L10"),
    sic_hard_stop: f(false, "filed", "L11"),
    insolvency: f(false, "filed", "L11"),
    litigation: f(false, "vendor", "L12"),
    misrepresentation: f(false, "verified", "L13"),
    premises_tenure: f({ type: "rolling", years_remaining: null }, "vendor", "L14"),
    complaints_open: f(false, "vendor", "L15"),
    clinical_rating: f("good", "verified", "L15"),
    capacity_utilisation: f(70, "vendor", "L16"),
  });
  return { fields, principals: ["Alexandra", "Nicolas"] } as ClaudeWbs;
}

const config = (signed: boolean): WbsConfig => ({
  version: 2,
  thresholds: WBS_V2_PROPOSED.thresholds,
  weights: WBS_V2_PROPOSED.weights,
  signed_by: signed ? "Dami" : null,
  signed_at: signed ? "2026-10-05T09:00:00Z" : null,
});

const run = (over: Partial<Parameters<typeof buildWbsScorecard>[0]> = {}) =>
  buildWbsScorecard({
    dealId: "deal-033",
    dealName: "Inspired Health",
    brokerRef: "172105",
    recipientName: "Kimberley Aspin",
    subsector: "physio_msk_chiro",
    runType: "post_call",
    raw: acp033(),
    config: config(true),
    inputKind: "notes",
    inputText: notes,
    precallBriefId: null,
    dscrSanctioned: false,
    dealColumns: { distance_rm11_miles: 20 },
    ...over,
  });

describe("WBS engine — Optimisation Brief v1.1 acceptance", () => {
  it("T1: an unsigned config never produces KILL", () => {
    const sc = run({ config: config(false) });
    expect(["PROVISIONAL", "UNSCORED"]).toContain(sc.verdict);
    expect(sc.gates.every((g) => g.result === "unscored")).toBe(true);
    expect(sc.total_score).toBeNull();
  });

  it("T1: even a filed loss cannot kill while the config is unsigned", () => {
    const raw = acp033();
    (raw.fields as Record<string, unknown>).ebitda_filed_y1_y3 = f([{ year: "YE25", ebitda_gbp: -5000 }], "filed", "L3");
    expect(run({ raw, config: config(false) }).verdict).not.toBe("KILL");
  });

  it("T2: WBS scores gates H1 to H9 only", () => {
    expect(run().gates.map((g) => g.id)).toEqual(["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9"]);
  });

  it("T3: a gate field tagged ESTIMATED stays OPEN", () => {
    const raw = acp033();
    (raw.fields as Record<string, unknown>).cash_model = f("applications_for_payment", "estimated", "L6");
    const h2 = run({ raw }).gates.find((g) => g.id === "H2")!;
    expect(h2.result).toBe("open");
    expect(h2.adjustments).toContain("estimated_cannot_fail");
  });

  it("FAIL on admissible evidence kills, and gates stop at the first FAIL", () => {
    const raw = acp033();
    (raw.fields as Record<string, unknown>).cash_model = f("applications_for_payment", "vendor", "L6");
    const sc = run({ raw });
    expect(sc.verdict).toBe("KILL");
    expect(sc.kill_reason).toBe("H2");
    expect(sc.gates.slice(2).every((g) => g.result === "unscored")).toBe(true);
  });

  it("vendor evidence is not admissible for a FAIL on a pre-call run", () => {
    const raw = acp033();
    (raw.fields as Record<string, unknown>).cash_model = f("project_staged", "vendor", "L6");
    expect(run({ raw, runType: "pre_call" }).gates.find((g) => g.id === "H2")!.result).toBe("open");
  });

  it("T4: ACP-033 on a signed WBS v2 config scores 40 to 48 and holds", () => {
    const sc = run();
    expect(sc.total_score).toBeGreaterThanOrEqual(40);
    expect(sc.total_score).toBeLessThanOrEqual(48);
    expect(sc.band).toBe("HOLD");
    // H3 (conditions not yet supplied) and H6 (rolling licence) are open → provisional.
    expect(sc.verdict).toBe("PROVISIONAL");
    expect(sc.gates.find((g) => g.id === "H6")!.qualifier).toBe("condition");
  });

  it("T7: B2C with nil debtors blocks LOI on deferred income, not debtors", () => {
    const sc = run();
    expect(sc.loi_blockers).toContain("deferred_income_missing");
    expect(sc.loi_blockers).not.toContain("debtors_missing");
  });

  it("T8: broker email — subject carries the broker ref, ≤ 12 items, no statute questions, no ACP figures", () => {
    const sc = run();
    expect(sc.broker_email.subject).toContain("172105");
    expect(sc.broker_email.subject).toBe("172105 Inspired Health: information request following our call with Alexandra and Nicolas");
    expect(sc.schedule_a.length).toBeLessThanOrEqual(12);
    expect(sc.broker_email.body).not.toMatch(/statute|regulation obliges|re-test/i);
    expect(sc.broker_email.body).not.toMatch(/£|\d+\s?k\b|\bEV\b/);
  });

  it("T13: Schedule A ranks accounts and the add-back bridge first, never hapi_ fields", () => {
    const sc = run();
    expect(sc.schedule_a[0].ask).toBe("Company number and the last three filed accounts");
    expect(sc.schedule_a[1].ask).toBe("Adjustment bridge from statutory profit, with directors' total pay");
    expect(sc.schedule_a.flatMap((a) => a.fields).some((k) => k.startsWith("hapi_"))).toBe(false);
    expect(sc.second_call_agenda.length).toBeGreaterThan(0);
  });

  it("linear scoring and sub-sector shifts", () => {
    expect(linearScore(60, 60, 45)).toBe(100);
    expect(linearScore(52.5, 60, 45)).toBe(50);
    expect(linearScore(1, 2, 3.5)).toBe(100);
    expect(linearScore(4, 2, 3.5)).toBe(0);
    const w = effectiveWeights(WBS_V2_PROPOSED.weights, "physio_msk_chiro");
    expect(w.D3).toBe(20);
    expect(w.D6).toBe(0);
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("Schedule A merges fields that share a document", () => {
    const items = rankScheduleA({});
    const accounts = items.find((i) => i.ask.startsWith("Company number"))!;
    expect(accounts.fields).toEqual(expect.arrayContaining(["ebitda_filed_y1_y3", "turnover_y1_y3"]));
  });
});
