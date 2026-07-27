/**
 * Shared Anthropic Claude client (Phase 5b).
 *
 * Replaces the duplicated raw-fetch blocks in the legacy api/_services/ai.ts,
 * api/_utils/document-processor.ts and api/_services/portfolio.ts with one
 * @anthropic-ai/sdk client. Same provider, same models — no behavior change by
 * design; this only centralizes transport, error handling, and JSON validation.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import { getServerEnv } from "../core/env.js";
import { logger } from "../core/logger.js";

/** Model used by the app's AI tasks (unchanged from the legacy implementation). */
export const AI_MODEL = "claude-sonnet-4-6";

export class AiUnavailableError extends Error {
  constructor() {
    super("AI is not configured (ANTHROPIC_API_KEY missing). Feature degrades gracefully.");
    this.name = "AiUnavailableError";
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
  maxTokens?: number;
  model?: string;
}

/** Plain-text completion. */
export async function askClaude(opts: AskOptions): Promise<string> {
  const response = await getClient().messages.create({
    model: opts.model ?? AI_MODEL,
    max_tokens: opts.maxTokens ?? 4000,
    system: opts.system,
    messages: opts.messages,
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text) throw new Error("No content returned from Claude.");
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
