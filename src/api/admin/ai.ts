/** Admin client — AI: transcripts, pre/post-call briefs, OSINT, financial, jobs. */
import { api, type Paginated } from "../http";
import { type Row, resolveDealId } from "./_shared";

export async function analyzeTranscript(dealId: string, text: string, fileName?: string) {
  const id = await resolveDealId(dealId);
  const row = await api.post<Row>("/api/transcripts", {
    deal_id: id,
    transcript: text,
    name: fileName ?? `Transcript ${new Date().toISOString().slice(0, 10)}`,
    processing_status: "queued",
  });
  const job = await api.post<Row>("/api/ai/jobs", { type: "transcript-analysis", payload: { transcript_analysis_id: row.id } });
  return { success: true, jobId: job.job_id, transcriptId: row.id, recordId: row.id };
}

export async function fetchTranscriptAnalyses(dealId: string) {
  const id = await resolveDealId(dealId).catch(() => dealId);
  const page = await api.get<Paginated<Row>>(`/api/transcripts?deal_id=${encodeURIComponent(id)}`);
  // Content lives under `analysis` (jsonb); the tab reads flat fields and calls
  // .discussionPoints.map — provide safe defaults so it never crashes.
  return page.rows.map((r) => {
    const a = r.analysis ?? {};
    return {
      id: r.id,
      name: r.name ?? "",
      timestamp: r.processed_at ?? r.created_at ?? "",
      summary: a.summary ?? "",
      sentiment: a.sentiment ?? "Neutral",
      dealScore: typeof a.dealScore === "number" ? a.dealScore : 0,
      discussionPoints: Array.isArray(a.discussionPoints) ? a.discussionPoints : [],
      actionItems: Array.isArray(a.actionItems) ? a.actionItems : [],
      risks: Array.isArray(a.risks) ? a.risks : [],
      opportunities: Array.isArray(a.opportunities) ? a.opportunities : [],
      processing_status: r.processing_status ?? "",
    };
  });
}

/** Flatten a brief row: the page reads brief content as top-level fields, but
 *  the API stores the AI output under `brief_data`. Array fields are defaulted
 *  so the page's unguarded `.map` calls never crash on legacy/migrated shapes. */
function flattenBrief(r: Row): Row {
  const data = (r.brief_data && typeof r.brief_data === "object") ? r.brief_data : {};
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    ...data,
    criticalUnknowns: arr(data.criticalUnknowns),
    dealKillers: arr(data.dealKillers),
    teamDeploymentPlan: arr(data.teamDeploymentPlan),
    callPhaseOwnership: arr(data.callPhaseOwnership),
    participantQuestionBank: arr(data.participantQuestionBank),
    internalWatchouts: arr(data.internalWatchouts),
    recommendedNextActions: arr(data.recommendedNextActions),
    scores: (data.scores && typeof data.scores === "object") ? data.scores : {},
    id: r.id,
    deal_id: r.deal_id,
    name: r.name,
    created_at: r.created_at,
    processed_at: r.processed_at,
  };
}

export async function fetchPrecallBriefs(dealId: string) {
  const id = await resolveDealId(dealId).catch(() => dealId);
  const page = await api.get<Paginated<Row>>(`/api/briefs/precall?deal_id=${encodeURIComponent(id)}`);
  return page.rows.map(flattenBrief);
}

export async function generatePrecallBrief(data: { dealId: string; [k: string]: any }): Promise<Row> {
  const { dealId, ...params } = data;
  const id = await resolveDealId(dealId);
  const job = await api.post<Row>("/api/ai/jobs", { type: "precall-brief", payload: { deal_id: id, params } });
  return { success: true, status: "queued", id: job.job_id, jobId: job.job_id };
}

export async function askPrecallBriefQuestion(data: {
  dealId?: string;
  briefId?: string;
  question: string;
  brief?: Row;
  history?: Array<{ q: string; a: string }>;
}): Promise<Row> {
  let dealId = data.dealId;
  let brief = data.brief;
  // Legacy callers pass only briefId — resolve the deal (and brief) from it.
  if (!dealId && data.briefId) {
    const briefRow = await api.get<Row>(`/api/briefs/precall?limit=200`).then(
      (p: any) => (p.rows as Row[]).find((b) => b.id === data.briefId),
    );
    if (briefRow) {
      dealId = briefRow.deal_id ?? undefined;
      brief = brief ?? briefRow.brief_data ?? undefined;
    }
  }
  if (!dealId) throw new Error("Could not resolve the deal for this brief.");
  const id = await resolveDealId(dealId);
  const r = await api.post<{ answer: string }>("/api/ai/ask", {
    deal_id: id,
    question: data.question,
    brief,
    history: data.history ?? [],
  });
  return { answer: r.answer, aiAnswers: r.answer };
}

export async function fetchPostcallBriefs(dealId: string) {
  const id = await resolveDealId(dealId).catch(() => dealId);
  const page = await api.get<Paginated<Row>>(`/api/briefs/postcall?deal_id=${encodeURIComponent(id)}`);
  return page.rows.map(flattenBrief);
}

export async function generatePostcallBrief(data: { dealId: string; notes: string; schemaId?: string }): Promise<Row> {
  const id = await resolveDealId(data.dealId);
  const job = await api.post<Row>("/api/ai/jobs", {
    type: "postcall-brief",
    payload: { deal_id: id, notes: data.notes, schema_id: data.schemaId },
  });
  return { success: true, status: "queued", id: job.job_id, jobId: job.job_id };
}

export async function overridePostcallScores(data: {
  briefId: string;
  scores?: Row;
  overrides?: Row;
  summary?: string;
  dealId?: string;
}) {
  const scores = data.scores ?? data.overrides ?? {};
  const existing = await api.get<Row>(`/api/postcall-briefs/${encodeURIComponent(data.briefId)}`);
  const prev = existing.brief_data ?? {};
  const briefData = {
    ...prev,
    scores: { ...(prev.scores ?? {}), ...scores },
    ...(data.summary ? { summary: data.summary } : {}),
  };
  return api.patch<Row>(`/api/postcall-briefs/${encodeURIComponent(data.briefId)}`, { brief_data: briefData });
}

export async function triggerOsintEnrichment(dealId: string): Promise<{ success: boolean; message: string }> {
  const id = await resolveDealId(dealId);
  await api.post<Row>("/api/ai/jobs", { type: "osint-scan", payload: { deal_id: id } });
  return { success: true, message: "OSINT enrichment queued." };
}

export async function triggerFinancialAnalysis(_dealId: string, _documentId?: string): Promise<{ success: boolean; message: string }> {
  throw new Error("Financial analysis is being rebuilt on the new job system and is not available yet.");
}

// ─── Job status polling ─────────────────────────────────────────────────────

export interface JobStatusResponse {
  recordId: string;
  table: string;
  status: "queued" | "processing" | "extracted" | "analyzing" | "completed" | "failed" | "unknown";
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  hasContent: boolean;
  isComplete: boolean;
  isFailed: boolean;
  isProcessing: boolean;
}

/**
 * Legacy-compatible job polling. `recordId` is now a JOB ID from the new job
 * system (returned by analyze/generate calls); `table`/`jobType` are ignored.
 */
export async function getJobStatus(_table: string, recordId: string, _jobType?: string): Promise<JobStatusResponse> {
  const job = await api.get<Row>(`/api/jobs/status?id=${encodeURIComponent(recordId)}`);
  const status =
    job.status === "done" ? "completed"
    : job.status === "failed" ? "failed"
    : job.status === "running" ? "processing"
    : "queued";
  return {
    recordId,
    table: _table,
    status,
    error: job.error ?? null,
    startedAt: job.created_at ?? null,
    completedAt: job.finished_at ?? null,
    hasContent: job.status === "done",
    isComplete: job.status === "done",
    isFailed: job.status === "failed",
    isProcessing: job.status === "running" || job.status === "queued",
  };
}
