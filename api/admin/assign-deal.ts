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

    // 3. Fetch deal details using safe dynamic field resolution based on pipeline schema
    const pipelineSchema = await getTableSchema(TABLES.PIPELINE);
    let pipeFilterFormula = "";
    if (pipelineSchema && pipelineSchema.fields) {
      const formulas: string[] = [];
      pipelineSchema.fields.forEach((f: any) => {
        const cleanName = f.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        if (["refno", "dealref", "dealreference", "dealname"].includes(cleanName)) {
          formulas.push(`{${f.name}} = '${escapeFormulaString(dealRef)}'`);
        }
      });
      if (formulas.length > 0) {
        pipeFilterFormula = formulas.length === 1 ? formulas[0] : `OR(${formulas.join(", ")})`;
      } else {
        pipeFilterFormula = `{REF No.} = '${escapeFormulaString(dealRef)}'`;
      }
    } else {
      pipeFilterFormula = `OR({REF No.} = '${escapeFormulaString(dealRef)}', {Deal_Ref} = '${escapeFormulaString(dealRef)}')`;
    }

    const dealsData = await airtableFetch(TABLES.PIPELINE, {
      filterByFormula: pipeFilterFormula,
      maxRecords: 1
    });

    if (!dealsData.records || dealsData.records.length === 0) {
      return res.status(404).json({ error: `Deal reference '${dealRef}' not found` });
    }

    const dealRecord = dealsData.records[0];
    const dealRecordId = dealRecord.id;

    // 4. Check if an active assignment already exists to avoid duplicates
    const { lenderIdCol, lenderIdLookupCol, dealRefCol, statusCol } = await getAssignmentFields();
    let lenderFilter = `OR({${lenderIdCol}} = '${lenderRecordId}', {${lenderIdCol}} = '${escapeFormulaString(lenderIdText)}')`;
    if (lenderIdLookupCol) {
      lenderFilter = `OR(${lenderFilter}, {${lenderIdLookupCol}} = '${escapeFormulaString(lenderIdText)}')`;
    }
    let filterFormula = `AND(${lenderFilter}, OR({${dealRefCol}} = '${dealRecordId}', {${dealRefCol}} = '${escapeFormulaString(dealRef)}'))`;
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
      const lendersSchema = await getTableSchema(TABLES.LENDERS);
      const pipelineSchema = await getTableSchema(TABLES.PIPELINE);

      const lendersTableId = lendersSchema?.id;
      const pipelineTableId = pipelineSchema?.id;

      const lenderField = schema.fields.find((f: any) => {
        if (f.type === "multipleRecordLinks" && lendersTableId && f.options?.linkedTableId === lendersTableId) {
          return true;
        }
        const clean = f.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        return clean === "lenderid" || clean === "lendersid";
      });

      const dealField = schema.fields.find((f: any) => {
        if (f.type === "multipleRecordLinks" && pipelineTableId && f.options?.linkedTableId === pipelineTableId) {
          return true;
        }
        const clean = f.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        return clean === "dealref" || clean === "dealrefs" || clean === "dealreference";
      });

      const lenderKey = lenderField ? lenderField.name : "Lender_ID";
      const dealKey = dealField ? dealField.name : "Deal_Ref";

      if (lenderField?.type === "multipleRecordLinks") {
        fieldsToWrite[lenderKey] = [lenderRecordId];
      } else {
        fieldsToWrite[lenderKey] = lenderIdText;
      }

      if (dealField?.type === "multipleRecordLinks") {
        fieldsToWrite[dealKey] = [dealRecordId];
      } else {
        fieldsToWrite[dealKey] = dealRef;
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
