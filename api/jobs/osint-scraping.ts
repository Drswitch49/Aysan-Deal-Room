/**
 * Job Worker: OSINT Scraping
 *
 * Called by QStash. Handles web enrichment and OSINT data gathering.
 * Currently a production-ready stub — full Playwright implementation pending.
 *
 * Queue: osint-scraping
 * Payload: { dealId, recordId, sources?, targets? }
 */

import { airtableFetchRecord, airtableUpdate } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { verifyQStashRequest } from "../_utils/qstash.js";
import { updateJobStatus, failJob } from "../_utils/job-status.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await verifyQStashRequest(req);
  } catch (err: any) {
    return res.status(err.status || 401).json({ error: err.message });
  }

  const { dealId, recordId, sources = [], targets = [] } = req.body || {};

  if (!dealId) {
    return res.status(400).json({ error: "dealId is required" });
  }

  console.log(
    `[OSINT Worker] Received job for deal=${dealId}, sources=[${sources.join(",")}]`
  );

  // ─── Future Implementation Notes ─────────────────────────────────────────
  // When implementing full OSINT:
  //
  // 1. Companies House API — free, registered in UK, no Playwright needed
  //    GET https://api.company-information.service.gov.uk/search/companies?q={companyName}
  //
  // 2. LinkedIn scraping — requires Playwright + Browserbase (serverless browser)
  //    or use a LinkedIn data provider API (e.g. RocketReach, Apollo)
  //
  // 3. Google News — use NewsAPI.org or SerpAPI for news about the target company
  //
  // 4. Store enrichment results in a new Airtable table "OSINT_Reports"
  //    linked to Active_Pipeline records
  //
  // For Playwright on Vercel: use Browserbase (https://www.browserbase.com/)
  // which provides managed headless browsers callable via API from serverless functions.
  // ─────────────────────────────────────────────────────────────────────────

  // Mark as "processing" to acknowledge receipt
  if (recordId) {
    await updateJobStatus(TABLES.PIPELINE || "Active_Pipeline", recordId, {
      status: "processing",
      startedAt: new Date().toISOString(),
    });
  }

  // Stub: log job details and mark as pending implementation
  const stubResult = {
    dealId,
    sources,
    targets,
    status: "pending_implementation",
    message:
      "OSINT scraping queue is active. Full implementation coming: Companies House → LinkedIn → News enrichment.",
    queuedAt: new Date().toISOString(),
  };

  console.log("[OSINT Worker] Stub result:", stubResult);

  // Return 200 so QStash doesn't retry (this is expected behaviour for a stub)
  return res.status(200).json({
    success: true,
    stub: true,
    ...stubResult,
  });
}
