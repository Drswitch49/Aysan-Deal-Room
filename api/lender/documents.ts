import { airtableFetch, TABLES, escapeFormulaString } from "../_utils/airtable";
import { authenticateLender } from "./deals";

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
    const lenderIdText = lender.fields.Lender_ID;

    // 2. Fetch lender assignments
    const assignmentsData = await airtableFetch(TABLES.ASSIGNMENTS, {
      filterByFormula: `AND(OR({Lender_ID} = '${lenderRecordId}', {Lender_ID} = '${escapeFormulaString(lenderIdText)}'), {Status} = 'Active')`
    });

    if (!assignmentsData.records || assignmentsData.records.length === 0) {
      return res.status(200).json([]);
    }

    // Resolve assigned deal IDs
    const dealIds = new Set<string>();
    for (const record of assignmentsData.records) {
      const dealRefVal = record.fields.Deal_Ref;
      if (dealRefVal) {
        if (Array.isArray(dealRefVal)) {
          dealRefVal.forEach(id => dealIds.add(id));
        } else {
          // If it's a string, we need to find its record ID from Pipeline table
          try {
            const pipeData = await airtableFetch(TABLES.PIPELINE, {
              filterByFormula: `OR({REF No.} = '${escapeFormulaString(String(dealRefVal))}', {Deal_Ref} = '${escapeFormulaString(String(dealRefVal))}')`,
              maxRecords: 1
            });
            if (pipeData.records?.[0]) {
              dealIds.add(pipeData.records[0].id);
            }
          } catch {}
        }
      }
    }

    // 3. Fetch documents
    const documentsData = await airtableFetch(TABLES.DOCUMENTS);

    // 4. Filter:
    // - Must belong to one of the assigned deals (matching by dealRef linked record ID)
    // - Status must be "Sent to Lender" (case insensitive)
    const approvedDocs = documentsData.records.filter((doc: any) => {
      const docDealRefs = doc.fields.Deal_Ref || [];
      const belongsToAssignedDeal = Array.isArray(docDealRefs) 
        ? docDealRefs.some(id => dealIds.has(id))
        : dealIds.has(String(docDealRefs));

      const status = String(doc.fields.Status || "").trim().toLowerCase();
      const isSentToLender = status === "sent to lender";

      return belongsToAssignedDeal && isSentToLender;
    });

    // 5. Redact fields on the server side
    const safeDocs = approvedDocs.map((doc: any) => {
      const fields: Record<string, any> = {};
      Object.keys(doc.fields).forEach(key => {
        if (SAFE_DOC_FIELDS.includes(key)) {
          fields[key] = doc.fields[key];
        }
      });
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
