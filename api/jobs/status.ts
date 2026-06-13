/**
 * Job Status Endpoint
 *
 * GET /api/jobs/status?table=Documents&recordId=recXXXXXX
 *
 * Reads processing lifecycle fields from any Airtable table and returns
 * the current job state. Used by the frontend to poll for completion.
 *
 * Authentication: Admin JWT required (same as other admin routes).
 */

import fs from "fs";
import path from "path";
import { airtableFetchRecord } from "../_utils/airtable.js";
import { authenticateAdmin } from "../admin/lenders_auth_helper.js";

// Status fields to read from any table
const STATUS_FIELDS = [
  "Processing_Status",
  "Processing_Error",
  "Processing_Started_At",
  "Processed_At",
  // Document-specific
  "Extracted_Text",
  "Summary",
];

// Tables that are accessible via this endpoint
const ALLOWED_TABLES = new Set([
  "Documents",
  "Transcript_Analyses",
  "Precall_Briefs",
  "Postcall_Briefs",
  "Active_Pipeline",
  "Portfolio_Health",
]);

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await authenticateAdmin(req);
  } catch (err: any) {
    return res.status(err.status || 401).json({ error: "Unauthorized" });
  }

  const { table, recordId, jobType } = req.query || {};

  if (!table || !recordId) {
    return res.status(400).json({
      error: "Query parameters 'table' and 'recordId' are required",
    });
  }

  if (!ALLOWED_TABLES.has(table as string)) {
    return res.status(400).json({
      error: `Table must be one of: ${[...ALLOWED_TABLES].join(", ")}`,
    });
  }

  // Handle Portfolio status file fallback
  if (table === "Portfolio_Health" && recordId === "status") {
    const statusFilePath = path.resolve(process.cwd(), "scratch", "portfolio_status.json");
    if (fs.existsSync(statusFilePath)) {
      try {
        const raw = fs.readFileSync(statusFilePath, "utf-8");
        const data = JSON.parse(raw);
        const status = data.status || "Completed";
        return res.status(200).json({
          recordId,
          table,
          status,
          error: data.error || null,
          startedAt: data.startedAt || null,
          completedAt: data.completedAt || null,
          hasContent: true,
          isComplete: status === "Completed",
          isFailed: status === "Failed",
          isProcessing: status === "Processing",
        });
      } catch (err) {
        console.error("Error reading portfolio status file:", err);
      }
    }
    return res.status(200).json({
      recordId,
      table,
      status: "Completed",
      error: null,
      startedAt: null,
      completedAt: null,
      hasContent: true,
      isComplete: true,
      isFailed: false,
      isProcessing: false,
    });
  }

  try {
    const record = await airtableFetchRecord(table as string, recordId as string);

    if (!record) {
      return res.status(404).json({ error: "Record not found" });
    }

    const fields = record.fields as Record<string, any>;

    let status = "unknown";
    let error = null;
    let startedAt = null;
    let completedAt = null;
    let hasContent = false;

    if (table === "Active_Pipeline") {
      if (jobType === "financial") {
        status = fields["Financial_Analysis_Status"] || "unknown";
        error = fields["Financial_Anomalies"] || null;
        startedAt = null;
        completedAt = fields["Financial_Completed_At"] || null;
        hasContent = !!fields["Financial_Insights"];
      } else {
        status = fields["OSINT_Status"] || "unknown";
        error = fields["OSINT_Failure_Reason"] || null;
        startedAt = fields["OSINT_Started_At"] || null;
        completedAt = fields["OSINT_Completed_At"] || null;
        hasContent = !!(fields["OSINT_Summary"] || fields["OSINT_Data"]);
      }
    } else {
      status = fields["Processing_Status"] || "unknown";
      error = fields["Processing_Error"] || null;
      startedAt = fields["Processing_Started_At"] || null;
      completedAt = fields["Processed_At"] || null;
      hasContent =
        table === "Documents"
          ? !!(fields["Extracted_Text"] || fields["Summary"])
          : !!(fields["Brief Data"] || fields["Transcript"]);
    }

    return res.status(200).json({
      recordId,
      table,
      status,
      error,
      startedAt,
      completedAt,
      hasContent,
      // Helpers for frontend display
      isComplete: status === "completed" || status === "Completed",
      isFailed: status === "failed" || status === "Failed",
      isProcessing: [
        "queued", "processing", "analyzing", "extracted",
        "Queued", "Scraping Website", "Extracting Metadata", "Analyzing Company", "Generating Risk Profile",
        "Processing"
      ].includes(status),
    });
  } catch (err: any) {
    console.error("[Job Status] Error fetching record:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch status" });
  }
}
