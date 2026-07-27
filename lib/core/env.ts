/**
 * Server-side environment validation.
 *
 * Parses `process.env` once at boot with zod so a misconfigured deployment fails
 * fast with a clear message instead of surfacing as a cryptic runtime error deep
 * in a handler. Import `serverEnv` in server code only — never in the browser
 * bundle (these values are secrets).
 *
 * NOTE: during the migration some services are still being ported; fields are
 * marked optional where a feature degrades gracefully when absent (e.g. AI).
 */

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Supabase (server) — required once Phase 1+ code is live.
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),

  // Cloudinary — required for file storage.
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),

  // AI — feature degrades gracefully when absent.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // Airtable — used ONLY by the one-time ETL scripts, never by the app.
  AIRTABLE_API_KEY: z.string().min(1).optional(),
  AIRTABLE_BASE_ID: z.string().min(1).optional(),

  // Legacy custom-JWT auth (removed in Phase 4). Rejected if weak/compromised.
  JWT_SECRET: z.string().min(32).optional(),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).optional(),
});

export type ServerEnv = z.infer<typeof EnvSchema>;

let cached: ServerEnv | null = null;

/** Parse and cache the environment. Throws a readable error on misconfiguration. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid server environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Assert a set of env keys are present; use at the top of code paths that need them. */
export function requireEnv<K extends keyof ServerEnv>(keys: K[]): Pick<ServerEnv, K> {
  const env = getServerEnv();
  const missing = keys.filter((k) => env[k] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  return env as Pick<ServerEnv, K>;
}
