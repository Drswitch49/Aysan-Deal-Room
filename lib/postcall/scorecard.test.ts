import { describe, it, expect } from "vitest";
import { buildScorecard, sourceResolves, containsFiguresOrStructure, claudeScorecardSchema, type ClaudeScorecard, type EngineInput } from "./scorecard.js";
import { POSTCALL_FIELDS, type PlaybookConfig } from "../../src/lib/acp/postcallSpec.js";

const FULL_CONFIG: PlaybookConfig = {
  version: 3,
  recurring_gate_pct: 60,
  ebitda_band_min_gbp: 150_000,
  ebitda_band_max_gbp: 1_500_000,
  concentration_largest_pct: 25,
  concentration_top3_pct: 50,
  accreditation_stay_months: 12,
  manager_install_days: 90,
};

const EMPTY_CONFIG: PlaybookConfig = {
  version: 1,
  recurring_gate_pct: null,
  ebitda_band_min_gbp: null,
  ebitda_band_max_gbp: null,
  concentration_largest_pct: null,
  concentration_top3_pct: null,
  accreditation_stay_months: null,
  manager_install_days: null,
};

const INPUT = Array.from({ length: 20 }, (_, i) => `[00:0${Math.floor(i / 6)}:${String((i * 10) % 60).padStart(2, "0")}] line ${i + 1}`).join("\n");

const f = (value: unknown, source = "L1", status: "vendor" | "filed" | "estimated" | "verified" | "unknown" = "vendor", box: "kill" | "price" | "condition" | "none" = "none") =>
  ({ value, status, source, box, next_action: null });

/** A clean, all-pass extraction — each test breaks one thing. */
function passingRaw(): ClaudeScorecard {
  return {
    fields: {
      obligation_name: f("Regulatory Reform (Fire Safety) Order 2005"),
      retest_interval: f("Annual"),
      customer_type: f("Commercial landlords"),
      duty_holder_confirmed: f(true),
      rev_contracted_gbp: f(900_000),
      rev_scheduled_gbp: f(300_000),
      rev_oneoff_gbp: f(200_000),
      b2b_share: f(95),
      contract_term_months: f(36),
      notice_period_days: f(90),
      ebitda_filed_y1_y3: f([{ year: "2025", ebitda_gbp: 310_000 }], "L2", "filed"),
      maintainable_ebitda_gbp: f(330_000, "L2", "estimated"),
      largest_pct: f(18),
      top3_pct: f(40),
      manager_installable_90d: f(true),
      ledger_type: f("service_invoice"),
      accreditations: f([{ name: "BAFE", holder: "company", person_name: null }]),
      enforcement: f(false),
      litigation: f(false),
      structural_decline: f(false),
      hmrc_liability: f(false),
      sic_hard_stop: f(false),
      misrepresentation: f(false),
      debtors_aged: f({ bands: [], contracted_or_staged_gbp: 100_000, invoice_and_forget_gbp: 20_000, over_60_days_gbp: 5_000 }),
    },
    gates: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, result: "pass" as const })),
  };
}

function run(overrides: Partial<EngineInput> = {}, raw = passingRaw()) {
  return buildScorecard({
    dealId: "deal-1",
    companyName: "CleanCare Ltd",
    recipientName: "Sam",
    raw,
    config: FULL_CONFIG,
    institutionalBandPct: null,
    inputKind: "notes",
    inputText: INPUT,
    precallBriefId: null,
    dscrSanctioned: false,
    ...overrides,
  });
}

const gate = (sc: ReturnType<typeof run>, id: number) => sc.gates.find((g) => g.id === id)!;

describe("claudeScorecardSchema", () => {
  it("rejects prose outside the schema", () => {
    const raw = { ...passingRaw(), summary: "Great call" };
    expect(claudeScorecardSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects extra attributes on a field", () => {
    const raw = passingRaw();
    (raw.fields as Record<string, unknown>).b2b_share = { ...raw.fields.b2b_share, explanation: "because" };
    expect(claudeScorecardSchema.safeParse(raw).success).toBe(false);
  });

  it("accepts a clean extraction", () => {
    expect(claudeScorecardSchema.safeParse(passingRaw()).success).toBe(true);
  });
});

describe("sourceResolves", () => {
  const ctx = { inputText: INPUT, lineCount: 20, hasBrief: false };
  it("accepts in-range lines, ranges and lists", () => {
    expect(sourceResolves("L3", ctx)).toBe(true);
    expect(sourceResolves("L3-L7", ctx)).toBe(true);
    expect(sourceResolves("L3, L20", ctx)).toBe(true);
  });
  it("rejects out-of-range lines and made-up references", () => {
    expect(sourceResolves("L21", ctx)).toBe(false);
    expect(sourceResolves("L7-L3", ctx)).toBe(false);
    expect(sourceResolves("the call", ctx)).toBe(false);
    expect(sourceResolves("", ctx)).toBe(false);
  });
  it("accepts a timestamp only when it appears in the input", () => {
    expect(sourceResolves("00:01:00", ctx)).toBe(true);
    expect(sourceResolves("00:59:59", ctx)).toBe(false);
  });
  it("accepts brief references only when a brief was supplied", () => {
    expect(sourceResolves("brief:financialIntelligence", ctx)).toBe(false);
    expect(sourceResolves("brief:financialIntelligence", { ...ctx, hasBrief: true })).toBe(true);
  });
});

describe("buildScorecard", () => {
  it("returns every catalogue field and stamps the Playbook version", () => {
    const sc = run();
    expect(Object.keys(sc.fields)).toHaveLength(POSTCALL_FIELDS.length);
    expect(sc.playbook_version).toBe(3);
    expect(sc.gates.map((g) => g.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("forces a field with no resolvable source to unknown with a null value", () => {
    const raw = passingRaw();
    raw.fields.b2b_share = f(95, "L99");
    raw.fields.retest_interval = { ...f("Annual"), source: null };
    const sc = run({}, raw);
    expect(sc.fields.b2b_share).toMatchObject({ value: null, status: "unknown" });
    expect(sc.fields.retest_interval).toMatchObject({ value: null, status: "unknown" });
    expect(sc.field_adjustments).toEqual(expect.arrayContaining([
      { field: "b2b_share", code: "source_unresolved" },
      { field: "retest_interval", code: "source_missing" },
    ]));
  });

  it("turns every unknown field into an info-request question", () => {
    const sc = run();
    const unknownKeys = POSTCALL_FIELDS.filter((d) => sc.fields[d.key].status === "unknown").map((d) => d.key);
    expect(sc.info_request.map((q) => q.field)).toEqual(unknownKeys);
    expect(sc.info_request.every((q) => q.question.length > 0)).toBe(true);
  });

  it("computes completeness as known over required", () => {
    const sc = run();
    const known = POSTCALL_FIELDS.filter((d) => sc.fields[d.key].status !== "unknown").length;
    expect(sc.completeness).toEqual({ known, required: POSTCALL_FIELDS.length, pct: Math.round((known / POSTCALL_FIELDS.length) * 100) });
  });

  it("proceeds to info request when every gate passes and nothing is boxed", () => {
    const sc = run();
    expect(sc.kill_gates).toEqual([]);
    expect(sc.verdict).toBe("Proceed to info request");
  });

  it("kills on any gate fail, whatever else is boxed", () => {
    const raw = passingRaw();
    raw.gates[5] = { id: 6, result: "fail" };
    raw.fields.owner_pay_actual = f(20_000, "L4", "vendor", "price");
    const sc = run({}, raw);
    expect(sc.verdict).toBe("Kill");
    expect(sc.kill_gates).toEqual([6]);
  });

  it("ranks Price over Condition when no gate fails", () => {
    const raw = passingRaw();
    raw.fields.owner_pay_actual = f(20_000, "L4", "vendor", "price");
    raw.fields.sale_timing = f("Before year end", "L5", "vendor", "condition");
    expect(run({}, raw).verdict).toBe("Price");
    delete raw.fields.owner_pay_actual;
    expect(run({}, raw).verdict).toBe("Condition");
  });

  it("won't let a gate pass with its inputs unknown", () => {
    const raw = passingRaw();
    delete raw.fields.ledger_type;
    const sc = run({}, raw);
    expect(gate(sc, 6)).toMatchObject({ result: "unknown", claude_result: "pass", adjustments: ["inputs_unknown"] });
  });

  it("won't let threshold gates pass while the Playbook thresholds are unset", () => {
    const sc = run({ config: EMPTY_CONFIG });
    for (const id of [2, 3, 4, 5]) expect(gate(sc, id).result).toBe("unknown");
    expect(gate(sc, 1).result).toBe("pass");
    expect(sc.playbook_version).toBe(1);
  });

  it("fails gate 2 below recurring_gate even if Claude passed it", () => {
    const raw = passingRaw();
    raw.fields.rev_oneoff_gbp = f(1_500_000);
    const sc = run({}, raw);
    expect(gate(sc, 2)).toMatchObject({ result: "fail", adjustments: ["below_recurring_gate"] });
    expect(sc.verdict).toBe("Kill");
  });

  it("fails gate 3 on loss-making or out-of-band maintainable EBITDA", () => {
    const raw = passingRaw();
    raw.fields.maintainable_ebitda_gbp = f(-10_000, "L2", "estimated");
    expect(gate(run({}, raw), 3).adjustments).toEqual(["loss_making"]);
    raw.fields.maintainable_ebitda_gbp = f(90_000, "L2", "estimated");
    expect(gate(run({}, raw), 3).adjustments).toEqual(["below_ebitda_band"]);
  });

  it("fails gate 4 above the bands unless within the deal's institutional band", () => {
    const raw = passingRaw();
    raw.fields.largest_pct = f(35);
    expect(gate(run({}, raw), 4).result).toBe("fail");
    expect(gate(run({ institutionalBandPct: 40 }, raw), 4).result).toBe("pass");
  });

  it("prices founder dependency instead of killing where a manager is installable", () => {
    const raw = passingRaw();
    raw.gates[4] = { id: 5, result: "fail" };
    raw.fields.key_persons = f([{ name: "Owner", role: "MD", dependency: "All estimating" }], "L6");
    const sc = run({}, raw);
    expect(gate(sc, 5)).toMatchObject({ result: "pass", adjustments: ["founder_dependency_priced"] });
    expect(sc.fields.key_persons.box).toBe("price");
    expect(sc.verdict).toBe("Price");
  });

  it("kills on a confirmed gate 8 item even if Claude passed it", () => {
    const raw = passingRaw();
    raw.fields.hmrc_liability = f(true, "L8");
    const sc = run({}, raw);
    expect(gate(sc, 8).result).toBe("fail");
    expect(sc.verdict).toBe("Kill");
  });

  it("keeps loi_ready false until the DSCR sanction, and while debtors are missing", () => {
    expect(run().loi_ready).toBe(false);
    expect(run().loi_blockers).toEqual(["dscr_sanction_missing"]);
    expect(run({ dscrSanctioned: true }).loi_ready).toBe(true);
    const raw = passingRaw();
    delete raw.fields.debtors_aged;
    expect(run({ dscrSanctioned: true }, raw).loi_blockers).toEqual(["debtors_missing"]);
  });

  it("flags an earn-out ask", () => {
    const raw = passingRaw();
    raw.fields.earnout_ask = f(true, "L9");
    expect(run({}, raw).earnout_flag).toBe(true);
    expect(run().earnout_flag).toBe(false);
  });

  it("keeps figures and structure out of the broker email before the sanction", () => {
    const raw = passingRaw();
    delete raw.fields.b2b_share;
    raw.fields.sale_reason = { value: null, status: "unknown", source: null, box: "none", next_action: "Would the seller accept a 20% vendor loan note?" };
    raw.fields.sale_timing = { value: null, status: "unknown", source: null, box: "none", next_action: "Is £450k the asking price?" };
    const before = run({}, raw);
    expect(containsFiguresOrStructure(before.broker_email.subject + before.broker_email.body)).toBe(false);
    // The two above, plus the fallback earn-out question (structure).
    expect(before.broker_email).toMatchObject({ figures_allowed: false, withheld: 3 });
    expect(before.info_request.map((q) => q.field)).toEqual(expect.arrayContaining(["sale_reason", "sale_timing"]));

    const after = run({ dscrSanctioned: true }, raw);
    expect(after.broker_email).toMatchObject({ figures_allowed: true, withheld: 0 });
    expect(after.broker_email.body).toContain("£450k");
  });

  it("every fallback question except the earn-out ask is safe to send pre-sanction", () => {
    // Asking about an earn-out is itself structure, so it stays off the broker
    // email until the sanction and is raised on the second call instead.
    for (const d of POSTCALL_FIELDS) {
      expect(containsFiguresOrStructure(d.question), d.key).toBe(d.key === "earnout_ask");
    }
  });
});
