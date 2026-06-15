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
    // 2. Fetch all required tables in parallel (omitting Precall/Postcall briefs to speed up fetch)
    const [dealsRes, docsRes, historyRes] = await Promise.all([
      airtableFetchAll(TABLES.PIPELINE).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.DOCUMENTS).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.STAGE_HISTORY, {
        sort: [{ field: "Changed_At", direction: "desc" }],
        maxRecords: 30
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

    // 5. Compute Deals in Due Diligence
    const ddDealsCount = filteredDeals.filter((rec: any) => {
      const stage = (rec.fields["Stage"] || rec.fields["Status"] || rec.fields["Deal_Status"] || "").toLowerCase();
      return ["due diligence", "due_diligence", "diligence"].includes(stage);
    }).length;

    // 6. Build Recent Deal Movements Feed (Transitions & Doc Uploads)
    const movements: any[] = [];

    // Map stage transitions from historyRes
    for (const r of (historyRes?.records || [])) {
      const histDealId = Array.isArray(r.fields.Deal_ID) ? r.fields.Deal_ID[0] : r.fields.Deal_ID;
      if (!histDealId) continue;
      
      const deal = filteredDeals.find(d => d.id === histDealId);
      if (!deal) continue;

      const toStage = r.fields.To_Stage || "";
      const toLabel = r.fields.To_Stage_Label || toStage || "—";
      const companyName = cleanCompanyName(deal.fields["Deal Name"] || deal.fields["Company_Name"] || deal.fields["Company Name"] || "Unknown Company");
      const dealRef = deal.fields["REF No."] || deal.fields["Deal_Ref"] || "ACP-CFS";
      const normalizedRef = encodeURIComponent(deal.fields["Deal_Ref"] || deal.fields["REF No."] || deal.id);

      movements.push({
        id: `transition-${r.id}`,
        type: "transition",
        title: `${companyName} moved to ${toLabel}`,
        detail: r.fields.Notes ? cleanAirtableMentions(String(r.fields.Notes)) : `Stage change by ${r.fields.Changed_By || "operator"}`,
        dealId: histDealId,
        dealRef,
        companyName,
        changedBy: r.fields.Changed_By || "System",
        timestamp: r.fields.Changed_At || r.createdTime,
        link: `/deals/${normalizedRef}?tab=overview`
      });
    }

    // Map recent document uploads
    docsRes.records.forEach((doc: any) => {
      const docRefs = doc.fields["Deal_Ref"] || doc.fields["Deal Ref"] || doc.fields["Deal_Reference"];
      const parentDealId = Array.isArray(docRefs) ? docRefs[0] : docRefs;
      if (!parentDealId) return;

      const deal = filteredDeals.find(d => d.id === parentDealId);
      if (!deal) return;

      const docName = doc.fields["Document_Name"] || doc.fields["Document Name"] || "Document";
      const companyName = cleanCompanyName(deal.fields["Deal Name"] || deal.fields["Company_Name"] || deal.fields["Company Name"] || "Unknown Company");
      const dealRef = deal.fields["REF No."] || deal.fields["Deal_Ref"] || "ACP-CFS";
      const normalizedRef = encodeURIComponent(deal.fields["Deal_Ref"] || deal.fields["REF No."] || deal.id);
      const dateReceived = doc.fields["Date_Received"] || doc.createdTime;

      movements.push({
        id: `doc-${doc.id}`,
        type: "document",
        title: `Document uploaded: ${docName}`,
        detail: doc.fields.Category || "Ingested into Deal Room",
        dealId: parentDealId,
        dealRef,
        companyName,
        changedBy: "System",
        timestamp: dateReceived,
        link: `/deals/${normalizedRef}?tab=documents`
      });
    });

    // Sort combined feed by timestamp descending
    movements.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const recentMovements = movements.slice(0, 7);

    // 7. Build Critical Business Blockers
    const criticalBlockers: any[] = [];

    // Outstanding critical documents
    docsRes.records.forEach((doc: any) => {
      const isAblCritical = doc.fields["ABL_Critical"] || doc.fields["ABL Critical"] || doc.fields["abl_critical"] || doc.fields["Critical"];
      const status = doc.fields["Status"] || doc.fields["status"];
      if (isAblCritical && status === "Outstanding") {
        const docRefs = doc.fields["Deal_Ref"] || doc.fields["Deal Ref"] || doc.fields["Deal_Reference"];
        const parentDealId = Array.isArray(docRefs) ? docRefs[0] : docRefs;
        if (!parentDealId) return;

        const deal = filteredDeals.find(d => d.id === parentDealId);
        if (!deal) return;

        const docName = doc.fields["Document_Name"] || doc.fields["Document Name"] || "Document";
        const companyName = cleanCompanyName(deal.fields["Deal Name"] || deal.fields["Company_Name"] || deal.fields["Company Name"] || "Unknown Company");
        const dealRef = deal.fields["REF No."] || deal.fields["Deal_Ref"] || "ACP-CFS";
        const normalizedRef = encodeURIComponent(deal.fields["Deal_Ref"] || deal.fields["REF No."] || deal.id);

        criticalBlockers.push({
          id: `blocker-doc-${doc.id}`,
          type: "document",
          title: "Missing Critical Document",
          description: `${docName} is outstanding for ${companyName}`,
          dealId: parentDealId,
          dealRef,
          companyName,
          link: `/deals/${normalizedRef}?tab=documents`
        });
      }
    });

    // Overdue actions
    filteredDeals.forEach((d: any) => {
      const actionDate = d.fields["Next Action Date"];
      const actionText = d.fields["Next Action"];
      if (actionDate && actionDate < todayStr && actionText) {
        const companyName = cleanCompanyName(d.fields["Deal Name"] || d.fields["Company_Name"] || d.fields["Company Name"] || "Unknown Company");
        const dealRef = d.fields["REF No."] || d.fields["Deal_Ref"] || "ACP-CFS";
        const normalizedRef = encodeURIComponent(d.fields["Deal_Ref"] || d.fields["REF No."] || d.id);

        criticalBlockers.push({
          id: `blocker-action-${d.id}`,
          type: "action",
          title: "Overdue Action Deadline",
          description: `${cleanAirtableMentions(String(actionText).split("\n")[0])}`,
          dealId: d.id,
          dealRef,
          companyName,
          link: `/deals/${normalizedRef}?tab=overview`
        });
      }
    });

    // 8. Build Stage Distribution
    let stageInbound = 0;
    let stageSellerCall = 0;
    let stageImReview = 0;
    let stageDueDiligence = 0;

    filteredDeals.forEach((deal: any) => {
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
    });

    // 9. Build Actions Due Today
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

    // 10. Compile the consolidated payload
    return res.status(200).json({
      success: true,
      owner,
      uniqueOwners,
      activePipelineCount: filteredDeals.length,
      pendingActionsCount: filteredDeals.filter(d => d.fields["Next Action Date"]).length,
      ddDealsCount,
      recentMovements,
      criticalBlockers,
      actionsDueToday: actionsList,
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
