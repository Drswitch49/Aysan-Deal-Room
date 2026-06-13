/**
 * useJobStatus — polls /api/jobs/status until a job completes or fails.
 *
 * Usage:
 *   const { status, error, isComplete, isFailed, isProcessing } = useJobStatus({
 *     table: "Documents",
 *     recordId: "recXXXXXX",
 *     enabled: true,                // start polling immediately
 *     onComplete: () => refetch(),  // called once on completion
 *   });
 *
 * Polling interval: 3s while job is active.
 * Auto-stops polling on completion, failure, or when disabled.
 */

import { useState, useEffect, useRef, useCallback } from "react";

export type JobStatus =
  | "queued"
  | "processing"
  | "extracted"
  | "analyzing"
  | "completed"
  | "failed"
  | "unknown";

export interface JobStatusResult {
  status: JobStatus;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  isComplete: boolean;
  isFailed: boolean;
  isProcessing: boolean;
  hasContent: boolean;
}

interface UseJobStatusOptions {
  /** Airtable table name, e.g. "Documents" */
  table: string;
  /** Airtable record ID, e.g. "recXXXXXX" */
  recordId: string | null | undefined;
  /** Set to true to start polling. Set to false to stop. */
  enabled: boolean;
  /** Optional job type descriptor, e.g. "financial" */
  jobType?: string;
  /** Called once when status transitions to "completed" */
  onComplete?: (result: JobStatusResult) => void;
  /** Called once when status transitions to "failed" */
  onFailed?: (error: string | null) => void;
  /** Polling interval in ms (default: 3000) */
  intervalMs?: number;
}

const ACTIVE_STATUSES: JobStatus[] = [
  "queued",
  "processing",
  "extracted",
  "analyzing",
];

const DEFAULT_STATE: JobStatusResult = {
  status: "unknown",
  error: null,
  startedAt: null,
  completedAt: null,
  isComplete: false,
  isFailed: false,
  isProcessing: false,
  hasContent: false,
};

export function useJobStatus({
  table,
  recordId,
  enabled,
  jobType,
  onComplete,
  onFailed,
  intervalMs = 3_000,
}: UseJobStatusOptions): JobStatusResult {
  const [result, setResult] = useState<JobStatusResult>(DEFAULT_STATE);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStatusRef = useRef<JobStatus>("unknown");
  const onCompleteRef = useRef(onComplete);
  const onFailedRef = useRef(onFailed);

  // Keep callback refs stable
  onCompleteRef.current = onComplete;
  onFailedRef.current = onFailed;

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!recordId || !table) return;

    try {
      const url = `/api/jobs/status?table=${encodeURIComponent(table)}&recordId=${encodeURIComponent(recordId)}${
        jobType ? `&jobType=${encodeURIComponent(jobType)}` : ""
      }`;
      const response = await fetch(url);

      if (!response.ok) {
        // Non-2xx — stop polling to avoid hammering a broken endpoint
        if (response.status === 404 || response.status === 401) {
          stopPolling();
        }
        return;
      }

      const data = await response.json();
      const rawStatus = (data.status || "").toLowerCase();
      let newStatus: JobStatus = "unknown";
      if (rawStatus === "queued") newStatus = "queued";
      else if (rawStatus === "processing") newStatus = "processing";
      else if (rawStatus === "extracted") newStatus = "extracted";
      else if (rawStatus === "analyzing") newStatus = "analyzing";
      else if (rawStatus === "completed") newStatus = "completed";
      else if (rawStatus === "failed") newStatus = "failed";

      const newResult: JobStatusResult = {
        status: newStatus,
        error: data.error || null,
        startedAt: data.startedAt || null,
        completedAt: data.completedAt || null,
        isComplete: data.isComplete === true,
        isFailed: data.isFailed === true,
        isProcessing: data.isProcessing === true,
        hasContent: data.hasContent === true,
      };

      setResult(newResult);

      // Fire callbacks on status transitions (only once)
      if (newStatus !== prevStatusRef.current) {
        if (newStatus === "completed" && onCompleteRef.current) {
          onCompleteRef.current(newResult);
        }
        if (newStatus === "failed" && onFailedRef.current) {
          onFailedRef.current(newResult.error);
        }
        prevStatusRef.current = newStatus;
      }

      // Stop polling when job reaches a terminal state
      if (!data.isProcessing) {
        stopPolling();
      }
    } catch (err) {
      // Network error — don't stop polling, retry next cycle
      console.warn("[useJobStatus] Poll error:", err);
    }
  }, [recordId, table, jobType, stopPolling]);

  useEffect(() => {
    if (!enabled || !recordId) {
      stopPolling();
      return;
    }

    // Reset state when recordId changes
    setResult(DEFAULT_STATE);
    prevStatusRef.current = "unknown";

    // Start polling immediately
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, intervalMs);

    return stopPolling;
  }, [enabled, recordId, table, intervalMs, fetchStatus, stopPolling]);

  return result;
}

// ─── Status Display Helpers ───────────────────────────────────────────────

export function getStatusLabel(status: JobStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "processing":
      return "Processing…";
    case "extracted":
      return "Text Extracted";
    case "analyzing":
      return "AI Analyzing…";
    case "completed":
      return "Complete";
    case "failed":
      return "Failed";
    default:
      return "Unknown";
  }
}

export function getStatusColor(status: JobStatus): string {
  switch (status) {
    case "queued":
      return "#8b5cf6"; // violet
    case "processing":
    case "extracted":
      return "#3b82f6"; // blue
    case "analyzing":
      return "#f59e0b"; // amber
    case "completed":
      return "#10b981"; // green
    case "failed":
      return "#ef4444"; // red
    default:
      return "#6b7280"; // gray
  }
}
