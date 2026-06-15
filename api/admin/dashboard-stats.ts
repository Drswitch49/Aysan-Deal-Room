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
    const [dealsRes, docsRes, historyRes, assignmentsRes, lendersRes] = await Promise.all([
      airtableFetchAll(TABLES.PIPELINE).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.DOCUMENTS).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.STAGE_HISTORY, {
        sort: [{ field: "Changed_At", direction: "desc" }],
        maxRecords: 30
      }).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.ASSIGNMENTS).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.LENDERS).catch(() => ({ records: [] }))
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

    // 6. Build Recent Deal Movements Feed (Business Milestones Only)
    const derivedMilestones: any[] = [];

    filteredDeals.forEach((deal: any) => {
      const fields = deal.fields;
      const createdTime = deal.createdTime;
      const companyName = cleanCompanyName(fields["Deal Name"] || fields["Company Name"] || "Unknown Company");
      const dealRef = fields["REF No."] || fields["Deal_Ref"] || "ACP-CFS";
      const normalizedRef = encodeURIComponent(fields["Deal_Ref"] || fields["REF No."] || deal.id);
      
      const createdDate = new Date(createdTime);
      const ownerName = Array.isArray(fields["Collaborator"]) ? fields["Collaborator"][0]?.name : null;

      // Milestone 1: Deal Registered
      derivedMilestones.push({
        id: `derived-created-${deal.id}`,
        type: "deal_created",
        title: `Deal registered: ${companyName}`,
        detail: `Added to pipeline in Intro stage`,
        dealId: deal.id,
        dealRef,
        companyName,
        timestamp: createdTime,
        link: `/deals/${normalizedRef}?tab=overview`
      });

      // Milestone 2: Deal Assigned
      if (ownerName) {
        const assignedTime = new Date(createdDate.getTime() + 60 * 60 * 1000).toISOString(); // 1 hour later
        derivedMilestones.push({
          id: `derived-assigned-${deal.id}`,
          type: "deal_assigned",
          title: `Deal assigned to ${ownerName}`,
          detail: `Lead assignment updated for ${companyName}`,
          dealId: deal.id,
          dealRef,
          companyName,
          timestamp: assignedTime,
          link: `/deals/${normalizedRef}?tab=overview`
        });
      }

      const stage = (fields["Stage"] || "").toLowerCase();

      // Milestone 3: Deal Archived
      if (stage === "killed" || stage === "archived") {
        let archiveTime = createdTime;
        const nextActionText = String(fields["Next Action"] || "");
        const dateMatch = nextActionText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (dateMatch) {
          const d = new Date(Number(dateMatch[3]), Number(dateMatch[2]) - 1, Number(dateMatch[1]));
          if (!isNaN(d.getTime())) archiveTime = d.toISOString();
        }
        derivedMilestones.push({
          id: `derived-archived-${deal.id}`,
          type: "deal_archived",
          title: `Deal archived: ${companyName}`,
          detail: `Transaction parked or killed`,
          dealId: deal.id,
          dealRef,
          companyName,
          timestamp: archiveTime,
          link: `/deals/${normalizedRef}?tab=overview`
        });
      }

      // Milestone 4: LOI Sent / Submitted
      if (["offer submitted", "offer_submitted", "loi"].includes(stage)) {
        const sentTime = new Date(createdDate.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
        derivedMilestones.push({
          id: `derived-loi-sent-${deal.id}`,
          type: "loi_sent",
          title: `LOI submitted for ${companyName}`,
          detail: `Letter of Intent sent to broker / seller`,
          dealId: deal.id,
          dealRef,
          companyName,
          timestamp: sentTime,
          link: `/deals/${normalizedRef}?tab=loi`
        });
      }

      // Milestone 5: Due Diligence Started
      if (["due diligence", "due_diligence", "diligence"].includes(stage)) {
        const ddTime = new Date(createdDate.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();
        derivedMilestones.push({
          id: `derived-dd-started-${deal.id}`,
          type: "dd_started",
          title: `Due Diligence started: ${companyName}`,
          detail: `Checklist audit commenced`,
          dealId: deal.id,
          dealRef,
          companyName,
          timestamp: ddTime,
          link: `/deals/${normalizedRef}?tab=documents`
        });
      }

      // Milestone 6: Due Diligence Completed / Closing
      if (["closing", "portfolio"].includes(stage)) {
        const closeTime = new Date(createdDate.getTime() + 20 * 24 * 60 * 60 * 1000).toISOString();
        derivedMilestones.push({
          id: `derived-dd-completed-${deal.id}`,
          type: "dd_completed",
          title: `Due Diligence completed: ${companyName}`,
          detail: `All checklist critical items approved`,
          dealId: deal.id,
          dealRef,
          companyName,
          timestamp: closeTime,
          link: `/deals/${normalizedRef}?tab=overview`
        });
      }

      // Check linked documents for IM received or LOI drafted
      const dealDocs = docsRes.records.filter((docItem: any) => {
        const refs = docItem.fields["Deal_Ref"] || docItem.fields["Deal Ref"] || docItem.fields["Deal_Reference"] || [];
        return Array.isArray(refs) ? refs.includes(deal.id) : refs === deal.id;
      });
      const hasIm = dealDocs.some((d: any) => {
        const name = (d.fields["Document_Name"] || d.fields["Document Name"] || "").toLowerCase();
        const cat = (d.fields["Category"] || "").toLowerCase();
        return name.includes("im") || name.includes("information memorandum") || cat.includes("commercial") || cat.includes("financial");
      });

      if (hasIm) {
        const imTime = new Date(createdDate.getTime() + 2 * 60 * 60 * 1000).toISOString();
        derivedMilestones.push({
          id: `derived-im-received-${deal.id}`,
          type: "im_received",
          title: `IM received for ${companyName}`,
          detail: `Information Memorandum ingested`,
          dealId: deal.id,
          dealRef,
          companyName,
          timestamp: imTime,
          link: `/deals/${normalizedRef}?tab=documents`
        });
      }

      // Check lender assignments for "Lender engaged"
      const dealAssignments = assignmentsRes.records.filter((asg: any) => {
        const refs = asg.fields["Deal_Ref"] || asg.fields["Deal Ref"] || asg.fields["Deal_Reference"] || [];
        return Array.isArray(refs) ? refs.includes(deal.id) : refs === deal.id;
      });

      dealAssignments.forEach((asg: any) => {
        const lenderLink = asg.fields["Lender_ID"] || asg.fields["Lender ID"] || asg.fields["Lender"] || [];
        const lenderRecId = Array.isArray(lenderLink) ? lenderLink[0] : lenderLink;
        if (!lenderRecId) return;

        const lender = lendersRes.records.find((l: any) => l.id === lenderRecId);
        const lenderName = lender ? (lender.fields["Company_Name"] || lender.fields["Company Name"] || "Lender") : "Lender";
        
        const engagedTime = asg.createdTime || new Date(createdDate.getTime() + 4 * 60 * 60 * 1000).toISOString();
        derivedMilestones.push({
          id: `derived-lender-engaged-${asg.id}`,
          type: "lender_engaged",
          title: `Lender engaged: ${lenderName}`,
          detail: `Assigned to review ${companyName}`,
          dealId: deal.id,
          dealRef,
          companyName,
          timestamp: engagedTime,
          link: `/deals/${normalizedRef}?tab=chat`
        });
      });
    });

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

      derivedMilestones.push({
        id: `transition-${r.id}`,
        type: "stage_transition",
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

    // Sort combined feed by timestamp descending
    derivedMilestones.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    // De-duplicate derived milestones for the same stage/type per deal to avoid clutter
    const seenMovements = new Set<string>();
    const recentMovements: any[] = [];
    for (const m of derivedMilestones) {
      const key = `${m.dealId}-${m.type}`;
      if (!seenMovements.has(key)) {
        seenMovements.add(key);
        recentMovements.push(m);
      }
      if (recentMovements.length >= 7) break;
    }

    // Calculate LOI Tracker Counts
    let loiDrafting = 0;
    let loiSent = 0;
    let awaitingResponse = 0;
    let loiAccepted = 0;
    let loiDeclined = 0;

    dealsRes.records.forEach((rec: any) => {
      const dealFields = rec.fields;
      if (!matchOwner(dealFields, owner)) return;

      const stage = (dealFields["Stage"] || "").toLowerCase();
      const nextAction = (dealFields["Next Action"] || "").toLowerCase();
      const hasLoiDraft = !!dealFields["LOI Draft"];

      if (stage === "killed") {
        const wasOffered = historyRes.records.some((h: any) => {
          const histDealId = Array.isArray(h.fields.Deal_ID) ? h.fields.Deal_ID[0] : h.fields.Deal_ID;
          return histDealId === rec.id && (String(h.fields.To_Stage).toLowerCase() === "offer submitted" || String(h.fields.To_Stage).toLowerCase() === "loi");
        });
        const hasDeclineMention = nextAction.includes("decline") || nextAction.includes("reject") || nextAction.includes("turned down");
        
        if (wasOffered || hasDeclineMention) {
          loiDeclined++;
        }
      } else if (["due diligence", "due_diligence", "diligence", "closing", "portfolio"].includes(stage)) {
        loiAccepted++;
      } else if (["offer submitted", "offer_submitted", "loi"].includes(stage)) {
        if (nextAction.includes("awaiting") || nextAction.includes("wait") || nextAction.includes("seller")) {
          awaitingResponse++;
        } else {
          loiSent++;
        }
      } else if (["im review", "im_review", "ic decision", "ic_decision", "information requested", "information_requested"].includes(stage) || hasLoiDraft) {
        loiDrafting++;
      }
    });

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
      loiTracker: {
        drafting: loiDrafting,
        sent: loiSent,
        awaitingResponse: awaitingResponse,
        accepted: loiAccepted,
        declined: loiDeclined
      },
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
