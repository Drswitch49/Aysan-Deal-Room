/**
 * Job failure classification.
 *
 * Two questions every failed job has to answer before the queue can do anything
 * sensible with it:
 *
 *   1. Is a retry capable of helping? A dropped socket, a 429 or a 5xx: yes. An
 *      exhausted Anthropic credit balance, a bad API key or a payload missing
 *      its deal_id: never. Retrying those anyway is not harmless — the queue
 *      re-queues the job as `status = 'queued'` with a 2/4-minute backoff, and
 *      `queued` is indistinguishable from "still working" to the UI. That is
 *      exactly how a pre-call brief ended up spinning on "Generating
 *      Intelligence Brief" for six minutes before finally admitting it had
 *      failed on the first attempt, with the reason sitting in the row the
 *      whole time.
 *
 *   2. What should the operator read? `400 {"type":"error","error":{...}}` is
 *      the SDK's stringified body, not an answer. The classifier rewrites the
 *      classes we know into something with an action in it.
 */

/** Anthropic's SDK puts the HTTP status on the error; ours are plain Errors. */
function httpStatus(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number") return status;
  // Fallback: the SDK's message is "<status> <json body>".
  const m = /^(\d{3})\s/.exec(message(err));
  return m ? Number(m[1]) : null;
}

function message(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : String(err);
}

function name(err: unknown): string {
  return err instanceof Error ? err.name : "";
}

/**
 * Preconditions our own handlers assert before doing any work. These fail
 * identically on every attempt — the payload does not change between them.
 */
const PERMANENT_PRECONDITIONS = [
  /\brequired\b/i,
  /\bnot found\b/i,
  /has no (file url|company name)/i,
  /is empty/i,
  /no handler registered/i,
  /no text could be extracted/i,
];

/** Provider errors that a retry cannot move: billing, auth, malformed request. */
const PERMANENT_PROVIDER = [
  /credit balance is too low/i,
  /invalid_request_error/i,
  /authentication_error/i,
  /permission_error/i,
  /invalid x-api-key/i,
  /not_found_error/i,
];

export interface FailureClassification {
  /** Human-facing reason, with the remedy where we know one. */
  message: string;
  /** True when every remaining attempt would fail the same way. */
  permanent: boolean;
}

export function classifyFailure(err: unknown): FailureClassification {
  const raw = message(err);
  const status = httpStatus(err);
  const errName = name(err);

  // ─── Anthropic billing: the single most common cause of a dead AI job ───
  if (/credit balance is too low/i.test(raw)) {
    return {
      permanent: true,
      message:
        "Claude API credit is exhausted for this workspace, so no AI job can run. " +
        "Top up at console.anthropic.com → Plans & Billing, then generate again.",
    };
  }

  if (errName === "AiUnavailableError" || /ANTHROPIC_API_KEY missing/i.test(raw)) {
    return {
      permanent: true,
      message: "AI is not configured for this deployment — set ANTHROPIC_API_KEY and redeploy.",
    };
  }

  if (errName === "AiRefusedError") {
    return { permanent: true, message: raw };
  }

  if (status === 401 || status === 403 || /invalid x-api-key|authentication_error|permission_error/i.test(raw)) {
    return {
      permanent: true,
      message: "The Claude API key was rejected (invalid, revoked, or lacking access to this model).",
    };
  }

  if (status === 429 || /rate_limit/i.test(raw)) {
    return { permanent: false, message: "Claude rate limit hit — the job will retry shortly." };
  }

  if (status !== null && status >= 500) {
    return { permanent: false, message: `Upstream service error (${status}) — the job will retry.` };
  }

  if (PERMANENT_PRECONDITIONS.some((re) => re.test(raw))) {
    return { permanent: true, message: raw };
  }

  if (PERMANENT_PROVIDER.some((re) => re.test(raw)) || (status !== null && status >= 400 && status < 500)) {
    return { permanent: true, message: raw };
  }

  // Unknown: assume transient. A retry costs two minutes; giving up on a blip
  // costs the user their brief.
  return { permanent: false, message: raw };
}
