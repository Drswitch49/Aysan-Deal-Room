/**
 * Activity Feed API — Cross-Deal Operational Activity
 *
 * GET /api/admin/activity?limit=20&dealId=xxx
 *
 * Aggregates real operational events into a unified activity stream:
 *  - Stage transitions (Deal_Stage_History)
 *  - Document uploads (Documents)
 *  - Transcript analyses (Transcript_Analyses)
 *  - Postcall briefs (Postcall_Briefs)
 *
 * Used by:
 *  - Dashboard sidebar activity feed
 *  - Deal detail timeline (when dealId is provided)
 */

import { authenticateAdmin } from "./lenders.js";
import { airtableFetch } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { STAGE_CONFIG, normalizeStage } from "../_services/deal-lifecycle.js";

export interface ActivityEvent {
  id: string;
  type: "stage_transition" | "document_uploaded" | "transcript_analyzed" | "brief_completed" | "osint_completed";
  title: string;
  detail?: string;
  dealId?: string;
  dealRef?: string;
  companyName?: string;
  changedBy?: string;
  timestamp: string;
  color: "bronze" | "blue" | "emerald" | "purple" | "amber" | "red";
  icon: "arrow-right" | "file" | "mic" | "brain" | "search";
  metadata?: Record<string, any>;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await authenticateAdmin(req);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const dealId = req.query.dealId ? String(req.query.dealId) : null;
  const limit = Math.min(parseInt(req.query.limit || "30"), 100);

  const events: ActivityEvent[] = [];

  // ── 1. Stage Transitions (Deal_Stage_History) ────────────────────────────
  try {
    const historyParams: Record<string, any> = {
      sort: [{ field: "Changed_At", direction: "desc" }],
      maxRecords: dealId ? 50 : 20,
    };
    if (dealId) {
      historyParams.filterByFormula = `FIND("${dealId}", {Deal_ID})`;
    }

    const historyRes = await airtableFetch(TABLES.STAGE_HISTORY, historyParams);
    for (const r of (historyRes?.records || [])) {
      const fromStage = normalizeStage(r.fields.From_Stage);
      const toStage = normalizeStage(r.fields.To_Stage);
      const fromLabel = STAGE_CONFIG[fromStage]?.label || r.fields.From_Stage_Label || r.fields.From_Stage || "—";
      const toLabel = STAGE_CONFIG[toStage]?.label || r.fields.To_Stage_Label || r.fields.To_Stage || "—";

      events.push({
        id: `stage-${r.id}`,
        type: "stage_transition",
        title: `${fromLabel} → ${toLabel}`,
        detail: r.fields.Notes || undefined,
        dealId: Array.isArray(r.fields.Deal_ID) ? r.fields.Deal_ID[0] : r.fields.Deal_ID,
        dealRef: r.fields.Deal_Ref || undefined,
        companyName: r.fields.Company_Name || undefined,
        changedBy: r.fields.Changed_By || "Admin",
        timestamp: r.fields.Changed_At || r.createdTime,
        color: "bronze",
        icon: "arrow-right",
        metadata: {
          fromStage,
          toStage,
          role: r.fields.Changed_By_Role,
        },
      });
    }
  } catch {
    // Table may not exist yet — skip gracefully
  }

  // ── 2. Document Uploads (Documents) ─────────────────────────────────────
  try {
    const docParams: Record<string, any> = {
      sort: [{ field: "Date_Received", direction: "desc" }],
      maxRecords: 10,
    };
    if (dealId) {
      docParams.filterByFormula = `FIND("${dealId}", {Deal_Ref})`;
    }

    const docRes = await airtableFetch(TABLES.DOCUMENTS, docParams);
    for (const r of (docRes?.records || [])) {
      const name = r.fields.Document_Name || r.fields["Document Name"] || "Document";
      const category = r.fields.Category || "";
      const company = r.fields.Company_Name || "";

      events.push({
        id: `doc-${r.id}`,
        type: "document_uploaded",
        title: `Document uploaded: ${name}`,
        detail: category || undefined,
        dealId: Array.isArray(r.fields.Deal_Ref) ? r.fields.Deal_Ref[0] : r.fields.Deal_Ref,
        companyName: company || undefined,
        timestamp: r.fields.Date_Received || r.createdTime,
        color: "blue",
        icon: "file",
      });
    }
  } catch {
    // Graceful skip
  }

  // ── 3. Transcript Analyses ────────────────────────────────────────────────
  try {
    const txParams: Record<string, any> = {
      sort: [{ field: "Created_At", direction: "desc" }],
      maxRecords: 10,
    };
    if (dealId) {
      txParams.filterByFormula = `{Deal_ID} = "${dealId}"`;
    }

    const txRes = await airtableFetch(TABLES.TRANSCRIPT_ANALYSES, txParams);
    for (const r of (txRes?.records || [])) {
      const score = r.fields.Deal_Score || r.fields.Score;
      events.push({
        id: `tx-${r.id}`,
        type: "transcript_analyzed",
        title: `Transcript analyzed${score ? ` — Score: ${score}/50` : ""}`,
        detail: r.fields.File_Name || r.fields.Summary?.slice(0, 80) || undefined,
        dealId: r.fields.Deal_ID || undefined,
        changedBy: "Claude AI",
        timestamp: r.fields.Created_At || r.createdTime,
        color: "purple",
        icon: "mic",
      });
    }
  } catch {
    // Graceful skip
  }

  // ── 4. Postcall Briefs ────────────────────────────────────────────────────
  try {
    const briefParams: Record<string, any> = {
      sort: [{ field: "Created_At", direction: "desc" }],
      maxRecords: 10,
    };
    if (dealId) {
      briefParams.filterByFormula = `{Deal_ID} = "${dealId}"`;
    }

    const briefRes = await airtableFetch(TABLES.POSTCALL_BRIEFS, briefParams);
    for (const r of (briefRes?.records || [])) {
      const score = r.fields.Score || r.fields.Deal_Score;
      events.push({
        id: `brief-${r.id}`,
        type: "brief_completed",
        title: `Post-call brief completed${score ? ` — ${score}/50` : ""}`,
        detail: r.fields.Summary?.slice(0, 80) || undefined,
        dealId: r.fields.Deal_ID || undefined,
        changedBy: "Claude AI",
        timestamp: r.fields.Created_At || r.createdTime,
        color: "emerald",
        icon: "brain",
      });
    }
  } catch {
    // Graceful skip
  }

  // ── Sort all events by timestamp descending ──────────────────────────────
  events.sort((a, b) => {
    const ta = new Date(a.timestamp || 0).getTime();
    const tb = new Date(b.timestamp || 0).getTime();
    return tb - ta;
  });

  return res.status(200).json({
    success: true,
    events: events.slice(0, limit),
    total: events.length,
  });
}
