/**
 * P-089 engine against the Optimisation Brief v1.1 acceptance tests T9-T13,
 * using the 5c golden output (ACP-033 Inspired Health, exchange 1) as the
 * tagged draft.
 */
import { describe, expect, it } from "vitest";
import { deriveOutputs, lintDraft, mapBlocks, selectTechniques, type EngineContext, type TaggedDraft } from "./engine";
import type { Diagnosis } from "../../src/lib/acp/negotiation";

const diag: Diagnosis = {
  move_primary: "pre_negotiation",
  move_secondary: null,
  temperature: "low",
  stated_position: "Price via Knightsbridge; we've had offers; move quickly",
  underlying_interest: "Ethical buyer; team and patients protected; licence continuity; fast clean exit",
  concessions: ["Open call", "disclosed YE26 dip", "disclosed the training licence", "shorter handover", "lease available"],
  anchors: [{ figure: "£265k adjusted EBITDA", tag: "VENDOR", source: "IM p.15" }],
  contradictions: ["IM unrelated ventures vs coaching firm holding the IP", "£265k vs YE26 ~£190k"],
  decision_unit: ["Alexandra", "Nicolas", "Kimberley Aspin (KBS)"],
  batna_theirs: "Other offers, keep trading",
  batna_acp_internal: "Other WBS pipeline",
  milestone_available: true,
  interests_map: [],
};

const ctx: EngineContext & { quoteCounterpartyFigures: boolean; mpRelease: boolean } = {
  channel: "email",
  dscrSanctioned: false,
  counterpartyRole: "broker",
  preNegotiation: true,
  learning: {},
  hardened: [],
  quoteCounterpartyFigures: true,
  mpRelease: false,
};

const golden = (): TaggedDraft => ({
  subject: "172105 Inspired Health: information request following our call with Alexandra and Nicolas",
  greeting: "Dear Kimberley,",
  blocks: [
    { block: 1, text: "[[T01,T05]]Thank you for arranging Friday's call. Please pass on our thanks to Alexandra and Nicolas. They were generous with their time, and open about the business, including this year's numbers and the training licence.[[/T01,T05]]" },
    { block: 2, text: "[[T02]]You may be reading a long information request as a buyer slowing things down, or preparing to discount. It is neither.[[/T02]] We would rather put forward a proposal once, on numbers that will survive diligence, than revise it later." },
    { block: 3, text: "[[T06]]We share three things with Alexandra and Nicolas.[[/T06]] The team stays together. Patients continue to receive the care they chose. The systems behind the clinic stay in place after completion." },
    { block: 4, text: "To prepare a proposal, we need to reconcile three figures:\n[[T07,T12]]| Adjusted EBITDA YE25 c.£265k | IM p.15 |\n| Profit reduction in YE26 | IM p.15 note |\n| YE26 adjusted EBITDA c.£190k | Seller call |[[/T07,T12]]\n[[T03]]It sounds like YE25 was a strong year and YE26 a rebuilding one.[[/T03]]" },
    { block: 5, text: "We cannot put forward a figure on YE25 alone. A proposal built on one year would not hold through diligence, and [[T17]]that risk falls on the sellers as much as on us.[[/T17]]" },
    { block: 6, text: "[[T09]]Two ways forward, both work for us: (1) send the priority items in Schedule A now and YE26 when final; (2) send everything together once YE26 is final.[[/T09]]" },
    { block: 7, text: "The training licence matters to us. Once we have seen its terms, we would like to [[T13]]reflect its long-term continuity in how we structure the proposal.[[/T13]]" },
    { block: 8, text: "[[T10]]Two questions, through you: What would they need to see from a buyer to feel the team, the patients and the licence are protected for the long term? How are you planning the timetable once YE26 is final?[[/T10]]" },
    { block: 9, text: "[[T11,T08]]We would welcome a second call once we have the priority items, so we can move quickly for them: [ACP calendar link][[/T11,T08]]" },
  ],
  sign_off: "Kind regards, Ayo Oyesanya, Managing Partner, Aysan Capital Partners",
  schedule: ["company number and 3 filed accounts", "add-back bridge", "directors' total pay", "licence agreement"],
});

function plan() {
  const sel = selectTechniques(diag, ctx);
  return { ...mapBlocks(sel.selected, diag, sel.dropped.map((d) => d.code)), sel };
}

describe("P-089 engine — Optimisation Brief v1.1 acceptance", () => {
  it("T11: ACP-033 pre-negotiation technique selection", () => {
    const { techniques, sel } = plan();
    const selected = techniques.filter((t) => !t.block_default).map((t) => t.code);
    const all = techniques.map((t) => t.code);
    expect(selected).toEqual(expect.arrayContaining(["T01", "T03", "T05", "T07", "T10", "T12"]));
    expect(all).toEqual(expect.arrayContaining(["T02", "T06", "T08", "T09", "T11", "T13", "T17"]));
    expect(all).not.toContain("T04");
    expect(all).not.toContain("T20");
    expect(all).not.toContain("T14");
    expect(sel.internal).toEqual(["T14"]);
    // 5 to 8 selected; block defaults don't count toward the cap.
    expect(selected.length).toBeGreaterThanOrEqual(5);
    expect(selected.length).toBeLessThanOrEqual(8);
    expect(techniques[0].code).toBe("T05"); // concessions put T05 at the top
  });

  it("block 7 is omitted when no milestone exists", () => {
    const sel = selectTechniques({ ...diag, milestone_available: false }, ctx);
    const { plan: p } = mapBlocks(sel.selected, { ...diag, milestone_available: false }, []);
    expect(p[7]).toEqual([]);
  });

  it("temperature high forces T02, T03, T01 first and drops T17, T13, T20", () => {
    const sel = selectTechniques({ ...diag, temperature: "high" }, ctx);
    expect(sel.selected.slice(0, 4).map((s) => s.code)).toEqual(expect.arrayContaining(["T02", "T03", "T01"]));
    const { techniques } = mapBlocks(sel.selected, diag, sel.dropped.map((d) => d.code));
    expect(techniques.map((t) => t.code)).not.toEqual(expect.arrayContaining(["T17"]));
  });

  it("T9: the golden draft passes every gate check, technique lint and style lint", () => {
    const { techniques } = plan();
    const res = lintDraft(golden(), techniques, diag, ctx);
    const fails = [...res.technique_lint, ...res.gate_check, ...res.style].filter((r) => r.result === "FAIL");
    expect(fails).toEqual([]);
    expect(res.send_enabled).toBe(true);
    expect(res.gate_check).toHaveLength(7);
  });

  it("T10: an ACP EV injected into the draft fails the gate check and disables send", () => {
    const d = golden();
    d.blocks[5].text += " For reference, our EV for the business is £600k.";
    const res = lintDraft(d, plan().techniques, diag, ctx);
    expect(res.gate_check.find((r) => r.rule === "figures_released")!.result).toBe("FAIL");
    expect(res.send_enabled).toBe(false);
  });

  it("T12: a Why question and three options fail T10 and T09 lint and disable send", () => {
    const d = golden();
    d.blocks[5].text = "[[T09]]Three ways forward: (1) send now; (2) send with YE26; (3) send nothing.[[/T09]]";
    d.blocks[7].text = "[[T10]]Why has YE26 dropped? How are you planning the timetable?[[/T10]]";
    const res = lintDraft(d, plan().techniques, diag, ctx);
    expect(res.technique_lint.find((r) => r.rule === "T10")!.result).toBe("FAIL");
    expect(res.technique_lint.find((r) => r.rule === "T09")!.result).toBe("FAIL");
    expect(res.send_enabled).toBe(false);
  });

  it("T13: technique map rows match the draft spans exactly", () => {
    const { text, map } = deriveOutputs(golden());
    expect(text).not.toMatch(/\[\[/);
    for (const row of map) {
      const slice = text.slice(row.start, row.end);
      expect(row.line.replace(/^"|"$|…"$/g, "").replace(/…$/, "")).toBe(slice.trim().slice(0, row.line.length - 2 - (row.line.endsWith("…\"") ? 1 : 0)).trim());
    }
    expect(map.map((r) => r.codes.join(","))).toEqual(["T01,T05", "T02", "T06", "T07,T12", "T03", "T17", "T09", "T13", "T10", "T11,T08"]);
  });

  it("style lint replaces a dash used as a pause and blocks banned words", () => {
    const d = golden();
    d.blocks[2].text = "We share three things — and none is about an exit.";
    const res = lintDraft(d, plan().techniques, diag, ctx);
    expect(res.draft.blocks[2].text).toContain("things: and");
    expect(res.style.find((r) => r.rule === "banned_words")!.result).toBe("FAIL");
  });

  it("earn-out language and VLN/deferred conflation fail the gate check", () => {
    const d = golden();
    d.blocks[6].text = "We could look at an earn-out, paid as a VLN or deferred consideration.";
    const rows = lintDraft(d, plan().techniques, diag, ctx).gate_check;
    expect(rows.find((r) => r.rule === "no_earnout")!.result).toBe("FAIL");
    expect(rows.find((r) => r.rule === "vln_not_conflated")!.result).toBe("FAIL");
  });
});
