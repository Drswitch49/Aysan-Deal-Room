import { airtableFetch, TABLES, escapeFormulaString, normalizeLenderFields, getAssignmentFields, normalizeAssignmentFields } from "../_utils/airtable.js";
import { getSessionToken, verifyJWT } from "../_utils/jwt.js";

const SAFE_FIELDS = [
  "REF No.", "Ref No.", "Deal_Ref", "Deal Ref", "Deal Reference", "Deal Name",
  "Company_Name", "Company Name", "company name", "Company",
  "Status", "Deal_Status", "Deal Status", "Stage",
  "Location", "Company Location", "HQ", "Headquarters",
  "Sector", "Industry",
  "EV", "Enterprise Value", "Enterprise_Value", "EV Multiple",
  "DSCR_Base", "DSCR Base", "DSCR base", "DSCR_Proxy", "DSCR Proxy",
  "DSCR_Stress", "DSCR Stress", "DSCR stress", "DSCR_SCORE", "DSCR Score",
  "Post_Completion_Roles", "Post-Completion Roles", "Post Completion Roles",
  "Senior_Debt", "Senior Debt", "Senior Debt Amount",
  "Sub_Debt", "Sub Debt", "Subordinated Debt",
  "Equity", "Equity Amount",
  "Seller_Note", "Seller Note",
  "Senior_Debt_Provider", "Senior Debt Provider", "Senior Lender",
  "Sub_Debt_Provider", "Sub Debt Provider", "Subordinated Debt Provider",
  "Equity_Provider", "Equity Provider",
  "Seller_Note_Provider", "Seller Note Provider",
  "Deal Files", "Deal_Files", "deal_files", "Deal Link", "Drive_Link", "Drive Link",
  "Lender_Executive_Summary", "Lender Executive Summary", "lender_executive_summary", "lender executive summary",
  "Business_Description", "Business Description", "business_description", "business description",
  "Investment_Highlights", "Investment Highlights", "investment_highlights", "investment highlights",
  "Acquisition_Rationale", "Acquisition Rationale", "acquisition_rationale", "acquisition rationale",
  "Deal_Type", "Deal Type", "deal_type", "deal type",
  "Turnover", "turnover", "Revenue", "revenue",
  "EBITDA", "ebitda", "EBITDA_GBP", "EBITDA GBP",
  "Asking_Price_GBP", "Asking Price", "asking_price_gbp", "asking price", "Asking_Price"
];

// Helper to authenticate lender via headers
export async function authenticateLender(req: any): Promise<any> {
  const token = getSessionToken(req);
  if (!token) {
    throw new Error("Missing lender authentication credentials.");
  }

  const decoded = await verifyJWT(token);
  if (!decoded) {
    throw new Error("Invalid session token.");
  }

  const slug = req.headers["x-lender-slug"] || req.query.portalSlug || decoded.portalSlug;
  const email = decoded.email;

  if (decoded.role === "lender") {
    if (!email) {
      throw new Error("Invalid lender session email.");
    }
    const data = await airtableFetch(TABLES.LENDERS, {
      filterByFormula: `{Email} = '${escapeFormulaString(email)}'`,
      maxRecords: 1
    });

    if (!data.records || data.records.length === 0) {
      throw new Error("Lender email alignment failed.");
    }

    const lender = data.records[0];
    const normFields = normalizeLenderFields(lender.fields);

    if (normFields.Status !== "Active") {
      throw new Error("Lender account is inactive.");
    }

    return {
      ...lender,
      normalizedFields: normFields
    };
  } else if (decoded.role === "admin" || decoded.role === "analyst") {
    if (!slug) {
      throw new Error("Admin simulation requires a lender slug.");
    }
    const data = await airtableFetch(TABLES.LENDERS, {
      filterByFormula: `{Portal_Slug} = '${escapeFormulaString(slug)}'`,
      maxRecords: 1
    });

    if (!data.records || data.records.length === 0) {
      throw new Error("Invalid lender portal slug.");
    }

    const lender = data.records[0];
    const normFields = normalizeLenderFields(lender.fields);
    return {
      ...lender,
      normalizedFields: normFields
    };
  }

  throw new Error("Unauthorized role for lender actions.");
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate lender
    const lender = await authenticateLender(req);
    const lenderRecordId = lender.id;
    const lenderIdText = lender.normalizedFields.Lender_ID;

    // 2. Fetch assignments
    const { lenderIdCol, lenderIdLookupCol, dealRefCol, statusCol } = await getAssignmentFields();
    let filterFormula = `OR(FIND('${lenderRecordId}', {${lenderIdCol}}) > 0, FIND('${escapeFormulaString(lenderIdText)}', {${lenderIdCol}}) > 0)`;
    if (lenderIdLookupCol) {
      filterFormula = `OR(${filterFormula}, FIND('${escapeFormulaString(lenderIdText)}', {${lenderIdLookupCol}}) > 0)`;
    }
    if (statusCol) {
      filterFormula = `AND(${filterFormula}, {${statusCol}} = 'Active')`;
    }

    const assignmentsData = await airtableFetch(TABLES.ASSIGNMENTS, {
      filterByFormula: filterFormula
    });

    if (!assignmentsData.records || assignmentsData.records.length === 0) {
      return res.status(200).json([]);
    }

    // 3. Resolve all assigned deal IDs and Refs + build NDA map
    const dealIds = new Set<string>();
    const dealRefs = new Set<string>();
    let lenderNdaApproved = false;
    const ndaField = lender.normalizedFields.NDA_Approved;
    if (Array.isArray(ndaField)) {
       lenderNdaApproved = ndaField.some(v => v === "Yes" || v === "yes" || v === true || String(v).toLowerCase() === "true");
    } else {
       lenderNdaApproved = ndaField === "Yes" || ndaField === "yes" || ndaField === true || String(ndaField).toLowerCase() === "true";
    }

    for (const record of assignmentsData.records) {
      const dealRefVal = record.fields[dealRefCol] || record.fields.Deal_Ref || record.fields["Deal Ref"];
      if (dealRefVal) {
        if (Array.isArray(dealRefVal)) {
          dealRefVal.forEach(id => {
            dealIds.add(id);
          });
        } else {
          const refStr = String(dealRefVal);
          dealRefs.add(refStr);
        }
      }
    }

    // 4. Fetch all deals from Active_Pipeline and Deal_Inbox, then filter
    const [pipelineData, inboxDataAll] = await Promise.all([
      airtableFetch(TABLES.PIPELINE).catch(() => ({ records: [] })),
      airtableFetch("Deal_Inbox").catch(() => ({ records: [] }))
    ]);
    
    const allAvailableDeals = [...(pipelineData.records || []), ...(inboxDataAll.records || [])];

    const assignedDeals = allAvailableDeals.filter((record: any) => {
      const refNo = record.fields["REF No."] || record.fields["REF. NO"] || record.fields.Deal_Ref || record.fields.dealRef || record.fields["Deal Name"];
      return dealIds.has(record.id) || dealRefs.has(String(refNo));
    });

    // Auto-map lookup fields (arrays) to scalar values for our standard fields
    assignedDeals.forEach((deal: any) => {
      const f = deal.fields;
      const mapLookup = (target: string, source: string) => {
         if (!f[target] && f[source]) {
            f[target] = Array.isArray(f[source]) ? f[source][0] : f[source];
         }
      };

      mapLookup("Company Name", "Company Name (from Deal_Inbox)");
      mapLookup("Company_Name", "Company Name (from Deal_Inbox)");
      mapLookup("Location", "Location (from Deal_Inbox)");
      mapLookup("Sector", "Sector (from Deal_Inbox)");
      mapLookup("EV", "Asking_Price_GBP (from Deal_Inbox)");
      mapLookup("EV", "Turnover (from Deal_Inbox)");
      mapLookup("DSCR_Proxy", "DSCR_Proxy (from Deal_Inbox)");
      mapLookup("DSCR_SCORE", "DSCR_Score (from Deal_Inbox)");
      mapLookup("Broker", "BROKER (from Deal_Inbox)");
      mapLookup("Broker", "Broker (from Deal_Inbox)");
      mapLookup("Deal Files", "Deal Files (from Deal_Inbox)");
    });

    // Try to resolve empty fields by matching with Deal_Inbox
    const inboxFormulas: string[] = [];
    assignedDeals.forEach((deal: any) => {
      const dealName = String(deal.fields["Deal Name"] || "");
      const refNo = String(deal.fields["REF No."] || "");
      
      if (refNo) {
        inboxFormulas.push(`{REF. NO} = '${escapeFormulaString(refNo)}'`);
      }

      const segments = dealName.split(/[|—–-]/).map(s => s.trim()).filter(Boolean);
      segments.forEach(seg => {
        const cleanSeg = seg.toLowerCase();
        if (seg.length >= 3 && 
            !cleanSeg.includes("killed") && 
            !cleanSeg.includes("parked") && 
            !cleanSeg.includes("permanent") &&
            !cleanSeg.includes("active") &&
            !cleanSeg.includes("pipeline")) {
          inboxFormulas.push(`FIND('${escapeFormulaString(seg)}', {Deal Name})`);
          inboxFormulas.push(`{REF. NO} = '${escapeFormulaString(seg)}'`);
        }
      });
    });

    let inboxRecords: any[] = [];
    if (inboxFormulas.length > 0) {
      try {
        const inboxData = await airtableFetch("Deal_Inbox", {
          filterByFormula: `OR(${inboxFormulas.join(", ")})`
        });
        inboxRecords = inboxData.records || [];
      } catch (err) {
        console.warn("Failed to fetch Deal_Inbox fallback data:", err);
      }
    }

    // Merge Deal_Inbox fields into assignedDeals
    assignedDeals.forEach((deal: any) => {
      const dealName = String(deal.fields["Deal Name"] || "");
      const refNo = String(deal.fields["REF No."] || "");
      
      const match = inboxRecords.find(inboxRec => {
        const inboxName = String(inboxRec.fields["Deal Name"] || "").toLowerCase();
        const inboxRef = String(inboxRec.fields["REF. NO"] || "").toLowerCase();
        
        return (inboxRef && refNo.toLowerCase() === inboxRef) ||
               (inboxRef && dealName.toLowerCase().includes(inboxRef)) ||
               (inboxName && dealName.toLowerCase().includes(inboxName)) ||
               (inboxName && dealName && inboxName.split(" ").every(word => word.length < 3 || dealName.toLowerCase().includes(word)));
      });

      if (match) {
        const f = deal.fields;
        const im = match.fields;

        if (!f["REF No."] && im["REF. NO"]) f["REF No."] = im["REF. NO"];
        if (!f["Company Name"] && !f.Company_Name) {
          f["Company Name"] = im["Deal Name"] || dealName;
          f.Company_Name = im["Deal Name"] || dealName;
        }
        if (!f.Sector && im.Sector) f.Sector = im.Sector;
        if (!f.Location && im.Location) f.Location = im.Location;
        if (!f["EV Multiple"] && im["EV Multiple"]) f["EV Multiple"] = im["EV Multiple"];
        if (!f.DSCR_Proxy && im.DSCR_Proxy) f.DSCR_Proxy = im.DSCR_Proxy;
        if (!f.DSCR_SCORE && im.DSCR_Score) f.DSCR_SCORE = im.DSCR_Score;
        if (!f.Broker && im.BROKER) f.Broker = im.BROKER;
        if (!f["Deal Files"] && im["Deal Files"]) f["Deal Files"] = im["Deal Files"];
        
        if (!f.EV && im.Asking_Price_GBP) f.EV = im.Asking_Price_GBP;
        if (!f.EV && im.Turnover) f.EV = im.Turnover;
      } else {
        const f = deal.fields;
        const segments = dealName.split(/[|—–-]/).map(s => s.trim()).filter(Boolean);
        if (segments.length >= 2) {
          const filtered = segments.filter(s => {
            const l = s.toLowerCase();
            return !l.includes("killed") && !l.includes("parked") && !l.includes("permanent");
          });
          if (filtered.length >= 2) {
            if (!f["REF No."]) f["REF No."] = filtered[0];
            if (!f["Company Name"]) f["Company Name"] = filtered[1];
          } else if (filtered.length === 1) {
            if (!f["Company Name"]) f["Company Name"] = filtered[0];
          }
        }
      }
    });

    // 5. Redact non-safe fields
    const safeDeals = assignedDeals.map((record: any) => {
      const fields: Record<string, any> = {};
      Object.keys(record.fields).forEach(key => {
        if (SAFE_FIELDS.includes(key)) {
          fields[key] = record.fields[key];
        }
      });

      return {
        id: record.id,
        fields,
        ndaApproved: lenderNdaApproved
      };
    });

    return res.status(200).json(safeDeals);
  } catch (err: any) {
    return res.status(err.status || 401).json({ error: err.message, type: err.type });
  }
}
