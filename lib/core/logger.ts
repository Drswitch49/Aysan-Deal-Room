/**
 * Structured logger (pino). Replaces scattered `console.*` calls across api/ and lib/.
 *
 * Usage:
 *   import { logger } from "../lib/core/logger.js";
 *   logger.info({ dealId }, "deal created");
 *   logger.error({ err }, "airtable write failed");
 *
 * In dev, pretty-prints; in prod, emits JSON lines that Vercel captures.
 */

import pino from "pino";

const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
  // pino-pretty is only wired in non-prod to keep prod logs as raw JSON.
  transport: isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
      },
  // Never log secrets even if accidentally passed in a context object.
  redact: {
    paths: [
      "*.password",
      "*.passwordHash",
      "*.apiKey",
      "*.token",
      "*.authorization",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[redacted]",
  },
});

/** Create a child logger bound to a request/operation context. */
export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
