/**
 * Shared Anthropic Claude client.
 *
 * One @anthropic-ai/sdk client for every AI task in the app (verdicts, briefs,
 * OSINT synthesis, transcript and document analysis). Centralizes transport,
 * the output budget, refusal handling, and JSON validation.
 *
 * Model: Claude Opus 5 with adaptive thinking. Two consequences worth knowing
 * before changing anything here:
 *   - Thinking is ON by default and shares `max_tokens` with the response text,
 *     so the caller's text budget alone would truncate answers mid-sentence.
 *     THINKING_HEADROOM is added on top of it.
 *   - Requests are streamed. A large budget on a non-streaming request runs into
 *     the SDK's HTTP timeout; streaming and reading the final message avoids it
 *     without changing the call shape for callers.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import { getServerEnv } from "../core/env.js";
import { logger } from "../core/logger.js";

/** Model used by every AI task in the app. */
export const AI_MODEL = "claude-opus-5";

/** Reasoning depth. `high` is the API default; raise per-call for hard analysis. */
export type AiEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Adaptive thinking is billed against `max_tokens` alongside the visible text. */
const THINKING_HEADROOM = 12_000;
const MAX_OUTPUT_TOKENS = 64_000;

export class AiUnavailableError extends Error {
  constructor() {
    super("AI is not configured (ANTHROPIC_API_KEY missing). Feature degrades gracefully.");
    this.name = "AiUnavailableError";
  }
}

/** Claude declined the request (safety classifiers). Not a transport failure —
 *  retrying the same prompt will decline again, so jobs surface it verbatim. */
export class AiRefusedError extends Error {
  constructor(readonly category: string | null) {
    super(`Claude declined this request${category ? ` (${category})` : ""}.`);
    this.name = "AiRefusedError";
  }
}

let client: Anthropic | null = null;

export function aiAvailable(): boolean {
  return Boolean(getServerEnv().ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  const key = getServerEnv().ANTHROPIC_API_KEY;
  if (!key) throw new AiUnavailableError();
  if (!client) client = new Anthropic({ apiKey: key });
  return client;
}

export interface AskOptions {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** Budget for the *visible* answer; thinking headroom is added on top. */
  maxTokens?: number;
  model?: string;
  effort?: AiEffort;
}

/** Plain-text completion. */
export async function askClaude(opts: AskOptions): Promise<string> {
  const maxTokens = Math.min((opts.maxTokens ?? 4000) + THINKING_HEADROOM, MAX_OUTPUT_TOKENS);

  const response = await getClient().messages
    .stream({
      model: opts.model ?? AI_MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort ?? "high" },
      system: opts.system,
      messages: opts.messages,
    })
    .finalMessage();

  // Check the stop reason before reading content: a refusal returns HTTP 200
  // with empty (or partial) content, so reading blindly yields a silent blank.
  if (response.stop_reason === "refusal") {
    const category = (response as { stop_details?: { category?: string | null } }).stop_details?.category ?? null;
    throw new AiRefusedError(category);
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (!text) {
    throw new Error(
      response.stop_reason === "max_tokens"
        ? "Claude hit the output limit before producing an answer — raise maxTokens for this task."
        : "No content returned from Claude.",
    );
  }
  return text.trim();
}

/** Strip markdown fences the model sometimes emits despite instructions. */
function stripFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  return s;
}

/**
 * JSON completion validated against a zod schema, with ONE repair retry:
 * if parsing/validation fails, the raw output + error is sent back to the model
 * asking for corrected pure JSON.
 */
export async function askClaudeJson<T>(schema: ZodType<T>, opts: AskOptions): Promise<T> {
  const attempt = async (messages: AskOptions["messages"]): Promise<{ ok: true; value: T } | { ok: false; raw: string; error: string }> => {
    const raw = await askClaude({ ...opts, messages });
    try {
      const parsed = JSON.parse(stripFences(raw));
      const result = schema.safeParse(parsed);
      if (result.success) return { ok: true, value: result.data };
      return { ok: false, raw, error: JSON.stringify(result.error.issues.slice(0, 5)) };
    } catch (err) {
      return { ok: false, raw, error: err instanceof Error ? err.message : "JSON parse failed" };
    }
  };

  const first = await attempt(opts.messages);
  if (first.ok) return first.value;

  logger.warn({ error: first.error }, "AI JSON invalid — attempting one repair round-trip");
  const repair = await attempt([
    ...opts.messages,
    { role: "assistant", content: first.raw.slice(0, 8000) },
    {
      role: "user",
      content:
        `Your previous response was not valid JSON matching the required schema. ` +
        `Error: ${first.error}. ` +
        `Respond again with ONLY the corrected, pure JSON object — no markdown fences, no commentary.`,
    },
  ]);
  if (repair.ok) return repair.value;
  throw new Error(`AI returned invalid JSON after repair attempt: ${repair.error}`);
}
