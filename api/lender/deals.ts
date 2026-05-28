import { airtableFetch, TABLES, escapeFormulaString, normalizeLenderFields, getAssignmentFields } from "../_utils/airtable.js";

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
  "Deal Files", "Deal_Files", "deal_files", "Deal Link", "Drive_Link", "Drive Link"
];

// Helper to authenticate lender via headers
export async function authenticateLender(req: any): Promise<any> {
  const slug = req.headers["x-lender-slug"];
  const password = req.headers["x-lender-password"];

  if (!slug || !password) {
    throw new Error("Missing lender authentication credentials.");
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
  if (normFields.Portal_Password !== password) {
    throw new Error("Invalid passcode.");
  }

  if (normFields.Status !== "Active") {
    throw new Error("Lender account is inactive.");
  }

  // Attach normalized fields so helpers don't have to re-normalize
  return {
    ...lender,
    normalizedFields: normFields
  };
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
    const { lenderIdCol, statusCol } = await getAssignmentFields();
    let filterFormula = `OR({${lenderIdCol}} = '${lenderRecordId}', {${lenderIdCol}} = '${escapeFormulaString(lenderIdText)}')`;
    if (statusCol) {
      filterFormula = `AND(${filterFormula}, {${statusCol}} = 'Active')`;
    }

    const assignmentsData = await airtableFetch(TABLES.ASSIGNMENTS, {
      filterByFormula: filterFormula
    });

    if (!assignmentsData.records || assignmentsData.records.length === 0) {
      return res.status(200).json([]);
    }

    // 3. Resolve all assigned deal IDs and Refs
    const dealIds = new Set<string>();
    const dealRefs = new Set<string>();

    for (const record of assignmentsData.records) {
      const dealRefVal = record.fields.Deal_Ref;
      if (dealRefVal) {
        if (Array.isArray(dealRefVal)) {
          dealRefVal.forEach(id => dealIds.add(id));
        } else {
          dealRefs.add(String(dealRefVal));
        }
      }
    }

    // 4. Fetch all deals from Active_Pipeline and filter
    const pipelineData = await airtableFetch(TABLES.PIPELINE);
    
    const assignedDeals = pipelineData.records.filter((record: any) => {
      const refNo = record.fields["REF No."] || record.fields.Deal_Ref || record.fields.dealRef || record.fields["Deal Name"];
      return dealIds.has(record.id) || dealRefs.has(String(refNo));
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
        fields
      };
    });

    return res.status(200).json(safeDeals);
  } catch (err: any) {
    return res.status(err.status || 401).json({ error: err.message, type: err.type });
  }
}
