/**
 * Job handler registry — importing this module registers all job handlers.
 * The worker endpoint imports it once; enqueue sites only need queue.ts.
 *
 * AI handlers run the typed tasks in lib/ai/tasks.ts (same Claude prompts and
 * models as the legacy Inngest/QStash workflows) and persist results to
 * Supabase. If ANTHROPIC_API_KEY is absent the handler throws AiUnavailableError
 * and the job fails visibly rather than hanging silently.
 */
import { registerHandler } from "./queue.js";
import { adminClient } from "../data/supabase/client.js";
import {
  analyzeTranscript,
  generateInvestmentVerdict,
  generatePrecallBrief,
  generatePostcallBrief,
  generatePortfolioBriefing,
} from "../ai/tasks.js";

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

  const brief = await generatePrecallBrief(
    {
      companyName: deal.company_name,
      dealRef: deal.ref_no ?? deal.acp_ref_no,
      sector: deal.sector ?? deal.industry,
      location: deal.location,
      evAsk: deal.enterprise_value ?? deal.asking_price_gbp,
      revenue: deal.turnover,
      ebitda: deal.ebitda_gbp,
    },
    params ?? { selectedCallType: "1st", selectedPersonas: [], selectedScenario: "", dataSources: [] },
  );

  const { data: created, error: insErr } = await db().from("precall_briefs").insert({
    deal_id,
    name: `Pre-call brief — ${deal.company_name ?? deal.deal_name ?? deal_id}`,
    brief_data: brief,
    processing_status: "completed",
    processed_at: new Date().toISOString(),
  }).select("id").single();
  if (insErr) throw new Error(`store precall brief: ${insErr.message}`);
  return { brief_id: created.id };
});

/** payload: { deal_id, notes, schema_id } — generate + store a post-call brief. */
registerHandler("postcall-brief", async (payload: any) => {
  const { deal_id, notes, schema_id } = payload ?? {};
  if (!deal_id || !notes) throw new Error("deal_id and notes required");
  const { data: deal, error } = await db().from("deals").select("*").eq("id", deal_id).single();
  if (error || !deal) throw new Error(`deal ${deal_id} not found`);

  const brief = await generatePostcallBrief(
    {
      companyName: deal.company_name,
      dealRef: deal.ref_no ?? deal.acp_ref_no,
      sector: deal.sector ?? deal.industry,
      location: deal.location,
      evAsk: deal.enterprise_value ?? deal.asking_price_gbp,
      revenue: deal.turnover,
      ebitda: deal.ebitda_gbp,
    },
    notes,
    schema_id ?? "ACP_DEAL_ROOM",
  );

  const { data: created, error: insErr } = await db().from("postcall_briefs").insert({
    deal_id,
    name: `Post-call brief — ${deal.company_name ?? deal.deal_name ?? deal_id}`,
    brief_data: brief,
    processing_status: "completed",
    processed_at: new Date().toISOString(),
  }).select("id").single();
  if (insErr) throw new Error(`store postcall brief: ${insErr.message}`);
  return { brief_id: created.id };
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

// Phase 5c wire-ups (document parsing + OSINT) land here:
// registerHandler("document-analysis", documentAnalysisHandler);
// registerHandler("osint-scan", osintScanHandler);
