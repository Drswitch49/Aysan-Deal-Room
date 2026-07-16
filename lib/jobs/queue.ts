/**
 * Self-hosted job queue on Supabase (replaces Inngest + QStash).
 *
 * enqueue(type, payload)  → insert a queued job row
 * runDueJobs()            → worker loop: claim due jobs atomically
 *                           (claim_jobs SQL function, FOR UPDATE SKIP LOCKED),
 *                           run the registered handler, record result/error
 *                           with exponential-backoff retries.
 *
 * The worker is driven by Vercel Cron hitting /api/jobs/worker (maxDuration 300).
 */
import { adminClient } from "../data/supabase/client.js";
import { logger } from "../core/logger.js";

export interface Job<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  max_attempts: number;
  created_by: string | null;
}

export type JobHandler = (payload: any, job: Job) => Promise<unknown>;

const handlers = new Map<string, JobHandler>();

/** Register a handler for a job type (called once at worker module load). */
export function registerHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
}

export function registeredTypes(): string[] {
  return [...handlers.keys()];
}

/** Enqueue a job. Returns the job id (poll /api/jobs/status?id=…). */
export async function enqueue(
  type: string,
  payload: unknown,
  opts: { createdBy?: string; maxAttempts?: number; delaySeconds?: number } = {},
): Promise<string> {
  const db = adminClient();
  const { data, error } = await db
    .from("jobs")
    .insert({
      type,
      payload,
      created_by: opts.createdBy ?? null,
      max_attempts: opts.maxAttempts ?? 3,
      run_after: opts.delaySeconds
        ? new Date(Date.now() + opts.delaySeconds * 1000).toISOString()
        : new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`enqueue(${type}): ${error.message}`);
  return data.id as string;
}

export async function getJob(id: string): Promise<Record<string, unknown> | null> {
  const db = adminClient();
  const { data, error } = await db.from("jobs").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`getJob: ${error.message}`);
  return data;
}

/** Claim and run due jobs until none remain or the time budget is spent. */
export async function runDueJobs(opts: { batch?: number; timeBudgetMs?: number } = {}): Promise<{
  ran: number;
  failed: number;
}> {
  const db = adminClient();
  const deadline = Date.now() + (opts.timeBudgetMs ?? 250_000); // stay under maxDuration 300s
  let ran = 0, failed = 0;

  while (Date.now() < deadline) {
    const { data: claimed, error } = await db.rpc("claim_jobs", { batch: opts.batch ?? 3 });
    if (error) throw new Error(`claim_jobs: ${error.message}`);
    if (!claimed || claimed.length === 0) break;

    for (const job of claimed as unknown as Job[]) {
      const handler = handlers.get(job.type);
      try {
        if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
        const result = await handler(job.payload, job);
        await db
          .from("jobs")
          .update({ status: "done", finished_at: new Date().toISOString(), result: result ?? null, error: null })
          .eq("id", job.id);
        ran++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const retryable = job.attempts < job.max_attempts;
        const backoffSec = Math.min(60 * Math.pow(2, job.attempts), 3600); // 2min, 4min, … cap 1h
        await db
          .from("jobs")
          .update(
            retryable
              ? { status: "queued", run_after: new Date(Date.now() + backoffSec * 1000).toISOString(), error: message }
              : { status: "failed", finished_at: new Date().toISOString(), error: message },
          )
          .eq("id", job.id);
        logger.error({ jobId: job.id, type: job.type, attempts: job.attempts, retryable, err: message }, "job failed");
        failed++;
      }
    }
  }
  return { ran, failed };
}
