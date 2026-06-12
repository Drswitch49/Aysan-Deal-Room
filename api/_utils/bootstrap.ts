/**
 * Environment validation and bootstrap configuration.
 *
 * Ensures all required environment variables are present before any API endpoint runs.
 * Prevents execution with insecure fallbacks or missing database configurations.
 */

export function validateEnv(): void {
  const jwtSecret = process.env.JWT_SECRET;
  const airtableKey = process.env.AIRTABLE_API_KEY || process.env.VITE_AIRTABLE_API_KEY;
  const airtableBase = process.env.AIRTABLE_BASE_ID || process.env.VITE_AIRTABLE_BASE_ID;

  const missing: string[] = [];

  if (!jwtSecret) {
    missing.push("JWT_SECRET");
  } else if (jwtSecret === "acp-deal-os-jwt-secret-key-2026-super-secure-hash") {
    // Block the use of the default fallback in production
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CRITICAL CONFIGURATION ERROR: The default insecure JWT_SECRET cannot be used in production. " +
        "Please update your production environment variables."
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
