import { airtableFetch, TABLES, escapeFormulaString, getAssignmentFields, getTableSchema, normalizeAssignmentFields } from "../_utils/airtable.js";
import { authenticateLender } from "./deals.js";

const SAFE_DOC_FIELDS = [
  "Deal_Ref", "Deal Ref", "Deal Reference",
  "Document_Name", "Document Name", "Name",
  "Category", "category",
  "ABL_Critical", "ABL Critical", "abl_critical", "abl critical", "Critical",
  "Status", "status", "Stage",
  "Source", "source",
  "Date_Received", "Date Received", "date_received", "date received", "Date",
  "drive link", "Drive Link", "Drive_Link", "drive_link", "Link", "link",
  "Expected_Date", "Expected Date", "expected_date", "expected date",
  "Date_Sent_To_Lender", "Date Sent To Lender", "date_sent_to_lender", "date sent to lender"
];

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate lender
    const lender = await authenticateLender(req);
    const lenderRecordId = lender.id;
    const lenderIdText = lender.normalizedFields.Lender_ID;

    // 2. Fetch lender assignments using dynamic fields
    const { lenderIdCol, lenderIdLookupCol, statusCol } = await getAssignmentFields();
    let filterFormula = `OR({${lenderIdCol}} = '${lenderRecordId}', {${lenderIdCol}} = '${escapeFormulaString(lenderIdText)}')`;
    if (lenderIdLookupCol) {
      filterFormula = `OR(${filterFormula}, {${lenderIdLookupCol}} = '${escapeFormulaString(lenderIdText)}')`;
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

    // Resolve assigned deals and their associated file links
    const pipelineData = await airtableFetch(TABLES.PIPELINE);
    const pipelineRecords = pipelineData.records || [];

    const dealIds = new Set<string>();
    const dealFilesMap = new Map<string, string>();
    const refToRecordMap = new Map<string, string>();

    pipelineRecords.forEach((rec: any) => {
      const refNo = rec.fields["REF No."] || rec.fields.Deal_Ref || rec.fields.dealRef || rec.fields["Deal Name"] || rec.fields.REF_No;
      if (refNo) {
        refToRecordMap.set(String(refNo).toLowerCase(), rec.id);
      }
      
      const dealFiles = rec.fields["Deal Files"] || rec.fields.Deal_Files || rec.fields.deal_files || rec.fields["Deal Link"] || rec.fields.Drive_Link || rec.fields["Drive Link"] || rec.fields.Link || rec.fields.link || "";
      if (dealFiles) {
        dealFilesMap.set(rec.id, String(dealFiles));
      }
    });

    const ndaApprovedDeals = new Set<string>();
    const lenderNdaApproved = lender.normalizedFields.NDA_Approved === "Yes" || lender.normalizedFields.NDA_Approved === "yes" || lender.normalizedFields.NDA_Approved === true;

    for (const record of assignmentsData.records) {
      const dealRefVal = record.fields.Deal_Ref;
      if (dealRefVal && lenderNdaApproved) {
        if (Array.isArray(dealRefVal)) {
          dealRefVal.forEach(id => ndaApprovedDeals.add(id));
        } else {
          const matchedId = refToRecordMap.get(String(dealRefVal).toLowerCase()) || dealRefVal;
          ndaApprovedDeals.add(matchedId);
        }
      }
    }

    // 3. Fetch documents
    const documentsData = await airtableFetch(TABLES.DOCUMENTS);

    // 4. Filter:
    // - Must belong to one of the assigned deals where NDA is approved
    const approvedDocs = documentsData.records.filter((doc: any) => {
      const docDealRefs = doc.fields.Deal_Ref || [];
      const belongsToAssignedDeal = Array.isArray(docDealRefs) 
        ? docDealRefs.some(id => ndaApprovedDeals.has(id))
        : ndaApprovedDeals.has(String(docDealRefs));

      const status = String(doc.fields.Status || doc.fields.status || doc.fields.Stage || "").trim().toLowerCase();
      const isApproved = status === "sent to lender";

      const access = String(doc.fields.Document_Access || doc.fields.document_access || doc.fields["Document Access"] || "").trim().toLowerCase();
      const isAccessAllowed = access === "lender" || access === "public";

      return belongsToAssignedDeal && isApproved && isAccessAllowed;
    });

    // 5. Redact fields and inject populated / fallback Drive_Link field
    const safeDocs = approvedDocs.map((doc: any) => {
      const fields: Record<string, any> = {};
      Object.keys(doc.fields).forEach(key => {
        if (SAFE_DOC_FIELDS.includes(key)) {
          fields[key] = doc.fields[key];
        }
      });

      // Find if we already have a drive link in the safe fields
      const existingLinkKey = Object.keys(fields).find(k => 
        ["drive link", "Drive Link", "Drive_Link", "drive_link", "Link", "link"].includes(k)
      );
      
      let linkValue = existingLinkKey ? fields[existingLinkKey] : "";
      if (!linkValue) {
        // Fallback to deal files link
        const docDealRefs = doc.fields.Deal_Ref || [];
        const matchedDealId = Array.isArray(docDealRefs) 
          ? docDealRefs.find(id => dealFilesMap.has(id))
          : (dealFilesMap.has(String(docDealRefs)) ? String(docDealRefs) : undefined);
        
        if (matchedDealId) {
          linkValue = dealFilesMap.get(matchedDealId) || "";
        }
      }

      // Ensure Drive_Link is explicitly provided for mapping on the client side
      fields["Drive_Link"] = linkValue;

      return {
        id: doc.id,
        fields
      };
    });

    return res.status(200).json(safeDocs);
  } catch (err: any) {
    return res.status(err.status || 401).json({ error: err.message, type: err.type });
  }
}
