import {
  airtableCreate,
  airtableFetch,
  airtableFetchRecord,
  airtableUpdate,
  airtableDelete,
  getTableSchema,
  escapeFormulaString,
  TABLES,
  getAssignmentFields,
  normalizeLenderFields
} from "../_utils/airtable.js";
import { authenticateAdmin } from "./lenders.js";

function generatePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%&*";
  let pass = "";
  for (let i = 0; i < 8; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

async function generateUniqueSlug(companyName: string): Promise<string> {
  const normalized = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const slug = `${normalized || "lender"}-${randomSuffix}`;

  const existing = await airtableFetch(TABLES.LENDERS, {
    filterByFormula: `{Portal_Slug} = '${escapeFormulaString(slug)}'`,
    maxRecords: 1
  });

  if (existing.records && existing.records.length > 0) {
    return generateUniqueSlug(companyName);
  }

  return slug;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin
    authenticateAdmin(req);

    const { action } = req.body || {};
    if (!action) {
      return res.status(400).json({ error: "Action parameter is required" });
    }

    switch (action) {
      case "assign-deal": {
        const { lenderRecordId, dealRef } = req.body;
        if (!lenderRecordId || !dealRef) {
          return res.status(400).json({ error: "Lender record ID and Deal reference are required" });
        }

        const lenderData = await airtableFetchRecord(TABLES.LENDERS, lenderRecordId);
        const lenderIdText = lenderData.fields.Lender_ID;

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
            pipeFilterFormula = `OR(${formulas.join(", ")})`;
          }
        } else {
          pipeFilterFormula = `OR({REF No.} = '${escapeFormulaString(dealRef)}', {Deal_Ref} = '${escapeFormulaString(dealRef)}', {Deal Name} = '${escapeFormulaString(dealRef)}')`;
        }

        const pipelineRes = await airtableFetch(TABLES.PIPELINE, {
          filterByFormula: pipeFilterFormula,
          maxRecords: 1
        });

        if (!pipelineRes.records || pipelineRes.records.length === 0) {
          return res.status(404).json({ error: `Deal reference '${dealRef}' not found in active pipeline.` });
        }
        const dealRecordId = pipelineRes.records[0].id;

        const { lenderIdCol, dealRefCol, statusCol } = await getAssignmentFields();
        const existingFilterFormula = `AND({${lenderIdCol}} = '${lenderRecordId}', {${dealRefCol}} = '${dealRecordId}')`;
        const existingAssignments = await airtableFetch(TABLES.ASSIGNMENTS, {
          filterByFormula: existingFilterFormula
        });

        if (existingAssignments.records && existingAssignments.records.length > 0) {
          return res.status(200).json({ success: true, message: "Lender already assigned to this deal." });
        }

        const assignmentFields: Record<string, any> = {};
        assignmentFields[lenderIdCol] = [lenderRecordId];
        assignmentFields[dealRefCol] = [dealRecordId];
        if (statusCol) {
          assignmentFields[statusCol] = "Active";
        }
        assignmentFields.Assignment_ID = `ASG-${lenderIdText}-${dealRef}`;

        const createdAssignment = await airtableCreate(TABLES.ASSIGNMENTS, assignmentFields);
        return res.status(200).json({ success: true, result: createdAssignment });
      }

      case "remove-deal": {
        const { assignmentId } = req.body;
        if (!assignmentId) {
          return res.status(400).json({ error: "Assignment ID is required" });
        }
        await airtableDelete(TABLES.ASSIGNMENTS, assignmentId);
        return res.status(200).json({ success: true, message: "Deal assignment successfully removed." });
      }

      case "reset-password": {
        const { lenderRecordId } = req.body;
        if (!lenderRecordId) {
          return res.status(400).json({ error: "Lender record ID is required" });
        }
        const newPassword = generatePassword();
        await airtableUpdate(TABLES.LENDERS, lenderRecordId, {
          Portal_Password: newPassword
        });
        return res.status(200).json({ success: true, password: newPassword });
      }

      case "regenerate-portal": {
        const { lenderRecordId } = req.body;
        if (!lenderRecordId) {
          return res.status(400).json({ error: "Lender record ID is required" });
        }
        const lenderData = await airtableFetchRecord(TABLES.LENDERS, lenderRecordId);
        const normFields = normalizeLenderFields(lenderData.fields);
        const companyName = normFields.Company_Name;
        if (!companyName) {
          return res.status(400).json({ error: "Lender record does not contain a company name" });
        }
        const newSlug = await generateUniqueSlug(companyName);
        await airtableUpdate(TABLES.LENDERS, lenderRecordId, {
          Portal_Slug: newSlug
        });
        return res.status(200).json({ success: true, slug: newSlug });
      }

      case "delete-lender": {
        const { lenderRecordId } = req.body;
        if (!lenderRecordId) {
          return res.status(400).json({ error: "Lender record ID is required" });
        }
        const lenderData = await airtableFetchRecord(TABLES.LENDERS, lenderRecordId);
        const lenderIdText = lenderData.fields.Lender_ID;
        const { lenderIdCol } = await getAssignmentFields();
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
        await airtableDelete(TABLES.LENDERS, lenderRecordId);
        return res.status(200).json({ success: true, message: "Lender and all assignments successfully deleted." });
      }

      case "update-documents": {
        const { updates } = req.body;
        if (!updates || !Array.isArray(updates)) {
          return res.status(400).json({ error: "Updates list is required and must be an array" });
        }
        const results = await Promise.all(
          updates.map(async (update: { id: string; fields: Record<string, any> }) => {
            const { id, fields } = update;
            if (!id || !fields) {
              throw new Error("Each update must have an 'id' and 'fields' object");
            }
            return airtableUpdate(TABLES.DOCUMENTS, id, fields);
          })
        );
        return res.status(200).json({ success: true, results });
      }

      case "create-document": {
        const { documentName, category, status, driveLink, dealId, ablCritical } = req.body;
        if (!documentName || !category || !dealId) {
          return res.status(400).json({ error: "Document Name, Category, and Deal ID are required" });
        }
        const fields: Record<string, any> = {
          "Document_Name": documentName,
          "Category": category,
          "Status": status || "Outstanding",
          "Drive_Link": driveLink || "",
          "Deal_Ref": [dealId],
          "ABL_Critical": !!ablCritical
        };
        const result = await airtableCreate(TABLES.DOCUMENTS, fields);
        return res.status(200).json({ success: true, result });
      }

      case "create-deal": {
        const { companyName, dealRef, stage, sector, location, broker, dealFiles } = req.body;
        if (!companyName) {
          return res.status(400).json({ error: "Company Name is required" });
        }
        const generatedRef = dealRef || `ACP-${Math.floor(1000 + Math.random() * 9000)}`;
        const inboxFields: Record<string, any> = {
          "Deal Name": companyName,
          "REF. NO": generatedRef,
          "Sector": sector || "",
          "Location": location || "",
          "BROKER": broker || "",
          "Deal Files": dealFiles || "",
          "Status": "Passed Review"
        };
        const inboxRecord = await airtableCreate("Deal_Inbox", inboxFields);
        const pipelineFields: Record<string, any> = {
          "Deal Name": companyName,
          "Stage": stage || "Intro",
          "Deal_Inbox": [inboxRecord.id]
        };
        const pipelineRecord = await airtableCreate(TABLES.PIPELINE, pipelineFields);
        return res.status(200).json({
          success: true,
          inboxRecord,
          pipelineRecord
        });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}
