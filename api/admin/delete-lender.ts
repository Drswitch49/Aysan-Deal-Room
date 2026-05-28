import { airtableDelete, airtableFetchRecord, airtableFetch, TABLES, getAssignmentFields } from "../_utils/airtable.js";
import { authenticateAdmin } from "./lenders.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin
    authenticateAdmin(req);

    const { lenderRecordId } = req.body || {};
    if (!lenderRecordId) {
      return res.status(400).json({ error: "Lender record ID is required" });
    }

    // 2. Fetch lender details to get their text Lender_ID
    const lenderData = await airtableFetchRecord(TABLES.LENDERS, lenderRecordId);
    const lenderIdText = lenderData.fields.Lender_ID;

    // 3. Find and delete all assignments for this lender
    const { lenderIdCol } = await getAssignmentFields();
    
    // We filter assignments where Lender_ID link equals the lender record ID or the text ID
    const filterFormula = `OR({${lenderIdCol}} = '${lenderRecordId}', {${lenderIdCol}} = '${lenderIdText}')`;
    const assignmentsRes = await airtableFetch(TABLES.ASSIGNMENTS, {
      filterByFormula: filterFormula
    });

    if (assignmentsRes.records && assignmentsRes.records.length > 0) {
      await Promise.all(
        assignmentsRes.records.map((rec: any) => 
          airtableDelete(TABLES.ASSIGNMENTS, rec.id)
        )
      );
    }

    // 4. Delete the lender record itself
    await airtableDelete(TABLES.LENDERS, lenderRecordId);

    return res.status(200).json({ success: true, message: "Lender and all assignments successfully deleted." });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}
