import { inngest } from "../_utils/inngest.js";
import type { PlatformEvents } from "../_utils/inngest.js";

// ─── Central Event Emitter ────────────────────────────────────────────────────
//
// All code that needs to fire a platform event should call `emitEvent()`.
// Never call `inngest.send()` directly outside this file.
//
// Behaviour:
//   • Production (INNGEST_EVENT_KEY set): sends event to Inngest Cloud
//   • Local dev (no key, INNGEST_DEV=1): sends to local Inngest dev server
//   • No Inngest at all: logs a warning, returns null (caller handles fallback)
//
// Local dev setup: `npx inngest-cli@latest dev` in a second terminal
//   then set INNGEST_DEV=1 in .env.local

export async function emitEvent<K extends keyof PlatformEvents>(
  name: K,
  data: PlatformEvents[K]["data"],
  options?: {
    /** Unique key — Inngest deduplicates events with the same key within 24h */
    idempotencyKey?: string;
    /** Optional delay before the event is delivered (milliseconds) */
    delayMs?: number;
  }
): Promise<any> {
  try {
    const eventPayload: Record<string, unknown> = { name, data };

    if (options?.idempotencyKey) {
      eventPayload["id"] = options.idempotencyKey;
    }

    if (options?.delayMs) {
      // Inngest supports scheduled delivery via ts (unix ms timestamp)
      eventPayload["ts"] = Date.now() + options.delayMs;
    }

    const result = await inngest.send(eventPayload as Parameters<typeof inngest.send>[0]);
    return result;
  } catch (err) {
    console.warn(`[emitEvent] Failed to emit "${String(name)}":`, err);
    return null;
  }
}

// ─── hasInngest ───────────────────────────────────────────────────────────────
// Returns true if Inngest is configured and events will actually be delivered.
// Use this to decide whether to fall back to synchronous processing.
export function hasInngest(): boolean {
  // Inngest works in both production (INNGEST_EVENT_KEY) and local dev (INNGEST_DEV)
  return Boolean(
    process.env.INNGEST_EVENT_KEY ||
    process.env.INNGEST_DEV === "1" ||
    process.env.NODE_ENV === "development"
  );
}
