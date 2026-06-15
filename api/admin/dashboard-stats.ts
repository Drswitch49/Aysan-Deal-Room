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
    // 2. Fetch all required tables in parallel (omitting STAGE_HISTORY)
    const [dealsRes, docsRes, precallBriefsRes, postcallBriefsRes] = await Promise.all([
      airtableFetchAll(TABLES.PIPELINE).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.DOCUMENTS).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.PRECALL_BRIEFS).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.POSTCALL_BRIEFS).catch(() => ({ records: [] }))
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

    // 5. Build Workflows
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

      const docName = doc.fields["Document_Name"] || doc.fields["Document Name"] || "Document";

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

    // 7. Compile the consolidated payload
    return res.status(200).json({
      success: true,
      owner,
      uniqueOwners,
      activePipelineCount: filteredDeals.length,
      pendingActionsCount: filteredDeals.filter(d => d.fields["Next Action Date"]).length,
      blockedDealsCount: 0,
      activeWorkflowsCount: workflows.filter(w => w.status === "processing").length,
      blockersQueue: [],
      activeWorkflows: workflows,
      actionsDueToday: actionsList,
      recentActivity: [],
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
