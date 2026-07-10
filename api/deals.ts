import { airtableFetchAll } from "../src/lib/airtable/client.js";
import { TABLES } from "../src/lib/airtable/schema.js";
import { mapPipelineDeal, mapDocument, mapSubmissionLogEntry } from "../src/lib/airtable/mapper.js";
import { authenticateAdmin } from "./admin/lenders.js";
import { airtableCreate, airtableUpdate, airtableDelete } from "./_utils/airtable.js";

async function migrateKilledDeals(killedRecords: any[]) {
  for (const record of killedRecords) {
    const f = record.fields;
    const inboxFields: any = {
      "REF. NO": f["ACP REF NO"] || f["Deal_Ref"] || f["REF No."] || "",
      "Deal Name": f["Deal Name"] || "Unknown Deal",
      "Company Name": f["Company_Name"] || f["Company Name"] || f["Deal Name"] || "",
      "Sector": f["Industry"] || f["Sector"] || "",
      "Location": f["Location"] || "",
      "BROKER": f["Broker_Name"] || f["Broker"] || "",
      "Status": "Kill",
      "Summary": f["Executive_Summary"] || f["Summary"] || "",
      "Description": f["Business_Description"] || f["Description"] || "",
      "EBITDA_GBP": f["EBITDA_GBP"] || f["EBITDA"] || undefined,
      "Turnover": f["Turnover"] || f["Revenue"] || undefined,
      "Asking_Price_GBP": f["Asking_Price_GBP"] || f["Asking Price"] || undefined,
      "Enterprise_Value": f["Enterprise_Value"] || undefined,
      "Contact_Name": f["Broker_Name"] || f["Contact_Name"] || "",
      "Contact_Email": f["Broker_Email"] || f["Contact_Email"] || f["Contact Email"] || "",
      "Contact_Phone": f["Broker_Phone"] || f["Contact_Phone"] || f["Contact Phone"] || "",
      "Source": f["Source"] || "Active Pipeline",
    };

    if (f["IM_Review_Documents"]) inboxFields["IM_Review_Documents"] = f["IM_Review_Documents"];
    if (f["Attachments"]) inboxFields["Attachments"] = f["Attachments"];

    try {
      await airtableCreate(TABLES.DEAL_INBOX, inboxFields);
      await airtableDelete(TABLES.PIPELINE, record.id);
      console.log(`[Migration] Successfully migrated killed deal ${record.id} to Inbox.`);
    } catch (err) {
      console.error(`[Migration] Failed to migrate killed deal ${record.id}:`, err);
    }
  }
}

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

// In-memory cache variables for server warm starts
interface CacheEntry {
  timestamp: number;
  data: any;
}

const cache: Record<string, CacheEntry> = {};
const CACHE_TTL_MS = 60000; // 60 seconds

export default async function handler(req: any, res: any) {
  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { type, ref } = req.query || {};

  const userRole = (req.headers["x-user-role"] || "").toLowerCase();
  if (userRole === "hr") {
    return res.status(403).json({ error: "Forbidden: HR users are restricted from accessing Deals." });
  }

  try {
    // 1. Admin authentication check for sensitive Deal Inbox access or modification
    if (type === "inbox" || req.method === "POST" || req.method === "PATCH") {
      await authenticateAdmin(req);
    }

    if (req.method === "POST" || req.method === "PATCH") {
      const body = req.body || {};
      const targetTable = type === "inbox" ? TABLES.DEAL_INBOX : TABLES.PIPELINE;
      
      if (req.method === "POST") {
        const result = await airtableCreate(targetTable, body.fields);
        return res.status(200).json({ success: true, record: result });
      } else if (req.method === "PATCH") {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: "Record ID required for PATCH" });
        const result = await airtableUpdate(targetTable, id, body.fields);
        return res.status(200).json({ success: true, record: result });
      }
    }

    // Determine target table and mapping logic
    let tableName = TABLES.PIPELINE;
    let mapper: (id: string, fields: any) => any = mapPipelineDeal;
    let cacheKey = "deals";

    if (type === "documents") {
      tableName = TABLES.DOCUMENTS;
      mapper = mapDocument;
      cacheKey = "documents";
    } else if (type === "submissions") {
      tableName = TABLES.SUBMISSIONS;
      mapper = mapSubmissionLogEntry;
      cacheKey = "submissions";
    } else if (type === "inbox") {
      tableName = TABLES.DEAL_INBOX;
      cacheKey = "inbox";
    }

    // 1.5. Resolve deal reference to record ID if ref is provided
    let targetDealId: string | null = null;
    if (ref) {
      let pipelineDeals: any[] = [];
      const cachedDeals = cache["deals"];
      if (cachedDeals && Date.now() - cachedDeals.timestamp < CACHE_TTL_MS) {
        pipelineDeals = cachedDeals.data;
      } else {
        const responseDeals = await airtableFetchAll(TABLES.PIPELINE);
        const recordsToMigrate = responseDeals.records.filter((rec: any) => {
          const stage = String(rec.fields?.["Stage"] || rec.fields?.["Status"] || "").toLowerCase();
          return stage === "killed" || stage === "dead";
        });
        if (recordsToMigrate.length > 0) {
          await migrateKilledDeals(recordsToMigrate);
          const refetchedDeals = await airtableFetchAll(TABLES.PIPELINE);
          responseDeals.records = refetchedDeals.records;
        }
        pipelineDeals = responseDeals.records.map((rec: any) => mapPipelineDeal(rec.id, rec.fields));
        cache["deals"] = {
          timestamp: Date.now(),
          data: pipelineDeals
        };
      }

      const normalizeRef = (s: string) => {
        return s
          .toLowerCase()
          .replace(/[\u2014\u2013\u2212-]/g, "-") // normalize all dash characters to hyphen
          .replace(/\s+/g, " ")                  // normalize spaces
          .trim();
      };
      
      const normalizedQueryRef = normalizeRef(String(ref));
      
      const matchedDeal = pipelineDeals.find((d: any) => {
        const dRef = d.dealRef || "";
        // 1. Direct exact match
        if (dRef.toLowerCase() === String(ref).toLowerCase()) return true;
        // 2. Normalized string match
        if (normalizeRef(dRef) === normalizedQueryRef) return true;
        // 3. Match by ID directly
        if (d.id.toLowerCase() === String(ref).toLowerCase()) return true;
        // 4. Extract prefix match (e.g. ACP-CFS-002)
        const getPrefix = (str: string) => {
          const parts = str.split(/\s*[|—–]\s*|\s+-\s+/);
          return parts[0] ? parts[0].trim().toLowerCase() : "";
        };
        const prefixD = getPrefix(dRef);
        const prefixQ = getPrefix(String(ref));
        if (prefixD && prefixQ && prefixD === prefixQ) return true;
        
        return false;
      });

      if (matchedDeal) {
        targetDealId = matchedDeal.id;
      }
    }

    // 2. Serve from in-memory cache if valid
    const skipCache = req.query?.forceRefresh === "true";
    const cached = cache[cacheKey];
    if (!skipCache && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      // If client requested a specific deal reference, filter on the fly
      if (ref) {
        const filtered = filterResults(cached.data, type, ref, targetDealId);
        return res.status(200).json(filtered);
      }
      
      // Apply Edge CDN headers for read-heavy operations (except admin inbox)
      if (type !== "inbox") {
        res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=30");
      }
      return res.status(200).json(cached.data);
    }

    // 3. Fetch from Airtable client
    let results: any[];
    if (!type) {
      // Perform server-side joins & enrichments
      const [dealsRes, inboxRes, docsRes, precallBriefsRes, postcallBriefsRes] = await Promise.all([
        airtableFetchAll(TABLES.PIPELINE),
        airtableFetchAll(TABLES.DEAL_INBOX).catch(() => ({ records: [] })),
        airtableFetchAll(TABLES.DOCUMENTS).catch(() => ({ records: [] })),
        airtableFetchAll(TABLES.PRECALL_BRIEFS).catch(() => ({ records: [] })),
        airtableFetchAll(TABLES.POSTCALL_BRIEFS).catch(() => ({ records: [] }))
      ]);

      let dealsRecords = dealsRes.records;
      const recordsToMigrate = dealsRecords.filter((rec: any) => {
        const stage = String(rec.fields?.["Stage"] || rec.fields?.["Status"] || "").toLowerCase();
        return stage === "killed" || stage === "dead";
      });
      if (recordsToMigrate.length > 0) {
        await migrateKilledDeals(recordsToMigrate);
        const refetchedDeals = await airtableFetchAll(TABLES.PIPELINE);
        dealsRecords = refetchedDeals.records;
      }

      const inbox = inboxRes.records.map((rec: any) => ({ id: rec.id, fields: rec.fields }));
      const docs = docsRes.records;
      const precallBriefs = precallBriefsRes.records;
      const postcallBriefs = postcallBriefsRes.records;
      const todayStr = new Date().toISOString().split("T")[0];

      results = dealsRecords.map((rec: any) => {
        const deal = mapPipelineDeal(rec.id, rec.fields);
        
        // Find matching Deal_Inbox record
        const inboxRec = inbox.find((i: any) => {
          const dealInboxLinks = rec.fields["Deal_Inbox"] as any;
          return (dealInboxLinks && 
           Array.isArray(dealInboxLinks) && 
           dealInboxLinks.includes(i.id)) ||
          (i.fields["REF. NO"] && 
           deal.dealRef && 
           String(i.fields["REF. NO"]).toLowerCase() === String(deal.dealRef).toLowerCase());
        });

        const inboxFields = inboxRec ? inboxRec.fields : {};

        // Financial & location fields
        const revenue = inboxFields["Turnover"] || rec.fields["Turnover"] || "";
        const ebitda = inboxFields["EBITDA_GBP"] || rec.fields["EBITDA_GBP"] || "";
        const evAsk = inboxFields["Asking_Price_GBP"] || rec.fields["Asking_Price_GBP"] || rec.fields["EV"] || "";
        const multiplier = inboxFields["EV Multiple"] || rec.fields["EV Multiple"] || rec.fields["EV"] || "";
        const sector = inboxFields["Sector"] || deal.sector || "General";
        const location = inboxFields["Location"] || deal.location || "UK";

        // Collaborator details
        let ownerName = "Unassigned";
        let ownerInitials = "??";
        const collabs = rec.fields["Collaborator"] as any;
        const rawOwner = rec.fields["Owner"] as any;
        if (collabs && Array.isArray(collabs) && collabs.length > 0) {
          ownerName = String(collabs[0]?.name || "Unassigned");
        } else if (rawOwner) {
          ownerName = typeof rawOwner === "string" ? rawOwner : String(rawOwner.name || "Unassigned");
        }
        
        if (ownerName !== "Unassigned") {
          if (ownerName.includes("Ayodeji") || ownerName.includes("Ayo")) {
            ownerName = "Ayo";
          } else if (ownerName.toLowerCase().includes("dami") || ownerName.toLowerCase().includes("dallience")) {
            ownerName = "Dami";
          } else if (ownerName.toLowerCase().includes("chante")) {
            ownerName = "Chante";
          } else if (ownerName.toLowerCase().includes("prince")) {
            ownerName = "Prince";
          }
          ownerInitials = ownerName.slice(0, 2).toUpperCase();
        }

        // Next Action details
        const actionDate = rec.fields["Next Action Date"];
        const actionText = rec.fields["Next Action"];
        let nextActionTitle = "Missing next action details";
        let nextActionSub = "Assign action items immediately";
        let nextActionColor = "red";
        
        if (actionDate && actionText) {
          const isOverdue = actionDate < todayStr;
          const isToday = actionDate === todayStr;

          nextActionTitle = cleanAirtableMentions(String(actionText).split("\n")[0].split("|")[0].split("—")[0].trim());
          nextActionSub = isOverdue ? "Urgent focus" : isToday ? "Update today" : "Awaiting callback";
          nextActionColor = isOverdue ? "red" : isToday ? "yellow" : "blue";
        }

        // Calculate Deal Readiness (replacing blockers)
        const dealDocs = docs.filter((d: any) => {
          const refs = d.fields["Deal_Ref"] || d.fields["Deal Ref"] || d.fields["Deal_Reference"];
          if (Array.isArray(refs)) return refs.includes(rec.id);
          return refs === rec.id;
        });
 
        const readinessChecks = [
          {
            key: "im",
            complete: Array.isArray(rec.fields["IM_Review_Documents"]) && rec.fields["IM_Review_Documents"].length > 0
          },
          {
            key: "financials",
            complete: (!!revenue && !!ebitda) || dealDocs.some((d: any) => (d.fields["Category"] || "").toLowerCase().includes("financial") && (d.fields["Status"] || "").toLowerCase() !== "outstanding")
          },
          {
            key: "ownership",
            complete: !!rec.fields["Vendor_Names"] || !!rec.fields["Vendor Names"] || !!rec.fields["Vendor Details"] || !!rec.fields["vendor details"]
          },
          {
            key: "website",
            complete: !!rec.fields["Website"]
          },
          {
            key: "profile",
            complete: !!sector && !!location
          },
          {
            key: "documents",
            complete: dealDocs.length > 0 && dealDocs.some((d: any) => (d.fields["Status"] || "").toLowerCase() !== "outstanding")
          }
        ];
 
        const completedChecks = readinessChecks.filter(c => c.complete);
        const readiness = Math.round((completedChecks.length / readinessChecks.length) * 100);
 
        const missingItems: string[] = [];
        if (!readinessChecks.find(c => c.key === "im")?.complete) {
          missingItems.push("Information Memorandum (IM)");
        }
        if (!readinessChecks.find(c => c.key === "website")?.complete) {
          missingItems.push("Website URL");
        }
        if (!readinessChecks.find(c => c.key === "ownership")?.complete) {
          missingItems.push("Director/Ownership Information");
        }
 
        // Add outstanding checklist documents to missing list
        const outstandingDocs = dealDocs.filter((d: any) => (d.fields["Status"] || "").toLowerCase() === "outstanding");
        outstandingDocs.forEach((d: any) => {
          missingItems.push(d.fields["Document_Name"] || d.fields["Document Name"] || "Diligence Document");
        });
 
        const stageUpdatedAtStr = rec.fields["Stage_Updated_At"];
        let stageAgeDays = 0;
        if (stageUpdatedAtStr) {
          const stageUpdatedAt = new Date(stageUpdatedAtStr).getTime();
          stageAgeDays = Math.floor((Date.now() - stageUpdatedAt) / (1000 * 60 * 60 * 24));
        }

        // Calculate background workflows
        let isProcessing = false;
        let processingStatusText = "";

        // Check OSINT Workflows
        const osintStatus = rec.fields["OSINT_Status"];
        if (osintStatus && ["queued", "processing", "Queued", "Scraping Website", "Extracting Metadata", "Analyzing Company", "Generating Risk Profile", "Processing"].includes(osintStatus)) {
          isProcessing = true;
          processingStatusText = `OSINT: ${osintStatus}`;
        }

        // Check Financial Workflows
        const finStatus = rec.fields["Financial_Analysis_Status"];
        if (!isProcessing && finStatus && ["queued", "processing", "analyzing", "Processing"].includes(finStatus)) {
          isProcessing = true;
          processingStatusText = `Financials: ${finStatus}`;
        }

        // Check Document parsing/analysis
        if (!isProcessing) {
          const processingDoc = dealDocs.find((d: any) => {
            const procStatus = d.fields["Processing_Status"];
            return procStatus && ["queued", "processing", "analyzing", "extracted", "Processing"].includes(procStatus);
          });
          if (processingDoc) {
            isProcessing = true;
            processingStatusText = `Doc parse: ${processingDoc.fields["Document_Name"] || "Document"}`;
          }
        }

        // Check Pre/Post-call Briefs
        const dealName = rec.fields["Deal Name"] || rec.fields["Company_Name"] || rec.fields["Company Name"];
        if (!isProcessing) {
          const procPrecall = precallBriefs.find((b: any) => {
            const refs = b.fields["Active_Pipeline"];
            const isMatch = Array.isArray(refs) ? (refs.includes(rec.id) || refs.includes(dealName)) : (refs === rec.id || refs === dealName);
            return isMatch && b.fields["Processing_Status"] && ["queued", "processing", "Processing"].includes(b.fields["Processing_Status"]);
          });
          if (procPrecall) {
            isProcessing = true;
            processingStatusText = "Generating pre-call brief";
          }
        }

        if (!isProcessing) {
          const procPostcall = postcallBriefs.find((b: any) => {
            const refs = b.fields["Active_Pipeline"];
            const isMatch = Array.isArray(refs) ? (refs.includes(rec.id) || refs.includes(dealName)) : (refs === rec.id || refs === dealName);
            return isMatch && b.fields["Processing_Status"] && ["queued", "processing", "Processing"].includes(b.fields["Processing_Status"]);
          });
          if (procPostcall) {
            isProcessing = true;
            processingStatusText = "Analyzing post-meeting transcript";
          }
        }

        return {
          ...deal,
          revenue,
          ebitda,
          evAsk,
          multiplier,
          sector,
          location,
          ownerName,
          ownerInitials,
          nextActionTitle,
          nextActionSub,
          nextActionColor,
          actionDate,
          isBlocked: false,
          blockerCount: 0,
          blockers: [],
          readiness,
          missingItems,
          archived: rec.fields["Archived"] === true || rec.fields["Archived"] === "Yes",
          isProcessing,
          processingStatusText,
          stageAgeDays,
          listingLink: deal.listingLink || rec.fields["Listing_Link"] || "",
          contactEmail: deal.contactEmail || rec.fields["Contact_Email"] || "",
          contactPhone: deal.contactPhone || rec.fields["Contact_Phone"] || "",
          turnover: deal.turnover || revenue || rec.fields["Turnover"] || "",
          executiveSummary: deal.executiveSummary || rec.fields["Executive_Summary"] || "",
          businessDescription: deal.businessDescription || rec.fields["Business_Description"] || "",
          lenderExecutiveSummary: deal.lenderExecutiveSummary || rec.fields["Lender_Executive_Summary"] || "",
          dealType: deal.dealType || rec.fields["Deal_Type"] || "",
          investmentHighlights: deal.investmentHighlights || rec.fields["Investment_Highlights"] || "",
          acquisitionRationale: deal.acquisitionRationale || rec.fields["Acquisition_Rationale"] || ""
        };
      });
    } else {
      const response = await airtableFetchAll(tableName);
      if (type === "inbox") {
        results = response.records.map((rec: any) => ({
          id: rec.id,
          fields: rec.fields
        }));
      } else {
        results = response.records.map((rec: any) => mapper(rec.id, rec.fields));
      }

      // Enforce document visibility filtering for external Stakeholders
      if (type === "documents") {
        const userRole = (req.headers["x-user-role"] || "").toLowerCase();
        if (userRole === "stakeholder" || userRole === "read only") {
          results = results.filter((doc: any) => {
            const access = String(doc.documentAccess || doc.rawFields?.Document_Access || "").trim().toLowerCase();
            return access === "lender" || access === "public";
          });
        }
      }
    }

    // 4. Update in-memory cache
    cache[cacheKey] = {
      timestamp: Date.now(),
      data: results
    };

    // Helper to verify stakeholder deal assignment
    const isDealAssignedToStakeholder = (deal: any, email: string) => {
      if (!deal) return false;
      const contactEmail = String(deal.contactEmail || deal.rawFields?.Contact_Email || deal.rawFields?.["Contact Email"] || "").toLowerCase().trim();
      const brokerEmail = String(deal.rawFields?.["Broker Email"] || deal.rawFields?.Broker_Email || "").toLowerCase().trim();
      if (contactEmail === email || brokerEmail === email) return true;

      const brokerName = String(deal.broker || deal.rawFields?.Broker || deal.rawFields?.["Broker Name"] || "").toLowerCase().trim();
      const emailUsername = email.split("@")[0];
      if (brokerName.includes(emailUsername)) return true;

      const stakeholdersField = String(deal.rawFields?.Stakeholders || deal.rawFields?.stakeholders || "").toLowerCase();
      if (stakeholdersField.includes(email)) return true;

      return false;
    };

    const userEmail = String(req.headers["x-user-email"] || "").toLowerCase().trim();

    // Filter results if deal reference was queried
    if (ref) {
      const filtered = filterResults(results, type, ref, targetDealId);
      if (!type && (userRole === "stakeholder" || userRole === "read only") && !isDealAssignedToStakeholder(filtered, userEmail)) {
        return res.status(403).json({ error: "Forbidden: You do not have access to this deal." });
      }
      return res.status(200).json(filtered);
    }
 
    // Filter out archived deals if loading all deals (for active pipeline)
    let outputResults = results;
    if (!type && !ref) {
      outputResults = results.filter((deal: any) => deal.archived !== true && deal.rawFields?.Archived !== true && deal.rawFields?.Archived !== "Yes");
    }

    if (!type && (userRole === "stakeholder" || userRole === "read only")) {
      outputResults = outputResults.filter((deal: any) => isDealAssignedToStakeholder(deal, userEmail));
    }
 
    // Apply Edge CDN headers
    if (type !== "inbox") {
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=30");
    }
 
    return res.status(200).json(outputResults);
  } catch (err: any) {
    console.error(`[API Deals Error] Type: ${type || "deals"}, Error: ${err.message || err}`);
    return res.status(err.status || 500).json({
      error: err.message || "Failed to load database records",
      type: err.type || "INTERNAL_ERROR"
    });
  }
}

/**
 * Filter results dynamically based on reference or parent link
 */
function filterResults(data: any[], type: string | undefined, ref: string, targetDealId?: string | null): any {
  const lowercaseRef = ref.toLowerCase();
  const lowercaseDealId = targetDealId?.toLowerCase();
  
  if (type === "documents" || type === "submissions") {
    return data.filter((item: any) => {
      const itemRef = item.dealRef || "";
      return itemRef.toLowerCase() === lowercaseRef || (lowercaseDealId && itemRef.toLowerCase() === lowercaseDealId);
    });
  }
  
  // Deals list filter
  return data.find((item: any) => {
    const itemRef = item.dealRef || "";
    return itemRef.toLowerCase() === lowercaseRef || (lowercaseDealId && item.id.toLowerCase() === lowercaseDealId);
  }) || null;
}
