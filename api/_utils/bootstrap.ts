/**
 * Environment validation and bootstrap configuration.
 *
 * Ensures all required environment variables are present before any API endpoint runs.
 * Prevents execution with insecure fallbacks or missing database configurations.
 */

// Secrets that were previously committed/hardcoded and are therefore compromised.
// These must never be accepted in any environment.
const COMPROMISED_SECRETS = new Set<string>([
  "acp-deal-os-jwt-secret-key-2026-super-secure-hash",
]);

export function validateEnv(): void {
  const jwtSecret = process.env.JWT_SECRET;
  const airtableKey = process.env.AIRTABLE_API_KEY || process.env.VITE_AIRTABLE_API_KEY;
  const airtableBase = process.env.AIRTABLE_BASE_ID || process.env.VITE_AIRTABLE_BASE_ID;

  const missing: string[] = [];

  if (!jwtSecret) {
    missing.push("JWT_SECRET");
  } else {
    // Fail fast in EVERY environment (not just production): a known-compromised
    // or weak signing secret must never be used.
    if (COMPROMISED_SECRETS.has(jwtSecret)) {
      throw new Error(
        "CRITICAL CONFIGURATION ERROR: JWT_SECRET is set to a known-compromised value. " +
        "Generate a fresh secret (e.g. `openssl rand -base64 48`) and set it in your environment."
      );
    }
    if (jwtSecret.length < 32) {
      throw new Error(
        "CRITICAL CONFIGURATION ERROR: JWT_SECRET is too weak (min 32 chars). " +
        "Generate a fresh secret (e.g. `openssl rand -base64 48`)."
      );
    }
  }

  if (!airtableKey) {
    missing.push("AIRTABLE_API_KEY / VITE_AIRTABLE_API_KEY");
  }

  if (!airtableBase) {
    missing.push("AIRTABLE_BASE_ID / VITE_AIRTABLE_BASE_ID");
  }

  if (missing.length > 0) {
    throw new Error(
      `CRITICAL SERVICE ERROR: Missing required environment configuration variables: ${missing.join(", ")}. ` +
      `Ensure these are defined in your deployment configuration or local .env.local file.`
    );
  }
}
