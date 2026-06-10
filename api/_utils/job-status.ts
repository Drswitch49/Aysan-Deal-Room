/**
 * Job status persistence helper.
 *
 * Writes processing lifecycle fields to any Airtable table.
 * Failures are logged but never rethrown — status updates must not cascade
 * and kill the actual job work.
 *
 * Fields written (must exist in each target table):
 *   Processing_Status        — queued | processing | analyzing | completed | failed
 *   Processing_Error         — error message on failure (up to 2000 chars)
 *   Processing_Started_At   — ISO timestamp when worker picked up the job
 *   Processed_At             — ISO timestamp when job completed (reuses existing field name)
 */

import { airtableUpdate } from "./airtable.js";

export type JobStatus =
  | "queued"
  | "processing"
  | "analyzing"
  | "completed"
  | "failed";

export interface JobStatusUpdate {
  status: JobStatus;
  /** Error message to store (truncated to 2000 chars) */
  error?: string;
  /** ISO 8601 timestamp when work started */
  startedAt?: string;
  /** ISO 8601 timestamp when work finished (success or failure) */
  completedAt?: string;
}

/**
 * Persists a job lifecycle update to Airtable.
 * Safe to call inside catch blocks — never throws.
 */
export async function updateJobStatus(
  table: string,
  recordId: string,
  update: JobStatusUpdate
): Promise<void> {
  const fields: Record<string, string> = {
    Processing_Status: update.status,
  };

  if (update.error !== undefined) {
    // Truncate to avoid Airtable field size limits
    fields.Processing_Error = update.error.substring(0, 2000);
  }

  if (update.startedAt !== undefined) {
    fields.Processing_Started_At = update.startedAt;
  }

  // Reuse the existing Processed_At field for completion timestamps
  if (update.completedAt !== undefined) {
    fields.Processed_At = update.completedAt;
  }

  try {
    await airtableUpdate(table, recordId, fields);
  } catch (err: any) {
    // Never rethrow — status update failures must not kill job processing
    console.error(
      `[JobStatus] Failed to update ${table}/${recordId} → ${update.status}:`,
      err?.message ?? err
    );
  }
}

/**
 * Marks a job as failed and logs the error. Convenience wrapper.
 */
export async function failJob(
  table: string,
  recordId: string,
  error: Error | string
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Job Failed] ${table}/${recordId}: ${message}`);
  await updateJobStatus(table, recordId, {
    status: "failed",
    error: message,
    completedAt: new Date().toISOString(),
  });
}
