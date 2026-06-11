/**
 * QStash utilities — job publishing and signature verification.
 *
 * @deprecated Trigger endpoints have been migrated to Inngest events.
 * This module is kept for the legacy job worker endpoints (api/jobs/*.ts)
 * which still use QStash for signature verification. Do not use publishJob()
 * in new trigger endpoints — use emitEvent() from api/_events/emit.ts instead.
 *
 * Architecture (migrated):
 *  - Trigger endpoints emit Inngest events via api/_events/emit.ts
 *  - Inngest workflow functions (api/inngest/*.ts) handle the actual work
 *  - QStash workers (api/jobs/*.ts) are legacy and will be retired
 */

import { Client, Receiver } from "@upstash/qstash";

// ─── Singleton Client ──────────────────────────────────────────────────────

let _client: Client | null = null;

function getClient(): Client | null {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return null;
  if (!_client) _client = new Client({ token });
  return _client;
}

// ─── Base URL Resolution ───────────────────────────────────────────────────
// Vercel sets VERCEL_URL automatically on deployments. For local dev, fall
// back to APP_URL or localhost. QStash needs a publicly reachable URL.

export function getBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.APP_URL || "http://localhost:5173";
}

// ─── Job Publishing ────────────────────────────────────────────────────────

export type QueueName =
  | "document-analysis"
  | "transcript-analysis"
  | "precall-brief"
  | "postcall-brief"
  | "osint-scraping"
  | "portfolio-processing";

export interface PublishOptions {
  /** Number of QStash retry attempts on failure (default: 3) */
  retries?: number;
  /** Delay before first delivery, e.g. "10s", "2m" (default: immediate) */
  delay?: string;
}

export interface PublishResult {
  /** QStash message ID for tracking */
  messageId?: string;
  /** True when QStash is not configured → caller should run job synchronously */
  fallback: boolean;
}

/**
 * Publishes a job to a named queue. Returns immediately (<100ms).
 * On success: returns messageId. On no token: returns { fallback: true }.
 */
export async function publishJob(
  queue: QueueName,
  body: Record<string, unknown>,
  options: PublishOptions = {}
): Promise<PublishResult> {
  const client = getClient();

  if (!client) {
    console.warn(`[QStash] QSTASH_TOKEN not set — job "${queue}" will run synchronously.`);
    return { fallback: true };
  }

  const workerUrl = `${getBaseUrl()}/api/jobs/${queue}`;

  try {
    const result = await (client.publishJSON as any)({
      url: workerUrl,
      body,
      retries: options.retries ?? 3,
      ...(options.delay ? { delay: options.delay as any } : {}),
    });

    console.log(`[QStash] Job queued: ${queue} → messageId=${(result as any).messageId}`);
    return { messageId: (result as any).messageId, fallback: false };
  } catch (err: any) {
    console.error(`[QStash] Failed to publish job "${queue}":`, err.message);
    // Surface the error — don't silently swallow queue failures
    throw Object.assign(new Error(`Failed to queue job: ${err.message}`), { status: 503 });
  }
}

// ─── Signature Verification ────────────────────────────────────────────────

/**
 * Verifies the Upstash-Signature header on incoming worker requests.
 * Throws a 401 error on invalid signatures.
 * Skips verification gracefully when signing keys are not configured (local dev).
 */
export async function verifyQStashRequest(req: {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}): Promise<void> {
  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (!currentKey || !nextKey) {
    console.warn("[QStash Worker] Signature verification skipped — no signing keys configured (local dev mode).");
    return;
  }

  const receiver = new Receiver({
    currentSigningKey: currentKey,
    nextSigningKey: nextKey,
  });

  const rawSig = req.headers["upstash-signature"];
  const signature = Array.isArray(rawSig) ? rawSig[0] : rawSig || "";

  if (!signature) {
    throw Object.assign(
      new Error("Missing Upstash-Signature header. Request must originate from QStash."),
      { status: 401 }
    );
  }

  // Re-stringify parsed body to produce a consistent string for HMAC verification.
  // Vercel's body parser gives us a parsed object; we reproduce the JSON string.
  const rawBody =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});

  try {
    const isValid = await receiver.verify({ body: rawBody, signature });
    if (!isValid) {
      throw new Error("Signature mismatch");
    }
  } catch (err: any) {
    throw Object.assign(
      new Error(`Invalid QStash signature: ${err.message}`),
      { status: 401 }
    );
  }
}

/** Returns true when QStash is fully configured and can queue jobs. */
export function isQStashConfigured(): boolean {
  return !!process.env.QSTASH_TOKEN;
}
