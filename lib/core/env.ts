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

  // OSINT sources. Each provider is skipped (not fatal) when its key is absent,
  // so a scan still runs on whatever sources are configured.
  COMPANIES_HOUSE_API_KEY: z.string().min(1).optional(),
  /** Notion internal-integration token (ntn_…) used to read the ACP SOPs. */
  NOTION_API_KEY: z.string().min(1).optional(),
  /** Comma-separated Notion page ids to treat as SOPs; omit to search by name. */
  NOTION_SOP_PAGE_IDS: z.string().min(1).optional(),
  /** Search phrase used to find SOP pages when NOTION_SOP_PAGE_IDS is unset. */
  NOTION_SOP_QUERY: z.string().min(1).optional(),
  /** Optional extra source — news is not part of the default OSINT pipeline. */
  NEWS_API_KEY: z.string().min(1).optional(),

  /** Shared secret Vercel Cron sends to /api/jobs/worker. Without it the cron
   *  request is unauthenticated and every queued AI job stays queued forever. */
  CRON_SECRET: z.string().min(1).optional(),

  // Airtable — used ONLY by the one-time ETL scripts, never by the app.
  AIRTABLE_API_KEY: z.string().min(1).optional(),
  AIRTABLE_BASE_ID: z.string().min(1).optional(),

  // NOTE: JWT_SECRET (legacy custom-JWT auth) was deliberately dropped from this
  // schema. Phase 4 moved auth to Supabase and nothing reads it any more, but a
  // stale short value left in the deployment env still failed the min(32) check —
  // and because every route calls getServerEnv(), that one dead variable took the
  // whole API down with "Authentication service is temporarily unavailable".
  // Unknown keys are ignored by z.object, so leftovers are now harmless. Don't
  // add validation for a variable no code reads.

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
