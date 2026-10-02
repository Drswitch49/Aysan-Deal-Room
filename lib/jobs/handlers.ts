/**
 * Job handler registry — importing this module registers all job handlers.
 * The worker endpoint imports it once; enqueue sites only need queue.ts.
 *
 * AI handlers run the typed tasks in lib/ai/tasks.ts (same Claude prompts and
 * models as the legacy Inngest/QStash workflows) and persist results to
 * Supabase. If ANTHROPIC_API_KEY is absent the handler throws AiUnavailableError
 * and the job fails visibly rather than hanging silently.
 */
import { enqueue, registerHandler } from "./queue.js";
import { generateBrief, generateP089 } from "../intelligence/generate.js";
import { BRIEF_KEYS, P089_KEYS, SUMMARY_KEYS, type SectionKey } from "../../src/lib/acp/intelligence.js";
import { adminClient } from "../data/supabase/client.js";
import {
  analyzeTranscript,
  generateInvestmentVerdict,
  generatePrecallBrief,
  extractPostcallScorecard,
  extractWbsFields,
  generatePortfolioBriefing,
} from "../ai/tasks.js";
import { buildScorecard } from "../postcall/scorecard.js";
import { buildWbsScorecard } from "../postcall/wbs.js";
import { RUN_TYPES, WBS_V2_PROPOSED, laneFromDeal, type Lane, type RunType, type WbsThresholds, type WbsWeights } from "../../src/lib/acp/wbsSpec.js";

const db = () => adminClient();

// Diagnostic handler (used by the E2E queue test).
registerHandler("noop", async (payload) => ({ echoed: payload, at: new Date().toISOString() }));

/** payload: { transcript_analysis_id } — analyze the stored transcript. */
registerHandler("transcript-analysis", async (payload: any) => {
  const id = payload?.transcript_analysis_id;
  if (!id) throw new Error("transcript_analysis_id required");
  const { data: row, error } = await db().from("transcript_analyses").select("id, transcript").eq("id", id).single();
  if (error || !row) throw new Error(`transcript_analyses ${id} not found`);
  if (!row.transcript) throw new Error("Transcript is empty");

  await db().from("transcript_analyses").update({ processing_status: "processing", processing_started_at: new Date().toISOString() }).eq("id", id);
  try {
    const analysis = await analyzeTranscript(row.transcript);
    await db().from("transcript_analyses").update({
      analysis,
      processing_status: "completed",
      processing_error: null,
      processed_at: new Date().toISOString(),
    }).eq("id", id);
    return { dealScore: analysis.dealScore, sentiment: analysis.sentiment };
  } catch (err) {
    await db().from("transcript_analyses").update({
      processing_status: "failed",
      processing_error: err instanceof Error ? err.message : String(err),
    }).eq("id", id);
    throw err;
  }
});

/** payload: { deal_id } — generate + store the investment verdict on the deal. */
registerHandler("investment-verdict", async (payload: any) => {
  const dealId = payload?.deal_id;
  if (!dealId) throw new Error("deal_id required");
  const { data: deal, error } = await db().from("deals").select("*").eq("id", dealId).single();
  if (error || !deal) throw new Error(`deal ${dealId} not found`);

  const verdict = await generateInvestmentVerdict({
    companyName: deal.company_name,
    dealRef: deal.ref_no ?? deal.acp_ref_no ?? deal.deal_name,
    sector: deal.sector ?? deal.industry,
    location: deal.location,
    revenue: deal.turnover,
    ebitda: deal.ebitda_gbp,
    askingPrice: deal.asking_price_gbp,
    enterpriseValue: deal.enterprise_value,
    executiveSummary: deal.executive_summary,
    businessDescription: deal.business_description,
    internalNotes: deal.internal_notes,
    hasImAttached: Boolean(deal.deal_files_secure_url || deal.deal_files_url),
  });

  await db().from("deals").update({ claude_verdict: JSON.stringify(verdict, null, 2) }).eq("id", dealId);
  return verdict;
});

/** payload: { deal_id, params } — generate + store a pre-call brief. */
registerHandler("precall-brief", async (payload: any) => {
  const { deal_id, params } = payload ?? {};
  if (!deal_id) throw new Error("deal_id required");
  const { data: deal, error } = await db().from("deals").select("*").eq("id", deal_id).single();
  if (error || !deal) throw new Error(`deal ${deal_id} not found`);

  const briefParams = params ?? {
    selectedCallType: "1st",
    selectedPersonas: [],
    selectedScenario: "",
    dataSources: [],
  };

  const brief = await generatePrecallBrief(
    {
      // The id is what lets the brief pull the deal's own Supabase context
      // (documents, notes) rather than working from these six fields alone.
      id: deal.id,
      companyName: deal.company_name,
      dealRef: deal.ref_no ?? deal.acp_ref_no,
      sector: deal.sector ?? deal.industry,
      location: deal.location,
      evAsk: deal.enterprise_value ?? deal.asking_price_gbp,
      revenue: deal.turnover,
      ebitda: deal.ebitda_gbp,
    },
    briefParams,
  );

  const { data: created, error: insErr } = await db().from("precall_briefs").insert({
    deal_id,
    name: `Pre-call brief — ${deal.company_name ?? deal.deal_name ?? deal_id}`,
    // The request parameters are stored with the output: the tab's parameters
    // panel reads selectedPersonas/selectedScenario/selectedCallType/dataSources
    // off the brief, and storing only the model's JSON left every one of them
    // undefined — so every brief displayed as a participant-less "Negotiation".
    brief_data: {
      ...brief,
      selectedCallType: briefParams.selectedCallType,
      selectedPersonas: briefParams.selectedPersonas,
      selectedScenario: briefParams.selectedScenario,
      dataSources: briefParams.dataSources,
    },
    processing_status: "completed",
    processed_at: new Date().toISOString(),
  }).select("id").single();
  if (insErr) throw new Error(`store precall brief: ${insErr.message}`);
  return { brief_id: created.id };
});

/**
 * payload: { deal_id, input_text, input_kind, precall_brief_id? } — score one
 * call against the post-call scorecard spec and store it as a NEW run.
 *
 * Runs are never overwritten: each transcript or note inserts a row stamped
 * with the Playbook config version it was scored against (migration 0018).
 */
registerHandler("postcall-brief", async (payload: any) => {
  const deal_id = payload?.deal_id;
  // `notes` is the pre-spec payload key; accept it so already-queued jobs still run.
  const inputText: string = payload?.input_text ?? payload?.notes ?? "";
  const inputKind: "transcript" | "notes" = payload?.input_kind === "transcript" ? "transcript" : "notes";
  if (!deal_id || !inputText.trim()) throw new Error("deal_id and input_text required");

  const { data: deal, error } = await db().from("deals").select("*").eq("id", deal_id).single();
  if (error || !deal) throw new Error(`deal ${deal_id} not found`);

  // Lane is set on the deal and inherited by the run (Optimisation Brief 1.1).
  const lane: Lane = laneFromDeal(deal.lane);
  const runType: RunType = (RUN_TYPES as readonly string[]).includes(payload?.run_type) ? payload.run_type : "post_call";

  // Each lane scores against its own newest config. (Before 0025 there was one
  // config table for one lane; scoping by lane keeps Lane 1 on Lane 1 values.)
  const { data: config, error: cfgErr } = await db()
    .from("playbook_config").select("*").eq("lane", lane).order("version", { ascending: false }).limit(1).maybeSingle();
  if (cfgErr) throw new Error(`load playbook config: ${cfgErr.message}`);
  if (!config) throw new Error(`No Playbook config version exists for ${lane} — apply migrations 0018 and 0025.`);

  // The pre-call brief the caller chose, else the deal's latest.
  let briefQuery = db().from("precall_briefs").select("id, brief_data").eq("deal_id", deal_id).is("deleted_at", null);
  briefQuery = payload?.precall_brief_id
    ? briefQuery.eq("id", payload.precall_brief_id)
    : briefQuery.order("created_at", { ascending: false }).limit(1);
  const { data: briefs } = await briefQuery;
  const brief = briefs?.[0] ?? null;

  const companyName = deal.company_name || deal.deal_name || deal_id;
  const institutionalBandPct = deal.institutional_band_pct == null ? null : Number(deal.institutional_band_pct);
  const runName = `Post-call scorecard — ${companyName} — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;

  if (lane === "lane_2_wbs") {
    const thresholds = (config.thresholds ?? WBS_V2_PROPOSED.thresholds) as WbsThresholds;
    const raw = await extractWbsFields({
      deal: { id: deal_id, companyName, subsector: deal.wbs_subsector, location: deal.location },
      runType,
      inputKind,
      inputText,
      precallBrief: brief?.brief_data ?? null,
      h3Conditions: thresholds.h3_conditions ?? [],
    });
    const scorecard = buildWbsScorecard({
      dealId: deal_id,
      dealName: companyName,
      brokerRef: deal.ref_no ?? null,
      recipientName: deal.broker || null,
      subsector: deal.wbs_subsector ?? null,
      runType,
      raw,
      config: {
        version: config.version,
        thresholds,
        weights: (config.weights ?? WBS_V2_PROPOSED.weights) as WbsWeights,
        signed_by: config.signed_by ?? null,
        signed_at: config.signed_at ?? null,
      },
      inputKind,
      inputText,
      precallBriefId: brief?.id ?? null,
      dscrSanctioned: Boolean(deal.dscr_sanctioned_at),
      dealColumns: { distance_rm11_miles: deal.distance_rm11_miles, indicative_dscr: deal.indicative_dscr },
    });
    const { data: created, error: insErr } = await db().from("postcall_briefs").insert({
      deal_id,
      name: runName,
      brief_data: scorecard,
      playbook_version: config.version,
      input_kind: inputKind,
      input_text: inputText,
      precall_brief_id: brief?.id ?? null,
      lane,
      run_type: runType,
      dimensions: scorecard.dimensions,
      total_score: scorecard.total_score,
      confidence_pct: scorecard.confidence_pct,
      verdict: scorecard.verdict,
      processing_status: "completed",
      processed_at: new Date().toISOString(),
    }).select("id").single();
    if (insErr) throw new Error(`store postcall run: ${insErr.message}`);
    return { brief_id: created.id, lane, verdict: scorecard.verdict, score: scorecard.total_score, completeness: scorecard.completeness.pct };
  }

  const raw = await extractPostcallScorecard({
    deal: { id: deal_id, companyName, sector: deal.sector ?? deal.industry, location: deal.location },
    inputKind,
    inputText,
    precallBrief: brief?.brief_data ?? null,
    config,
    institutionalBandPct,
  });

  const scorecard = buildScorecard({
    dealId: deal_id,
    companyName,
    recipientName: deal.broker,
    raw,
    config,
    institutionalBandPct,
    inputKind,
    inputText,
    precallBriefId: brief?.id ?? null,
    dscrSanctioned: Boolean(deal.dscr_sanctioned_at),
    brokerRef: deal.ref_no ?? null,
  });

  const { data: created, error: insErr } = await db().from("postcall_briefs").insert({
    deal_id,
    name: runName,
    brief_data: scorecard,
    playbook_version: config.version,
    input_kind: inputKind,
    input_text: inputText,
    precall_brief_id: brief?.id ?? null,
    lane,
    run_type: runType,
    verdict: scorecard.verdict,
    processing_status: "completed",
    processed_at: new Date().toISOString(),
  }).select("id").single();
  if (insErr) throw new Error(`store postcall run: ${insErr.message}`);
  return { brief_id: created.id, verdict: scorecard.verdict, completeness: scorecard.completeness.pct };
});

/**
 * Deal Intelligence tab, stage A: sections 2-10, then BLUF and Actions.
 * payload: { intelligence_run_id, only?: SectionKey[], p089?: P089Options }
 * Stage B (P-089) runs as its own job so neither stage nears the worker's
 * time limit; a section-level regenerate only runs the stage it belongs to.
 */
registerHandler("intelligence-run", async (payload: any) => {
  const id = payload?.intelligence_run_id;
  if (!id) throw new Error("intelligence_run_id required");
  const only: SectionKey[] | undefined = Array.isArray(payload.only) ? payload.only : undefined;
  const needsA = !only || only.some((k) => BRIEF_KEYS.includes(k) || SUMMARY_KEYS.includes(k));
  const needsB = !only || only.some((k) => P089_KEYS.includes(k));

  await db().from("intelligence_runs").update({ status: "running", error: null }).eq("id", id);
  try {
    if (needsA) await generateBrief(id, only);
    if (needsB) {
      await enqueue("negotiation-run", { intelligence_run_id: id, p089: payload.p089 ?? {} });
    } else {
      await db().from("intelligence_runs").update({ status: "done", generated_at: new Date().toISOString() }).eq("id", id);
    }
    return { intelligence_run_id: id, stage: "brief", next: needsB ? "negotiation-run" : null };
  } catch (err) {
    await db().from("intelligence_runs").update({ status: "failed", error: err instanceof Error ? err.message : String(err) }).eq("id", id);
    throw err;
  }
});

/** Deal Intelligence tab, stage B: P-089 sections 12-19. payload: { intelligence_run_id, p089 } */
registerHandler("negotiation-run", async (payload: any) => {
  const id = payload?.intelligence_run_id;
  if (!id) throw new Error("intelligence_run_id required");
  await db().from("intelligence_runs").update({ status: "running", error: null }).eq("id", id);
  try {
    await generateP089(id, payload.p089 ?? {});
    return { intelligence_run_id: id, stage: "p089" };
  } catch (err) {
    await db().from("intelligence_runs").update({ status: "failed", error: err instanceof Error ? err.message : String(err) }).eq("id", id);
    throw err;
  }
});

/** payload: {} — portfolio intelligence briefing across all companies. */
registerHandler("portfolio-briefing", async () => {
  const [metrics, healths, alerts] = await Promise.all([
    db().from("portfolio_metrics").select("*"),
    db().from("portfolio_health").select("*"),
    db().from("portfolio_alerts").select("*").is("resolved_at", null),
  ]);
  const briefing = await generatePortfolioBriefing(
    (metrics.data ?? []).map((m) => ({ companyName: m.company_name, reportingPeriod: m.reporting_period, revenue: m.revenue ?? 0, ebitda: m.ebitda ?? 0, dscr: m.dscr, leverage: m.leverage, headcount: m.headcount })),
    (healths.data ?? []).map((h) => ({ companyName: h.company_name, portfolioScore: h.portfolio_score, riskLevel: h.risk_level, trendSummary: h.trend_summary })),
    (alerts.data ?? []).map((a) => ({ companyName: a.company_name, severity: a.severity ?? "info", explanation: a.explanation })),
  );
  return { briefing };
});

/** payload: { deal_id } — OSINT enrichment (Companies House, news, website + synthesis). */
registerHandler("osint-scan", async (payload: any) => {
  const dealId = payload?.deal_id;
  if (!dealId) throw new Error("deal_id required");
  const { data: deal, error } = await db().from("deals").select("id, company_name, deal_name, website").eq("id", dealId).single();
  if (error || !deal) throw new Error(`deal ${dealId} not found`);
  const companyName = deal.company_name ?? deal.deal_name;
  if (!companyName) throw new Error("Deal has no company name to scan");

  await db().from("deals").update({ osint_status: "running" }).eq("id", dealId);
  try {
    const { runOsintScan } = await import("../osint/scan.js");
    // The deal id is a source, not just a key: the scan pulls the deal row,
    // document summaries and team notes back out of Supabase as context.
    const result = await runOsintScan(companyName, deal.website, dealId);
    await db().from("deals").update({
      osint: result,
      osint_status: "completed",
      osint_summary: result.synthesis.synthesis,
      osint_completed_at: new Date().toISOString(),
    }).eq("id", dealId);
    return { keyInsights: result.synthesis.keyInsights.length, riskFlags: result.synthesis.riskFlags.length };
  } catch (err) {
    await db().from("deals").update({ osint_status: "failed" }).eq("id", dealId);
    throw err;
  }
});

/** payload: { document_id } — extract text from the stored file + AI analysis. */
registerHandler("document-analysis", async (payload: any) => {
  const docId = payload?.document_id;
  if (!docId) throw new Error("document_id required");
  const { data: doc, error } = await db().from("documents").select("id, document_name, cloudinary_public_id, file_url, legacy_drive_link").eq("id", docId).single();
  if (error || !doc) throw new Error(`document ${docId} not found`);

  // Cloudinary assets are `authenticated` — use API-key-signed download URLs
  // (delivery URLs 401 for PDFs unless the account security toggle is enabled).
  const candidates: string[] = [];
  if (doc.cloudinary_public_id) {
    const { downloadUrl } = await import("../core/cloudinary.js");
    candidates.push(
      downloadUrl(doc.cloudinary_public_id, { resourceType: "image" }),
      downloadUrl(doc.cloudinary_public_id, { resourceType: "raw" }),
    );
  }
  if (doc.legacy_drive_link) candidates.push(doc.legacy_drive_link);
  if (!candidates.length && doc.file_url) candidates.push(doc.file_url);
  if (!candidates.length) throw new Error("Document has no file URL");

  await db().from("documents").update({ processing_status: "processing", processing_started_at: new Date().toISOString(), processing_error: null }).eq("id", docId);
  try {
    const { extractTextFromUrl, analyzeDocumentText } = await import("../documents/extract.js");
    let text = "";
    let lastErr: unknown = null;
    for (const url of candidates) {
      try {
        text = await extractTextFromUrl(url, doc.document_name);
        if (text.trim()) break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!text.trim() && lastErr) throw lastErr;
    if (!text.trim()) throw new Error("No text could be extracted from the document");
    const analysis = await analyzeDocumentText(text);
    await db().from("documents").update({
      extracted_text: text.slice(0, 100_000),
      summary: analysis.summary,
      risks: analysis.risks.join("\n"),
      covenants: analysis.covenants.join("\n"),
      metrics: JSON.stringify(analysis.metrics),
      processing_status: "completed",
      processed_at: new Date().toISOString(),
    }).eq("id", docId);
    return { chars: text.length, risks: analysis.risks.length };
  } catch (err) {
    await db().from("documents").update({
      processing_status: "failed",
      processing_error: err instanceof Error ? err.message : String(err),
    }).eq("id", docId);
    throw err;
  }
});
