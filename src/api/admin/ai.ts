/** Admin client — AI: transcripts, pre/post-call briefs, OSINT, financial, jobs. */
import { api, type Paginated } from "../http";
import { type Row, resolveDealId } from "./_shared";
import type { PlaybookConfig, Scorecard } from "../../lib/acp/postcallSpec";

/**
 * Start the queued job now instead of waiting for the cron tick.
 *
 * Enqueueing alone left every AI job sitting in `queued` — the Vercel cron that
 * drains the queue was rejected for want of a CRON_SECRET, so nothing ever ran.
 * The worker also accepts an admin session, so the app kicks it directly. Fire
 * and forget: the drain outlives this request, and the UI already polls the job
 * for its result.
 */
export function kickWorker(): void {
  api.post("/api/jobs/worker", {}).catch(() => {
    /* cron remains the backstop — a failed kick must not fail the enqueue */
  });
}

/** Enqueue an AI job and immediately start draining the queue. Every enqueue
 *  site must go through this — an enqueue without a kick just waits for cron. */
export async function enqueueAiJob(type: string, payload: Row): Promise<Row> {
  const job = await api.post<Row>("/api/ai/jobs", { type, payload });
  kickWorker();
  return job;
}

export async function analyzeTranscript(dealId: string, text: string, fileName?: string) {
  const id = await resolveDealId(dealId);
  const row = await api.post<Row>("/api/transcripts", {
    deal_id: id,
    transcript: text,
    name: fileName ?? `Transcript ${new Date().toISOString().slice(0, 10)}`,
    processing_status: "queued",
  });
  const job = await enqueueAiJob("transcript-analysis", { transcript_analysis_id: row.id });
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
    sourceReport: arr(data.sourceReport),
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
  const job = await enqueueAiJob("precall-brief", { deal_id: id, params });
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

/** One post-call run. `scorecard` is null for legacy pre-spec briefs. */
export interface PostcallRun {
  id: string;
  name: string;
  created_at: string;
  playbook_version: number | null;
  input_kind: "transcript" | "notes" | null;
  input_text: string | null;
  scorecard: Scorecard | null;
  /** Legacy (pre-spec) brief content, shown read-only. */
  legacy: { summary?: string; followUpEmail?: string } | null;
}

export async function fetchPostcallRuns(dealId: string): Promise<PostcallRun[]> {
  const id = await resolveDealId(dealId).catch(() => dealId);
  const page = await api.get<Paginated<Row>>(`/api/briefs/postcall?deal_id=${encodeURIComponent(id)}&limit=100`);
  return page.rows.map((r) => {
    const data = r.brief_data && typeof r.brief_data === "object" ? r.brief_data : {};
    const isSpec = data.spec === "acp-postcall-v1";
    return {
      id: r.id,
      name: r.name ?? "",
      created_at: r.created_at ?? "",
      playbook_version: r.playbook_version ?? null,
      input_kind: r.input_kind ?? null,
      input_text: r.input_text ?? null,
      scorecard: isSpec ? (data as Scorecard) : null,
      legacy: isSpec ? null : { summary: data.summary, followUpEmail: data.followUpEmail },
    };
  });
}

/** Queue a new run. Each transcript or note creates a new run; none is overwritten. */
export async function runPostcallScorecard(data: {
  dealId: string;
  inputText: string;
  inputKind: "transcript" | "notes";
  precallBriefId?: string | null;
}): Promise<{ jobId: string }> {
  const id = await resolveDealId(data.dealId);
  const job = await enqueueAiJob("postcall-brief", {
    deal_id: id,
    input_text: data.inputText,
    input_kind: data.inputKind,
    ...(data.precallBriefId ? { precall_brief_id: data.precallBriefId } : {}),
  });
  return { jobId: job.job_id };
}

export function fetchPlaybookVersions(): Promise<PlaybookConfig[]> {
  return api.get<PlaybookConfig[]>("/api/playbook-config");
}

export function createPlaybookVersion(values: Omit<PlaybookConfig, "version" | "created_by" | "created_at">): Promise<PlaybookConfig> {
  return api.post<PlaybookConfig>("/api/playbook-config", values);
}

export interface PostcallControls {
  deal_id: string;
  institutional_band_pct: number | null;
  dscr_sanctioned_at: string | null;
  dscr_sanctioned_by: string | null;
  dscr_sanction_note: string | null;
}

export async function fetchPostcallControls(dealId: string): Promise<PostcallControls> {
  const id = await resolveDealId(dealId).catch(() => dealId);
  return api.get<PostcallControls>(`/api/postcall-controls?deal_id=${encodeURIComponent(id)}`);
}

export async function updatePostcallControls(
  dealId: string,
  patch: { institutional_band_pct?: number | null; dscr_sanctioned?: boolean; dscr_sanction_note?: string | null },
): Promise<PostcallControls> {
  const id = await resolveDealId(dealId);
  return api.patch<PostcallControls>("/api/postcall-controls", { deal_id: id, ...patch });
}

export async function triggerOsintEnrichment(dealId: string): Promise<{ success: boolean; message: string }> {
  const id = await resolveDealId(dealId);
  await enqueueAiJob("osint-scan", { deal_id: id });
  return { success: true, message: "OSINT enrichment started." };
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
  /** Attempts consumed so far, and the ceiling. A queued job with attempts > 0
   *  has already failed at least once and is waiting out its retry backoff. */
  attempts: number;
  maxAttempts: number;
  /** When a retrying job is next eligible to run. */
  retryAt: string | null;
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
    attempts: typeof job.attempts === "number" ? job.attempts : 0,
    maxAttempts: typeof job.max_attempts === "number" ? job.max_attempts : 3,
    retryAt: job.run_after ?? null,
  };
}

// ─── Job watching ───────────────────────────────────────────────────────────

export interface JobWatchCallbacks {
  /** Live status line for the UI while the job is still in flight. */
  onProgress?: (message: string) => void;
  onComplete: (job: JobStatusResponse) => void | Promise<void>;
  onFail: (message: string) => void;
}

/** Hard ceiling on how long the UI will wait before calling a job dead. Well
 *  past the worst honest case (a 300s worker slot plus a queue wait), and short
 *  enough that a user is never left staring at a spinner. */
const JOB_WATCH_TIMEOUT_MS = 8 * 60 * 1000;
const JOB_POLL_INTERVAL_MS = 2500;

/**
 * Poll a job to a terminal state and report it.
 *
 * Returns a cancel function — call it on unmount. The previous inline pollers
 * left their `setInterval` running when the tab was closed mid-generation, so
 * they kept hitting the API and setting state on a dead component while the
 * remounted tab showed no sign that anything was in flight.
 *
 * Three things the naive poll got wrong, all of which read to the user as
 * "stuck forever":
 *   - a failed-but-retrying job reports `queued`, so it looked like progress;
 *   - the error already recorded on the job was never shown until (and unless)
 *     every attempt was spent;
 *   - nothing ever timed out.
 */
export function watchJob(jobId: string, cb: JobWatchCallbacks): () => void {
  const startedAt = Date.now();
  let cancelled = false;
  let lastError: string | null = null;

  const timer = setInterval(async () => {
    if (cancelled) return;
    const job = await getJobStatus("jobs", jobId).catch(() => null);
    if (cancelled) return;

    if (!job) {
      // Transient API blip; keep polling until the timeout below decides.
      if (Date.now() - startedAt > JOB_WATCH_TIMEOUT_MS) {
        stop();
        cb.onFail(lastError ?? "Lost contact with the job queue. Please try again.");
      }
      return;
    }

    if (job.error) lastError = job.error;

    if (job.isComplete) {
      stop();
      await cb.onComplete(job);
      return;
    }
    if (job.isFailed) {
      stop();
      cb.onFail(job.error || "Generation failed in the background.");
      return;
    }

    if (Date.now() - startedAt > JOB_WATCH_TIMEOUT_MS) {
      stop();
      cb.onFail(
        lastError ??
          "Generation is taking longer than expected and has been abandoned. " +
            "Check the job queue, then try again.",
      );
      return;
    }

    // Still running. A queued job that already carries an error has failed at
    // least once — say so instead of implying steady progress.
    if (job.attempts > 0 && job.error) {
      cb.onProgress?.(
        `Attempt ${job.attempts} of ${job.maxAttempts} failed — retrying. Last error: ${job.error}`,
      );
    } else if (job.status === "processing") {
      cb.onProgress?.("Running — Claude is working on it…");
    } else {
      cb.onProgress?.("Queued — generating in background…");
    }
  }, JOB_POLL_INTERVAL_MS);

  function stop() {
    cancelled = true;
    clearInterval(timer);
  }

  return stop;
}
