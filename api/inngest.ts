/**
 * Inngest Serve Endpoint — Vercel Pro
 *
 * Single entry point that Inngest Cloud webhooks to deliver workflow executions.
 * Register this URL in the Inngest dashboard: https://your-app.vercel.app/api/inngest
 *
 * The serve() handler:
 *  - Validates Inngest's webhook signatures (INNGEST_SIGNING_KEY)
 *  - Routes events to the correct workflow functions
 *  - Handles step retries, idempotency, and state management
 *
 * Vercel Pro: maxDuration 300s configured in vercel.json.
 */

import { serve } from "inngest/node";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { inngest } from "./_utils/inngest.js";

// Workflow Functions
import { documentWorkflows } from "./inngest/document-workflows.js";
import { transcriptWorkflows } from "./inngest/transcript-workflows.js";
import { briefWorkflows } from "./inngest/brief-workflows.js";
import { dealWorkflows } from "./inngest/deal-workflows.js";
import { osintWorkflows } from "./inngest/osint-workflows.js";
import { financialWorkflows } from "./inngest/financial-workflows.js";
import { portfolioWorkflows } from "./inngest/portfolio-workflows.js";

const handler = serve({
  client: inngest,
  functions: [
    ...documentWorkflows,
    ...transcriptWorkflows,
    ...briefWorkflows,
    ...dealWorkflows,
    ...osintWorkflows,
    ...financialWorkflows,
    ...portfolioWorkflows,
  ],
  // Vercel Pro: provide the canonical serve URL for Inngest's self-registration.
  // Falls back to VERCEL_URL in production, undefined in local dev.
  ...(process.env.VERCEL_URL
    ? { serveHost: `https://${process.env.VERCEL_URL}` }
    : {}),
});

export default function inngestHandler(req: VercelRequest, res: VercelResponse) {
  return (handler as unknown as (req: VercelRequest, res: VercelResponse) => unknown)(req, res);
}
