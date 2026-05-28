import { airtableCreate, airtableFetch, airtableFetchRecord, getTableSchema, escapeFormulaString, TABLES, getAssignmentFields } from "../_utils/airtable.js";
import { authenticateAdmin } from "./lenders.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin
    authenticateAdmin(req);

    const { lenderRecordId, dealRef } = req.body || {};
    if (!lenderRecordId || !dealRef) {
      return res.status(400).json({ error: "Lender record ID and Deal reference are required" });
    }

    // 2. Fetch lender details to get their text Lender_ID
    const lenderData = await airtableFetchRecord(TABLES.LENDERS, lenderRecordId);
    const lenderIdText = lenderData.fields.Lender_ID;

    // 3. Fetch deal details to get its record ID
    const dealsData = await airtableFetch(TABLES.PIPELINE, {
      filterByFormula: `OR({REF No.} = '${escapeFormulaString(dealRef)}', {Deal_Ref} = '${escapeFormulaString(dealRef)}')`,
      maxRecords: 1
    });

    if (!dealsData.records || dealsData.records.length === 0) {
      return res.status(404).json({ error: `Deal reference '${dealRef}' not found` });
    }

    const dealRecord = dealsData.records[0];
    const dealRecordId = dealRecord.id;

    // 4. Check if an active assignment already exists to avoid duplicates
    const { lenderIdCol, dealRefCol, statusCol } = await getAssignmentFields();
    let filterFormula = `AND(OR({${lenderIdCol}} = '${lenderRecordId}', {${lenderIdCol}} = '${escapeFormulaString(lenderIdText)}'), OR({${dealRefCol}} = '${dealRecordId}', {${dealRefCol}} = '${escapeFormulaString(dealRef)}'))`;
    if (statusCol) {
      filterFormula = `AND(${filterFormula}, {${statusCol}} = 'Active')`;
    }

    const existingAsg = await airtableFetch(TABLES.ASSIGNMENTS, {
      filterByFormula: filterFormula,
      maxRecords: 1
    });

    if (existingAsg.records && existingAsg.records.length > 0) {
      return res.status(200).json({ success: true, message: "Deal is already assigned to this lender." });
    }

    // 5. Fetch Lender_Deal_Assignments schema to write correct types
    const schema = await getTableSchema(TABLES.ASSIGNMENTS);
    const fieldsToWrite: Record<string, any> = {
      Assignment_ID: "ASG-" + Math.random().toString(36).substring(2, 8).toUpperCase(),
      Assigned_At: new Date().toISOString(),
      Assigned_By: "ACP Admin",
      Status: "Active"
    };

    if (schema) {
      const lenderField = schema.fields.find((f: any) => f.name === "Lender_ID");
      const dealField = schema.fields.find((f: any) => f.name === "Deal_Ref");

      if (lenderField?.type === "multipleRecordLinks") {
        fieldsToWrite.Lender_ID = [lenderRecordId];
      } else {
        fieldsToWrite.Lender_ID = lenderIdText;
      }

      if (dealField?.type === "multipleRecordLinks") {
        fieldsToWrite.Deal_Ref = [dealRecordId];
      } else {
        fieldsToWrite.Deal_Ref = dealRef;
      }
    } else {
      // Default fallback
      fieldsToWrite.Lender_ID = [lenderRecordId];
      fieldsToWrite.Deal_Ref = [dealRecordId];
    }

    const newRecord = await airtableCreate(TABLES.ASSIGNMENTS, fieldsToWrite);

    return res.status(200).json({
      success: true,
      id: newRecord.id,
      ...newRecord.fields
    });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}
