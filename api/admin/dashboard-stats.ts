import { authenticateAdmin } from "./lenders.js";
import { airtableFetchAll } from "../../src/lib/airtable/client.js";
import { TABLES } from "../../src/lib/airtable/schema.js";

// Helper to strip raw Airtable mention markup from text
function cleanAirtableMentions(text: string | undefined | null): string {
  if (!text) return "";
  return text.replace(/<airtable:mention[^>]*>(@?[^<]+)<\/airtable:mention>/g, "$1");
}

// Helper to extract the core company/deal name
function cleanCompanyName(name: string | undefined | null): string {
  if (!name) return "";
  let clean = cleanAirtableMentions(name);
  
  if (clean.includes("|")) {
    const parts = clean.split("|").map(p => p.trim());
    const namePart = parts.find(p => !/^ACP-CFS-\d+$/i.test(p) && p.length > 0);
    if (namePart) {
      clean = namePart;
    }
  }

  const separators = [" — ", " – ", " - "];
  for (const sep of separators) {
    if (clean.includes(sep)) {
      clean = clean.split(sep)[0].trim();
    }
  }

  if (clean.includes("—")) clean = clean.split("—")[0].trim();
  if (clean.includes("–")) clean = clean.split("–")[0].trim();

  return clean.replace(/^[\s\-|–|—|:|·|•]+|[\s\-|–|—|:|·|•]+$/g, "").trim();
}

const matchOwner = (dealFields: any, ownerName: string) => {
  if (ownerName === "All") return true;
  const collabs = dealFields["Collaborator"];
  if (Array.isArray(collabs)) {
    return collabs.some((c: any) => c.name && c.name.toLowerCase() === ownerName.toLowerCase());
  }
  // Fallback checks for Ayo's specific deal like in original code
  if (ownerName.toLowerCase() === "ayo" && (dealFields["REF No."] === "ACP-CFS-001" || dealFields["Deal_Ref"] === "ACP-CFS-001")) {
    return true;
  }
  return false;
};

const isDocForDeal = (docFields: any, dealId: string) => {
  const refs = docFields["Deal_Ref"] || docFields["Deal Ref"] || docFields["Deal_Reference"];
  if (Array.isArray(refs)) {
    return refs.includes(dealId);
  }
  return refs === dealId;
};

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin
    await authenticateAdmin(req);
  } catch (err: any) {
    return res.status(err.status || 401).json({ error: "Unauthorized" });
  }

  const owner = req.query.owner || "All";
  const todayStr = new Date().toISOString().split("T")[0];

  try {
    // 2. Fetch all required tables in parallel
    const [dealsRes, docsRes, precallBriefsRes, postcallBriefsRes, activityRes] = await Promise.all([
      airtableFetchAll(TABLES.PIPELINE).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.DOCUMENTS).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.PRECALL_BRIEFS).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.POSTCALL_BRIEFS).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.STAGE_HISTORY, {
        sort: [{ field: "Changed_At", direction: "desc" }],
        maxRecords: 50
      }).catch(() => ({ records: [] }))
    ]);

    // 3. Extract unique list of collaborators for filtering dropdown
    const collaboratorsList = new Set<string>();
    dealsRes.records.forEach((rec: any) => {
      const collabs = rec.fields["Collaborator"];
      if (Array.isArray(collabs)) {
        collabs.forEach((c: any) => {
          if (c.name) collaboratorsList.add(c.name);
        });
      }
    });
    // Add default options if not present
    ["Ayo", "Prince", "Dami", "Chante"].forEach(name => collaboratorsList.add(name));
    const uniqueOwners = ["All", ...Array.from(collaboratorsList)];

    // 4. Filter deals based on active stage & owner
    const activeDeals = dealsRes.records.filter((rec: any) => {
      const status = (rec.fields["Stage"] || rec.fields["Status"] || rec.fields["Deal_Status"] || "").toLowerCase();
      return status !== "killed" && status !== "";
    });

    const filteredDeals = activeDeals.filter((rec: any) => matchOwner(rec.fields, owner));
    const dealIdsSet = new Set(filteredDeals.map(d => d.id));
    const dealRefsSet = new Set(filteredDeals.map(d => String(d.fields["REF No."] || d.fields["Deal_Ref"] || d.id).toLowerCase()));

    // 5. Build Blockers and Workflows
    const blockers: any[] = [];
    const workflows: any[] = [];

    // Stage Distribution (Real Counts only)
    let stageInbound = 0;
    let stageSellerCall = 0;
    let stageImReview = 0;
    let stageDueDiligence = 0;

    filteredDeals.forEach((deal: any) => {
      const dealId = deal.id;
      const dealRef = deal.fields["REF No."] || deal.fields["Deal_Ref"] || dealId;
      const companyName = cleanCompanyName(deal.fields["Deal Name"] || deal.fields["Company_Name"] || deal.fields["Company Name"] || "Unknown Company");
      const normalizedRef = encodeURIComponent(deal.fields["Deal_Ref"] || deal.fields["REF No."] || dealId);

      // Stage Tally
      const currentStageRaw = (deal.fields["Stage"] || deal.fields["Status"] || deal.fields["Deal_Status"] || "").toLowerCase();
      if (["intro", "inbound", "information requested", "information_requested"].includes(currentStageRaw)) {
        stageInbound++;
      } else if (["seller call", "seller_call"].includes(currentStageRaw)) {
        stageSellerCall++;
      } else if (["im review", "im_review", "offer submitted", "offer_submitted"].includes(currentStageRaw)) {
        stageImReview++;
      } else if (["due diligence", "due_diligence", "diligence"].includes(currentStageRaw)) {
        stageDueDiligence++;
      }

      // Check OSINT Workflows
      const osintStatus = deal.fields["OSINT_Status"];
      if (osintStatus) {
        const isProcessing = ["queued", "processing", "Queued", "Scraping Website", "Extracting Metadata", "Analyzing Company", "Generating Risk Profile", "Processing"].includes(osintStatus);
        const isFailed = ["failed", "Failed"].includes(osintStatus) || !!deal.fields["OSINT_Failure_Reason"];
        if (isProcessing || isFailed) {
          workflows.push({
            id: `osint-${dealId}`,
            type: "OSINT Crawl",
            dealId,
            dealRef,
            companyName,
            status: isProcessing ? "processing" : "failed",
            statusText: osintStatus,
            error: deal.fields["OSINT_Failure_Reason"] || null,
            timestamp: deal.fields["OSINT_Started_At"] || deal.fields["OSINT_Completed_At"] || deal.createdTime,
            link: `/deals/${normalizedRef}?tab=overview`
          });
          if (isFailed) {
            blockers.push({
              id: `workflow-failed-osint-${dealId}`,
              type: "WORKFLOW FAILED",
              dealId,
              dealRef,
              companyName,
              title: "OSINT website enrichment failed",
              details: `Reason: ${deal.fields["OSINT_Failure_Reason"] || "Unknown error"}.`,
              link: `/deals/${normalizedRef}?tab=overview`
            });
          }
        }
      }

      // Check Financial Workflows
      const finStatus = deal.fields["Financial_Analysis_Status"];
      if (finStatus) {
        const isProcessing = ["queued", "processing", "analyzing", "Processing"].includes(finStatus);
        const isFailed = ["failed", "Failed"].includes(finStatus) || !!deal.fields["Financial_Anomalies"];
        if (isProcessing || isFailed) {
          workflows.push({
            id: `financial-${dealId}`,
            type: "Financial Analysis",
            dealId,
            dealRef,
            companyName,
            status: isProcessing ? "processing" : "failed",
            statusText: finStatus,
            error: deal.fields["Financial_Anomalies"] || null,
            timestamp: deal.fields["Financial_Completed_At"] || deal.createdTime,
            link: `/deals/${normalizedRef}?tab=financials`
          });
          if (isFailed) {
            blockers.push({
              id: `workflow-failed-fin-${dealId}`,
              type: "WORKFLOW FAILED",
              dealId,
              dealRef,
              companyName,
              title: "Financial model analysis failed",
              details: `Reason: ${deal.fields["Financial_Anomalies"] || "Unknown error"}.`,
              link: `/deals/${normalizedRef}?tab=financials`
            });
          }
        }
      }

      // Check Overdue Task
      const nextActionDate = deal.fields["Next Action Date"];
      const nextActionText = deal.fields["Next Action"];
      if (nextActionDate && nextActionDate < todayStr && nextActionText) {
        blockers.push({
          id: `overdue-action-${dealId}`,
          type: "OVERDUE TASK",
          dealId,
          dealRef,
          companyName,
          title: `Overdue Action: ${cleanAirtableMentions(String(nextActionText).split("\n")[0])}`,
          details: `Deadline was ${nextActionDate}.`,
          link: `/deals/${normalizedRef}?tab=overview`
        });
      }

      // Check SLA SLA breaches - Missing Next Action
      if (!nextActionDate || !nextActionText) {
        blockers.push({
          id: `no-action-${dealId}`,
          type: "SLA BREACH",
          dealId,
          dealRef,
          companyName,
          title: "No next action configured",
          details: "Active deal has no Next Action or target date assigned.",
          link: `/deals/${normalizedRef}?tab=overview`
        });
      }

      // Check SLA breaches - Stalled Progression
      const stageUpdatedAtStr = deal.fields["Stage_Updated_At"];
      if (stageUpdatedAtStr) {
        const stageUpdatedAt = new Date(stageUpdatedAtStr).getTime();
        const ageDays = (Date.now() - stageUpdatedAt) / (1000 * 60 * 60 * 24);
        const stage = (deal.fields["Stage"] || deal.fields["Status"] || deal.fields["Deal_Status"] || "").toUpperCase();
        
        let breachLimit = 999;
        if (stage === "INTRO" || stage === "INBOUND") breachLimit = 7;
        else if (stage === "DISCOVERY" || stage === "SELLER CALL") breachLimit = 14;
        else if (stage === "LOI" || stage === "IM REVIEW") breachLimit = 21;
        
        if (ageDays > breachLimit) {
          blockers.push({
            id: `sla-breach-${dealId}`,
            type: "SLA BREACH",
            dealId,
            dealRef,
            companyName,
            title: `Stalled progression in stage '${deal.fields["Stage"] || deal.fields["Status"] || "Intro"}'`,
            details: `Deal has been in this stage for ${Math.floor(ageDays)} days (limit: ${breachLimit} days).`,
            link: `/deals/${normalizedRef}?tab=overview`
          });
        }
      }
    });

    // Check Documents
    docsRes.records.forEach((doc: any) => {
      const docRefs = doc.fields["Deal_Ref"] || doc.fields["Deal Ref"] || doc.fields["Deal_Reference"];
      const parentDealId = Array.isArray(docRefs) ? docRefs[0] : docRefs;
      
      if (!parentDealId || !dealIdsSet.has(parentDealId)) return;

      const associatedDeal = filteredDeals.find(d => d.id === parentDealId);
      if (!associatedDeal) return;

      const dealRef = associatedDeal.fields["REF No."] || associatedDeal.fields["Deal_Ref"] || parentDealId;
      const companyName = cleanCompanyName(associatedDeal.fields["Deal Name"] || associatedDeal.fields["Company_Name"] || associatedDeal.fields["Company Name"] || "Unknown Company");
      const normalizedRef = encodeURIComponent(associatedDeal.fields["Deal_Ref"] || associatedDeal.fields["REF No."] || parentDealId);

      // Check Missing ABL Critical
      const isCritical = doc.fields["ABL_Critical"] || doc.fields["ABL Critical"] || doc.fields["Critical"];
      const docStatus = (doc.fields["Status"] || doc.fields["status"] || doc.fields["Stage"] || "").toLowerCase();
      const docName = doc.fields["Document_Name"] || doc.fields["Document Name"] || "Document";

      if (isCritical && docStatus === "outstanding") {
        blockers.push({
          id: `missing-abl-${doc.id}`,
          type: "MISSING ABL",
          dealId: parentDealId,
          dealRef,
          companyName,
          title: `Missing Critical ABL: ${docName}`,
          details: `Category: ${doc.fields["Category"] || "General"}. Status is Outstanding.`,
          link: `/deals/${normalizedRef}?tab=documents`
        });
      }

      // Check Overdue checklist item (Expected date in past)
      const expectedDate = doc.fields["Expected_Date"] || doc.fields["Expected Date"];
      if (expectedDate && expectedDate < todayStr && docStatus === "outstanding") {
        blockers.push({
          id: `overdue-dil-${doc.id}`,
          type: "OVERDUE DILIGENCE",
          dealId: parentDealId,
          dealRef,
          companyName,
          title: `Overdue checklist item: ${docName}`,
          details: `Expected by ${expectedDate}. Status: Outstanding.`,
          link: `/deals/${normalizedRef}?tab=documents`
        });
      }

      // Check Doc parsing workflow
      const procStatus = doc.fields["Processing_Status"];
      if (procStatus) {
        const isProcessing = ["queued", "processing", "analyzing", "extracted", "Processing"].includes(procStatus);
        const isFailed = ["failed", "Failed"].includes(procStatus) || !!doc.fields["Processing_Error"];
        if (isProcessing || isFailed) {
          workflows.push({
            id: `doc-parse-${doc.id}`,
            type: "Document Parsing",
            dealId: parentDealId,
            dealRef,
            companyName,
            status: isProcessing ? "processing" : "failed",
            statusText: `${procStatus}: ${docName}`,
            error: doc.fields["Processing_Error"] || null,
            timestamp: doc.fields["Date_Received"] || doc.createdTime,
            link: `/deals/${normalizedRef}?tab=documents`
          });
          if (isFailed) {
            blockers.push({
              id: `workflow-failed-doc-${doc.id}`,
              type: "WORKFLOW FAILED",
              dealId: parentDealId,
              dealRef,
              companyName,
              title: `Document parse failed: ${docName}`,
              details: `Reason: ${doc.fields["Processing_Error"] || "Unknown error"}.`,
              link: `/deals/${normalizedRef}?tab=documents`
            });
          }
        }
      }
    });

    // Check Pre-call briefs
    precallBriefsRes.records.forEach((b: any) => {
      const briefRefs = b.fields["Active_Pipeline"];
      const briefDealId = Array.isArray(briefRefs) ? briefRefs[0] : briefRefs;
      if (!briefDealId) return;

      const associatedDeal = filteredDeals.find(d => 
        d.id === briefDealId || 
        String(d.fields["REF No."] || d.fields["Deal_Ref"]).toLowerCase() === String(briefDealId).toLowerCase()
      );
      if (!associatedDeal) return;

      const dealRef = associatedDeal.fields["REF No."] || associatedDeal.fields["Deal_Ref"] || associatedDeal.id;
      const companyName = cleanCompanyName(associatedDeal.fields["Deal Name"] || associatedDeal.fields["Company_Name"] || associatedDeal.fields["Company Name"] || "Unknown Company");
      const normalizedRef = encodeURIComponent(associatedDeal.fields["Deal_Ref"] || associatedDeal.fields["REF No."] || associatedDeal.id);

      const procStatus = b.fields["Processing_Status"];
      if (procStatus) {
        const isProcessing = ["queued", "processing", "Processing"].includes(procStatus);
        const isFailed = ["failed", "Failed"].includes(procStatus) || !!b.fields["Processing_Error"];
        if (isProcessing || isFailed) {
          workflows.push({
            id: `precall-${b.id}`,
            type: "Pre-call Brief",
            dealId: associatedDeal.id,
            dealRef,
            companyName,
            status: isProcessing ? "processing" : "failed",
            statusText: procStatus,
            error: b.fields["Processing_Error"] || null,
            timestamp: b.fields["Created_At"] || b.createdTime,
            link: `/deals/${normalizedRef}?tab=brief`
          });
          if (isFailed) {
            blockers.push({
              id: `workflow-failed-precall-${b.id}`,
              type: "WORKFLOW FAILED",
              dealId: associatedDeal.id,
              dealRef,
              companyName,
              title: "Pre-call brief generation failed",
              details: `Reason: ${b.fields["Processing_Error"] || "Unknown error"}.`,
              link: `/deals/${normalizedRef}?tab=brief`
            });
          }
        }
      }
    });

    // Check Post-call briefs
    postcallBriefsRes.records.forEach((b: any) => {
      const briefRefs = b.fields["Active_Pipeline"];
      const briefDealId = Array.isArray(briefRefs) ? briefRefs[0] : briefRefs;
      if (!briefDealId) return;

      const associatedDeal = filteredDeals.find(d => 
        d.id === briefDealId || 
        String(d.fields["REF No."] || d.fields["Deal_Ref"]).toLowerCase() === String(briefDealId).toLowerCase()
      );
      if (!associatedDeal) return;

      const dealRef = associatedDeal.fields["REF No."] || associatedDeal.fields["Deal_Ref"] || associatedDeal.id;
      const companyName = cleanCompanyName(associatedDeal.fields["Deal Name"] || associatedDeal.fields["Company_Name"] || associatedDeal.fields["Company Name"] || "Unknown Company");
      const normalizedRef = encodeURIComponent(associatedDeal.fields["Deal_Ref"] || associatedDeal.fields["REF No."] || associatedDeal.id);

      const procStatus = b.fields["Processing_Status"];
      if (procStatus) {
        const isProcessing = ["queued", "processing", "Processing"].includes(procStatus);
        const isFailed = ["failed", "Failed"].includes(procStatus) || !!b.fields["Processing_Error"];
        if (isProcessing || isFailed) {
          workflows.push({
            id: `postcall-${b.id}`,
            type: "Post-call Brief",
            dealId: associatedDeal.id,
            dealRef,
            companyName,
            status: isProcessing ? "processing" : "failed",
            statusText: procStatus,
            error: b.fields["Processing_Error"] || null,
            timestamp: b.fields["Created_At"] || b.createdTime,
            link: `/deals/${normalizedRef}?tab=post-meeting`
          });
          if (isFailed) {
            blockers.push({
              id: `workflow-failed-postcall-${b.id}`,
              type: "WORKFLOW FAILED",
              dealId: associatedDeal.id,
              dealRef,
              companyName,
              title: "Post-call analysis failed",
              details: `Reason: ${b.fields["Processing_Error"] || "Unknown error"}.`,
              link: `/deals/${normalizedRef}?tab=post-meeting`
            });
          }
        }
      }
    });

    // 6. Build Actions Due Today
    const actionsList: any[] = [];
    filteredDeals.forEach(d => {
      const actionDate = d.fields["Next Action Date"];
      const actionText = d.fields["Next Action"];
      
      if (actionDate && actionText) {
        const isOverdue = actionDate < todayStr;
        const isToday = actionDate === todayStr;

        if (isOverdue || isToday) {
          const cleanTitle = cleanAirtableMentions(String(actionText).split("\n")[0]);
          let parsedTitle = cleanTitle;
          const separators = [" — ", " – ", " - ", "—", "–"];
          for (const sep of separators) {
            if (parsedTitle.includes(sep)) {
              const parts = parsedTitle.split(sep).map(p => p.trim());
              if (parts.length > 1) {
                parsedTitle = parts[0];
              }
            }
          }
          if (parsedTitle.includes("|")) {
            parsedTitle = parsedTitle.split("|")[0].trim();
          }

          let initials = "AYO";
          const collabs = d.fields["Collaborator"];
          if (Array.isArray(collabs) && collabs.length > 0) {
            const name = String(collabs[0]?.name || "");
            if (name.toLowerCase().includes("dami")) {
              initials = "DAMI";
            } else if (name.toLowerCase().includes("chante")) {
              initials = "CHANTE";
            } else if (name.toLowerCase().includes("prince")) {
              initials = "PRINCE";
            }
          }

          const dateObj = new Date(actionDate);
          const formattedDate = dateObj.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

          const companyClean = cleanCompanyName(String(d.fields["Company_Name"] || d.fields["Company Name"] || d.fields["Deal Name"] || d.fields["REF No."] || d.fields["Deal_Ref"] || ""));
          const finalTitle = (parsedTitle && parsedTitle.toLowerCase() !== companyClean.toLowerCase())
            ? `${parsedTitle} — ${companyClean}`
            : companyClean;

          actionsList.push({
            id: d.id,
            color: isOverdue ? "red" : "yellow",
            title: finalTitle,
            dealRef: d.fields["REF No."] || d.fields["Deal_Ref"] || "ACP-CFS",
            assignee: initials,
            statusText: isOverdue ? "OVERDUE" : "DUE TODAY",
            dateStr: isToday ? "deadline today" : `deadline ${formattedDate}`,
            link: `/deals/${encodeURIComponent(d.fields["Deal_Ref"] || d.fields["REF No."] || d.id)}?tab=overview`
          });
        }
      }
    });

    // 7. Compile Recent Activities
    const allActivities: any[] = [];

    // Stage history
    activityRes.records.forEach((r: any) => {
      const dealId = Array.isArray(r.fields.Deal_ID) ? r.fields.Deal_ID[0] : r.fields.Deal_ID;
      if (!dealId || !dealIdsSet.has(dealId)) return;

      const fromStage = r.fields.From_Stage_Label || r.fields.From_Stage || "—";
      const toStage = r.fields.To_Stage_Label || r.fields.To_Stage || "—";
      const actualDeal = filteredDeals.find(d => d.id === dealId);
      const dealRef = actualDeal?.fields["REF No."] || actualDeal?.fields["Deal_Ref"] || r.fields.Deal_Ref || "ACP-CFS";

      allActivities.push({
        id: `stage-${r.id}`,
        type: "stage_transition",
        title: `${fromStage} → ${toStage}`,
        detail: r.fields.Notes || undefined,
        dealId,
        dealRef,
        companyName: r.fields.Company_Name || actualDeal?.fields["Company Name"] || actualDeal?.fields["Deal Name"] || undefined,
        changedBy: r.fields.Changed_By || "Admin",
        timestamp: r.fields.Changed_At || r.createdTime,
        color: "bronze",
        icon: "arrow-right",
        link: `/deals/${encodeURIComponent(dealRef)}?tab=overview`
      });
    });

    // Document uploads
    docsRes.records.forEach((r: any) => {
      const docRefs = r.fields.Deal_Ref || r.fields["Deal Ref"] || r.fields["Deal_Reference"];
      const dealId = Array.isArray(docRefs) ? docRefs[0] : docRefs;
      if (!dealId || !dealIdsSet.has(dealId)) return;

      const actualDeal = filteredDeals.find(d => d.id === dealId);
      const dealRef = actualDeal?.fields["REF No."] || actualDeal?.fields["Deal_Ref"] || "ACP-CFS";

      const name = r.fields.Document_Name || r.fields["Document Name"] || "Document";
      const category = r.fields.Category || "";
      const company = r.fields.Company_Name || actualDeal?.fields["Company Name"] || actualDeal?.fields["Deal Name"] || "";

      allActivities.push({
        id: `doc-${r.id}`,
        type: "document_uploaded",
        title: `Document uploaded: ${name}`,
        detail: category || undefined,
        dealId,
        dealRef,
        companyName: company || undefined,
        timestamp: r.fields.Date_Received || r.createdTime,
        color: "blue",
        icon: "file",
        link: `/deals/${encodeURIComponent(dealRef)}?tab=documents`
      });
    });

    // Pre-call briefs
    precallBriefsRes.records.forEach((r: any) => {
      const briefRefs = r.fields["Active_Pipeline"];
      const briefDealId = Array.isArray(briefRefs) ? briefRefs[0] : briefRefs;
      if (!briefDealId) return;

      const actualDeal = filteredDeals.find(d => 
        d.id === briefDealId || 
        String(d.fields["REF No."] || d.fields["Deal_Ref"]).toLowerCase() === String(briefDealId).toLowerCase()
      );
      if (!actualDeal) return;

      const dealRef = actualDeal.fields["REF No."] || actualDeal.fields["Deal_Ref"] || "ACP-CFS";

      allActivities.push({
        id: `precall-${r.id}`,
        type: "brief_completed",
        title: "Pre-call brief completed",
        detail: r.fields.Summary?.slice(0, 80) || undefined,
        dealId: actualDeal.id,
        dealRef,
        companyName: cleanCompanyName(actualDeal.fields["Deal Name"] || actualDeal.fields["Company_Name"] || actualDeal.fields["Company Name"]),
        changedBy: "Claude AI",
        timestamp: r.fields.Created_At || r.createdTime,
        color: "emerald",
        icon: "brain",
        link: `/deals/${encodeURIComponent(dealRef)}?tab=brief`
      });
    });

    // Post-call briefs
    postcallBriefsRes.records.forEach((r: any) => {
      const briefRefs = r.fields["Active_Pipeline"];
      const briefDealId = Array.isArray(briefRefs) ? briefRefs[0] : briefRefs;
      if (!briefDealId) return;

      const actualDeal = filteredDeals.find(d => 
        d.id === briefDealId || 
        String(d.fields["REF No."] || d.fields["Deal_Ref"]).toLowerCase() === String(briefDealId).toLowerCase()
      );
      if (!actualDeal) return;

      const dealRef = actualDeal.fields["REF No."] || actualDeal.fields["Deal_Ref"] || "ACP-CFS";
      const score = r.fields.Score || r.fields.Deal_Score;

      allActivities.push({
        id: `postcall-${r.id}`,
        type: "brief_completed",
        title: `Post-call brief completed${score ? ` — ${score}/50` : ""}`,
        detail: r.fields.Summary?.slice(0, 80) || undefined,
        dealId: actualDeal.id,
        dealRef,
        companyName: cleanCompanyName(actualDeal.fields["Deal Name"] || actualDeal.fields["Company_Name"] || actualDeal.fields["Company Name"]),
        changedBy: "Claude AI",
        timestamp: r.fields.Created_At || r.createdTime,
        color: "emerald",
        icon: "brain",
        link: `/deals/${encodeURIComponent(dealRef)}?tab=post-meeting`
      });
    });

    // Sort descending
    allActivities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const recentActivity = allActivities.slice(0, 4);

    // 8. Compile the consolidated payload
    return res.status(200).json({
      success: true,
      owner,
      uniqueOwners,
      activePipelineCount: filteredDeals.length,
      pendingActionsCount: filteredDeals.filter(d => d.fields["Next Action Date"]).length,
      blockedDealsCount: blockers.length,
      activeWorkflowsCount: workflows.filter(w => w.status === "processing").length,
      blockersQueue: blockers,
      activeWorkflows: workflows,
      actionsDueToday: actionsList,
      recentActivity,
      stageDistribution: {
        inbound: stageInbound,
        sellerCall: stageSellerCall,
        imReview: stageImReview,
        dueDiligence: stageDueDiligence
      }
    });

  } catch (err: any) {
    console.error("[Dashboard Stats API Error] ", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error"
    });
  }
}
