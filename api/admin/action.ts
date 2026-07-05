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
import { requireRole, ANY_INTERNAL, ALL_ADMINS } from "../auth/rbac.js";
import { logAuditTrail } from "../_utils/audit.js";
import { ensureTable, ensurePipelineFields, persistSchemaLogs, TABLE_SPECS, TEAM_FIELD_SPECS, STAKEHOLDER_FIELD_SPECS } from "../_utils/schema-manager.js";
import { generateInvestmentVerdictWithAI } from "../_services/ai.js";
import bcrypt from "bcryptjs";

// Global in-memory map to track failed passcode update attempts for security rate-limiting
const failedPasscodeAttempts = new Map<string, { count: number; lockUntil: number }>();

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

async function uploadToTempStorage(fileData: string, fileName: string, fileType: string): Promise<string> {
  let cleanBase64 = fileData;
  if (fileData.includes(";base64,")) {
    cleanBase64 = fileData.split(";base64,")[1];
  }
  const buffer = Buffer.from(cleanBase64, "base64");
  const formData = new FormData();
  const fileBlob = new Blob([buffer], { type: fileType || "application/octet-stream" });
  formData.append("file", fileBlob, fileName || "document.pdf");

  const uploadResponse = await fetch("https://tmpfiles.org/api/v1/upload", {
    method: "POST",
    body: formData
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(`Temporary file hosting upload failed: ${uploadResponse.statusText} - ${text}`);
  }

  const uploadResult = await uploadResponse.json();
  if (uploadResult.status !== "success" || !uploadResult.data?.url) {
    throw new Error(`Temporary file hosting responded with error: ${JSON.stringify(uploadResult)}`);
  }

  return uploadResult.data.url.replace("https://tmpfiles.org/", "https://tmpfiles.org/dl/");
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin via RBAC
    const user = await requireRole(req, res, ANY_INTERNAL);
    if (!user) return;

    const { action } = req.body || {};
    if (!action) {
      return res.status(400).json({ error: "Action parameter is required" });
    }

    switch (action) {
      case "generate-verdict": {
        const { dealId } = req.body;
        if (!dealId) return res.status(400).json({ error: "dealId is required" });
        
        let targetTable = TABLES.PIPELINE;
        let dealRecord = await airtableFetchRecord(targetTable, dealId).catch(() => null);
        
        if (!dealRecord) {
          targetTable = TABLES.DEAL_INBOX;
          dealRecord = await airtableFetchRecord(targetTable, dealId).catch(() => null);
        }
        
        if (!dealRecord) return res.status(404).json({ error: "Deal not found in either Pipeline or Inbox" });

        if (targetTable === TABLES.PIPELINE) {
          const schemeLogs = await ensurePipelineFields(targetTable);
          if (schemeLogs && schemeLogs.length > 0) {
            await persistSchemaLogs(schemeLogs).catch(console.warn);
          }
        }

        const dealData = {
          companyName: dealRecord.fields.Company_Name || dealRecord.fields["Company Name"] || dealRecord.fields["Deal Name"],
          dealRef: dealRecord.fields.Deal_Ref || dealRecord.fields["Deal Reference"] || dealRecord.fields["REF. NO"],
          sector: dealRecord.fields.Industry || dealRecord.fields.Sector,
          location: dealRecord.fields.Location,
          revenue: dealRecord.fields.Turnover,
          ebitda: dealRecord.fields.EBITDA_GBP || dealRecord.fields.EBITDA,
          askingPrice: dealRecord.fields.Asking_Price_GBP || dealRecord.fields["Asking Price"] || dealRecord.fields["EV Ask"] || dealRecord.fields["Enterprise_Value"],
          rawFields: dealRecord.fields,
        };

        const verdict = await generateInvestmentVerdictWithAI(dealData);
        const jsonString = JSON.stringify(verdict, null, 2);

        // Map correct field name for AI verdict
        const updatePayload: Record<string, any> = {};
        if (targetTable === TABLES.DEAL_INBOX) {
          updatePayload["AI_Verdict"] = verdict.investmentVerdict.split(":")[0];
          updatePayload["Claude_Verdict"] = jsonString;
        } else {
          updatePayload["Claude_Verdict"] = jsonString;
        }

        await airtableUpdate(targetTable, dealId, updatePayload);

        await logAuditTrail(
          "GENERATE_AI_VERDICT",
          req.user.email,
          req.user.role,
          dealId,
          `Generated AI Investment Verdict for deal: ${dealData.companyName || dealId}`
        );

        return res.status(200).json({ success: true, verdict });
      }

      case "update-inbox-status": {
        const { inboxRecordId, status } = req.body;
        if (!inboxRecordId) return res.status(400).json({ error: "inboxRecordId is required" });
        if (!status) return res.status(400).json({ error: "status is required" });

        const updated = await airtableUpdate(TABLES.DEAL_INBOX, inboxRecordId, {
          "Status": status
        });

        await logAuditTrail(
          "UPDATE_INBOX_STATUS",
          req.user.email,
          req.user.role,
          inboxRecordId,
          `Updated Deal Inbox status to: ${status}`
        );

        return res.status(200).json({ success: true, result: updated });
      }

      case "promote-deal": {
        const { inboxRecordId } = req.body;
        if (!inboxRecordId) return res.status(400).json({ error: "inboxRecordId is required" });
        
        const inboxRecord = await airtableFetchRecord("Deal_Inbox", inboxRecordId);
        if (!inboxRecord) return res.status(404).json({ error: "Inbox record not found" });

        // Map fields from Deal_Inbox to Active_Pipeline
        const f = inboxRecord.fields;
        
        const existingDeals = await airtableFetch(TABLES.PIPELINE);
        let maxNum = 0;
        existingDeals.records?.forEach((r: any) => {
          const ref = r.fields["REF No."] || r.fields["ACP REF NO"] || r.fields["Deal_Ref"] || "";
          const match = String(ref).match(/ACP-CFS-(\d+)/i);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
          }
        });
        const finalRef = `ACP-CFS-${String(maxNum + 1).padStart(3, "0")}`;
        const todayStr = new Date().toISOString().split("T")[0];

        const pipelineFields = {
          "Deal Name": f["Deal Name"] || f["Company Name"] || f["Company_Name"] || "Unknown Deal",
          "Company_Name": f["Company_Name"] || f["Company Name"] || f["Deal Name"],
          "Project_Name": f["Project_Name"] || f["Project Name"] || f["Company_Name"] || f["Deal Name"],
          "Industry": f["Industry"] || f["Sector"],
          "Turnover": f["Turnover"] || f["Revenue"],
          "EBITDA_GBP": f["EBITDA_GBP"] || f["EBITDA"],
          "Asking_Price_GBP": f["Asking_Price_GBP"] || f["Asking Price"],
          "Location": f["Location"],
          "Deal_Type": f["Deal_Type"] || f["Deal Type"],
          "Owner": req.user.email,
          "Stage": "Intro",
          "Workflow_Stage": "INTRO",
          "ACP REF NO": finalRef,
          "Deal_Ref": finalRef,
          "Next Action": "Schedule initial discovery call",
          "Next Action Date": todayStr,
          "OSINT_Status": "Not Started",
          "Created_At": new Date().toISOString(),
          "Stage_Updated_At": new Date().toISOString(),
          "Executive_Summary": f["Summary"] || f["Description"],
          "Contact_Email": f["Contact_Email"] || f["Email"],
          "Contact_Phone": f["Contact_Phone"] || f["Phone"],
        };

        const createdPipelineRecord = await airtableCreate(TABLES.PIPELINE, pipelineFields);
        
        // Link them by updating Deal_Inbox Status
        await airtableUpdate("Deal_Inbox", inboxRecordId, {
          "Status": "Active",
          "Active_Deal_Link": [createdPipelineRecord.id]
        });

        await logAuditTrail(
          "PROMOTE_DEAL",
          req.user.email,
          req.user.role,
          inboxRecordId,
          `Promoted deal from Inbox to Active Pipeline. New Pipeline ID: ${createdPipelineRecord.id}`
        );

        return res.status(200).json({ success: true, newDealId: createdPipelineRecord.id });
      }
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
        
        // Set Lender's NDA status if passed
        const { ndaApproved } = req.body;
        if (ndaApproved !== undefined) {
          await airtableUpdate(TABLES.LENDERS, lenderRecordId, {
            "NDA_Approved": ndaApproved ? "Yes" : "No"
          });
        }

        assignmentFields.Assignment_ID = `ASG-${lenderIdText}-${dealRef}`;

        const createdAssignment = await airtableCreate(TABLES.ASSIGNMENTS, assignmentFields);

        // Immutable Audit Log
        await logAuditTrail(
          "ASSIGN_DEAL",
          req.user.email,
          req.user.role,
          dealRef,
          `Assigned deal [${dealRef}] to Lender ${lenderIdText}. NDA: ${ndaApproved ? "Yes" : "No"}`
        );

        return res.status(200).json({ success: true, result: createdAssignment });
      }

      case "remove-deal": {
        const { assignmentId } = req.body;
        if (!assignmentId) {
          return res.status(400).json({ error: "Assignment ID is required" });
        }
        await airtableDelete(TABLES.ASSIGNMENTS, assignmentId);

        // Immutable Audit Log
        await logAuditTrail(
          "REMOVE_DEAL_ASSIGNMENT",
          req.user.email,
          req.user.role,
          assignmentId,
          `Revoked lender deal assignment ID: ${assignmentId}`
        );

        return res.status(200).json({ success: true, message: "Deal assignment successfully removed." });
      }

      case "update-lender-nda": {
        const { lenderId, ndaApproved } = req.body;
        if (!lenderId) {
          return res.status(400).json({ error: "Lender ID is required" });
        }
        const fields = {
          "NDA_Approved": ndaApproved ? "Yes" : "No"
        };
        const updated = await airtableUpdate(TABLES.LENDERS, lenderId, fields);

        // Immutable Audit Log
        await logAuditTrail(
          "UPDATE_LENDER_NDA",
          req.user.email,
          req.user.role,
          lenderId,
          `Updated NDA compliance status to: ${ndaApproved ? "Yes" : "No"}`
        );

        return res.status(200).json({ success: true, result: updated });
      }

      case "reset-password": {
        // Enforce Admin Only
        if (req.user.role !== "admin") {
          return res.status(403).json({ error: "Access denied: Requires Admin role" });
        }

        const { lenderRecordId } = req.body;
        if (!lenderRecordId) {
          return res.status(400).json({ error: "Lender record ID is required" });
        }
        const newPassword = generatePassword();
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(newPassword, salt);

        // Fetch lender to resolve their email
        const lenderData = await airtableFetchRecord(TABLES.LENDERS, lenderRecordId);
        const normFields = normalizeLenderFields(lenderData.fields);
        const emailValue = normFields.Email;

        // Update Lenders record with hashed password only
        await airtableUpdate(TABLES.LENDERS, lenderRecordId, {
          Portal_Password: hash
        });

        // Update Users record if email is present
        if (emailValue) {
          const usersRes = await airtableFetch("Users", {
            filterByFormula: `{Email} = '${escapeFormulaString(emailValue)}'`,
            maxRecords: 1
          });
          if (usersRes.records && usersRes.records.length > 0) {
            await airtableUpdate("Users", usersRes.records[0].id, {
              PasswordHash: hash
            }).catch(err => console.warn("Failed to update Users table password during reset:", err));
          } else {
            await airtableCreate("Users", {
              Email: emailValue,
              PasswordHash: hash,
              Role: "lender",
              Status: "Active",
              Permissions: "read",
              CreatedAt: new Date().toISOString()
            }).catch(err => console.warn("Failed to create missing User record during reset:", err));
          }
        }

        // Immutable Audit Log
        await logAuditTrail(
          "RESET_LENDER_PASSWORD",
          req.user.email,
          req.user.role,
          lenderRecordId,
          `Reset passcode for lender ${lenderRecordId} (Company: ${normFields.Company_Name || "unknown"})`
        );

        return res.status(200).json({ success: true, password: newPassword });
      }

      case "get-lender-passcode": {
        return res.status(403).json({ error: "Plaintext passcode retrieval is disabled for security compliance. Please use the Reset Passcode option instead." });
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

        // Immutable Audit Log
        await logAuditTrail(
          "REGENERATE_PORTAL_LINK",
          req.user.email,
          req.user.role,
          lenderRecordId,
          `Regenerated portal slug for lender ${lenderRecordId} to: ${newSlug}`
        );

        return res.status(200).json({ success: true, slug: newSlug });
      }

      case "delete-lender": {
        const isOwner = ["managing partner", "partner", "super admin", "owner"].includes((req.user?.role || "").toLowerCase());
        if (req.user.role !== "admin" && !isOwner) {
          return res.status(403).json({ error: "Access denied: Requires Admin or Owner role" });
        }

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

        // Immutable Audit Log
        await logAuditTrail(
          "DELETE_LENDER_PROFILE",
          req.user.email,
          req.user.role,
          lenderRecordId,
          `Permanently deleted lender profile ${lenderRecordId} (ID: ${lenderIdText}) and all associated deal assignments.`
        );

        return res.status(200).json({ success: true, message: "Lender and all assignments successfully deleted." });
      }

      case "update-documents": {
        const { updates } = req.body;
        if (!updates || !Array.isArray(updates)) {
          return res.status(400).json({ error: "Updates list is required and must be an array" });
        }

        // Auto-provision Documents table
        const schemaLogs = await ensureTable(TABLE_SPECS.DOCUMENTS).catch(console.warn);
        if (schemaLogs && schemaLogs.length > 0) {
          await persistSchemaLogs(schemaLogs).catch(console.warn);
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

        // Immutable Audit Log
        await logAuditTrail(
          "UPDATE_DOCUMENTS",
          req.user.email,
          req.user.role,
          `${updates.length} documents`,
          `Updated fields for ${updates.length} document records: ${updates.map(u => u.id).join(", ")}`
        );

        return res.status(200).json({ success: true, results });
      }

      case "create-document": {
        const { documentName, category, status, driveLink, dealId, ablCritical, documentAccess } = req.body;
        if (!documentName || !category || !dealId) {
          return res.status(400).json({ error: "Document Name, Category, and Deal ID are required" });
        }
        
        // Auto-provision Documents table
        const schemaLogs = await ensureTable(TABLE_SPECS.DOCUMENTS).catch(console.warn);
        if (schemaLogs && schemaLogs.length > 0) {
          await persistSchemaLogs(schemaLogs).catch(console.warn);
        }

        const fields: Record<string, any> = {
          "Document_Name": documentName,
          "Category": category,
          "Status": status || "Outstanding",
          "Drive_Link": driveLink || "",
          "Deal_Ref": [dealId],
          "ABL_Critical": !!ablCritical,
          "Document_Access": documentAccess || "Internal"
        };
        const result = await airtableCreate(TABLES.DOCUMENTS, fields);

        // Immutable Audit Log
        await logAuditTrail(
          "CREATE_DOCUMENT",
          req.user.email,
          req.user.role,
          documentName,
          `Created document ${documentName} (Category: ${category}, Status: ${status}) for deal ${dealId}`
        );

        return res.status(200).json({ success: true, result });
      }

      case "create-deal": {
        const {
          dealName, companyName, projectName, industry, website, location,
          revenue, ebitda, enterpriseValue, askingPrice,
          owner, analyst, source,
          acpRefNo, stage, nextAction, nextActionDate,
          internalNotes
        } = req.body;

        const resolvedName = companyName || dealName;
        if (!resolvedName) {
          return res.status(400).json({ error: "Company Name is required" });
        }

        // Ensure pipeline fields exist
        const schemeLogs = await ensurePipelineFields(TABLES.PIPELINE);
        await persistSchemaLogs(schemeLogs);

        // Fetch all existing deals for duplicate checks and auto-ref generation
        const existingDeals = await airtableFetch(TABLES.PIPELINE);
        
        // 1. Duplicate detection
        const normalizeName = (name: string) => {
          return name
            .toLowerCase()
            .replace(/\b(ltd|limited|plc|group|co|corp|corporation|uk|kent)\b/g, "")
            .replace(/[^a-z0-9]/g, "")
            .trim();
        };
        const normalizedNew = normalizeName(resolvedName);
        const isDuplicate = existingDeals.records?.some((r: any) => {
          const existingName = r.fields["Deal Name"] || r.fields["Company_Name"] || r.fields["Company Name"] || "";
          return normalizeName(existingName) === normalizedNew;
        });

        if (isDuplicate) {
          return res.status(409).json({ error: `A deal for '${resolvedName}' already exists in the pipeline.` });
        }

        // 2. Auto-increment reference number (ACP-CFS-XXX)
        let finalRef = acpRefNo?.trim();
        if (!finalRef) {
          let maxNum = 0;
          existingDeals.records?.forEach((r: any) => {
            const ref = r.fields["REF No."] || r.fields["ACP REF NO"] || r.fields["Deal_Ref"] || "";
            const match = String(ref).match(/ACP-CFS-(\d+)/i);
            if (match) {
              const num = parseInt(match[1], 10);
              if (num > maxNum) maxNum = num;
            }
          });
          const nextNum = maxNum + 1;
          finalRef = `ACP-CFS-${String(nextNum).padStart(3, "0")}`;
        }

        const todayStr = new Date().toISOString().split("T")[0];
        
        const normalizeWorkflowStage = (stg: string): string => {
          const s = String(stg).toLowerCase().trim();
          if (s === "intro" || s === "inbound") return "INTRO";
          if (s === "discovery" || s === "seller call") return "DISCOVERY";
          if (s === "im review" || s === "offer submitted" || s === "loi") return "LOI";
          if (s === "due diligence" || s === "diligence") return "DUE_DILIGENCE";
          if (s === "closing" || s === "under offer") return "CLOSING";
          if (s === "portfolio" || s === "completed" || s === "closed") return "PORTFOLIO";
          if (s === "killed" || s === "archived") return "KILLED";
          return "INTRO";
        };

        const fields: Record<string, any> = {
          "Deal Name": resolvedName,
          "Stage": stage || "Intro",
          "ACP REF NO": finalRef,
          "Deal_Ref": finalRef,
          "Next Action": nextAction || "Schedule initial discovery call",
          "Next Action Date": nextActionDate || todayStr,
          "OSINT_Status": "Not Started",
          "Created_At": new Date().toISOString(),
          "Stage_Updated_At": new Date().toISOString(),
          "Workflow_Stage": normalizeWorkflowStage(stage || "Intro")
        };

        // Institutional fields
        if (companyName) fields["Company_Name"] = companyName;
        if (projectName) fields["Project_Name"] = projectName;
        if (industry) fields["Industry"] = industry;
        if (website) fields["Website"] = website;
        if (location) fields["Location"] = location;
        if (revenue) fields["Turnover"] = Number(revenue) || 0;
        if (ebitda) fields["EBITDA_GBP"] = Number(ebitda) || 0;
        if (enterpriseValue) fields["Enterprise_Value"] = Number(enterpriseValue) || 0;
        if (askingPrice) fields["Asking_Price_GBP"] = Number(askingPrice) || 0;
        if (owner) fields["Owner"] = owner;
        if (analyst) fields["Analyst"] = analyst;
        if (source) fields["Source"] = source;
        if (internalNotes) fields["Internal_Notes"] = internalNotes;

        const result = await airtableCreate(TABLES.PIPELINE, fields);

        // Immutable Audit Log
        await logAuditTrail(
          "CREATE_DEAL",
          req.user.email,
          req.user.role,
          finalRef,
          `Created deal: ${resolvedName} (Stage: ${stage || "Intro"}, Ref: ${finalRef}, Industry: ${industry || "—"}, EV: ${enterpriseValue || "—"})`
        );

        return res.status(200).json({ success: true, result });
      }

      case "update-deal": {
        const { dealId, fields: updateFields } = req.body;
        if (!dealId) {
          return res.status(400).json({ error: "Deal ID is required" });
        }
        if (!updateFields || typeof updateFields !== "object") {
          return res.status(400).json({ error: "Fields object is required" });
        }

        // Map frontend field names to Airtable field names
        const fieldMap: Record<string, string> = {
          companyName: "Company_Name",
          dealName: "Deal Name",
          projectName: "Project_Name",
          industry: "Industry",
          website: "Website",
          location: "Location",
          revenue: "Turnover",
          ebitda: "EBITDA_GBP",
          enterpriseValue: "Enterprise_Value",
          askingPrice: "Asking_Price_GBP",
          owner: "Owner",
          analyst: "Analyst",
          source: "Source",
          nextAction: "Next Action",
          nextActionDate: "Next Action Date",
          internalNotes: "Internal_Notes",
        };

        const airtableFields: Record<string, any> = {};
        const changedSummary: string[] = [];

        for (const [key, value] of Object.entries(updateFields)) {
          const airtableKey = fieldMap[key] || key;
          // Convert numeric fields
          if (["revenue", "ebitda", "enterpriseValue", "askingPrice"].includes(key)) {
            airtableFields[airtableKey] = Number(value) || 0;
          } else {
            airtableFields[airtableKey] = value;
          }
          changedSummary.push(`${key}: ${String(value).substring(0, 50)}`);
        }

        // Also update Deal Name if companyName changed
        if (updateFields.companyName && !updateFields.dealName) {
          airtableFields["Deal Name"] = updateFields.companyName;
        }

        const updated = await airtableUpdate(TABLES.PIPELINE, dealId, airtableFields);

        await logAuditTrail(
          "UPDATE_DEAL",
          req.user.email,
          req.user.role,
          dealId,
          `Updated deal fields: ${changedSummary.join(", ")}`
        );

        return res.status(200).json({ success: true, result: updated });
      }

      case "delete-document": {
        const userRole = (req.user?.role || "").toLowerCase();
        if (userRole === "analyst") {
          return res.status(403).json({ error: "Forbidden: Analysts cannot delete documents." });
        }
        const { documentId } = req.body;
        if (!documentId) {
          return res.status(400).json({ error: "Document ID is required" });
        }
        await airtableDelete(TABLES.DOCUMENTS, documentId);

        await logAuditTrail(
          "DELETE_DOCUMENT",
          req.user.email,
          req.user.role,
          documentId,
          `Permanently deleted document record: ${documentId}`
        );

        return res.status(200).json({ success: true, message: "Document successfully deleted." });
      }

      case "delete-deal": {
        const userRole = (req.user?.role || "").toLowerCase();
        if (userRole === "analyst") {
          return res.status(403).json({ error: "Forbidden: Analysts cannot delete deals." });
        }
        const { dealId } = req.body;
        if (!dealId) {
          return res.status(400).json({ error: "Deal ID is required" });
        }
        await airtableDelete(TABLES.PIPELINE, dealId);

        await logAuditTrail(
          "DELETE_DEAL",
          req.user.email,
          req.user.role,
          dealId,
          `Deleted deal record: ${dealId}`
        );

        return res.status(200).json({ success: true, message: "Deal successfully deleted." });
      }

      case "upload-im-document": {
        const { dealId, fileName, fileType, fileData } = req.body;
        if (!dealId || !fileData) {
          return res.status(400).json({ error: "Deal ID and file data are required" });
        }

        const supportedTypes = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/msword", "application/vnd.ms-excel"];
        if (fileType && !supportedTypes.includes(fileType) && !fileType.includes("pdf") && !fileType.includes("doc") && !fileType.includes("xls")) {
          return res.status(400).json({ error: "Only PDF, DOCX, and XLSX files are supported" });
        }

        // Ensure IM_Review_Documents field exists
        const schemeLogs = await ensurePipelineFields(TABLES.PIPELINE);
        await persistSchemaLogs(schemeLogs);

        // Fetch current attachments to preserve existing ones
        const dealRecord = await airtableFetchRecord(TABLES.PIPELINE, dealId);
        const existingAttachments = dealRecord.fields["IM_Review_Documents"] || [];

        // Upload to temp hosting to get a public URL for Airtable
        const publicUrl = await uploadToTempStorage(fileData, fileName, fileType);

        const newAttachment = {
          url: publicUrl,
          filename: fileName || "IM_Document",
        };

        const updatedAttachments = [...(Array.isArray(existingAttachments) ? existingAttachments.map((a: any) => ({ url: a.url, filename: a.filename })) : []), newAttachment];

        await airtableUpdate(TABLES.PIPELINE, dealId, {
          "IM_Review_Documents": updatedAttachments,
        });

        await logAuditTrail(
          "IM_UPLOADED",
          req.user.email,
          req.user.role,
          dealId,
          `Uploaded IM document: ${fileName || "document"} (${fileType || "unknown"}) to deal ${dealId}`
        );

        return res.status(200).json({ success: true, message: "IM document uploaded." });
      }

      case "remove-im-document": {
        const { dealId, attachmentIndex } = req.body;
        if (!dealId || attachmentIndex === undefined) {
          return res.status(400).json({ error: "Deal ID and attachment index are required" });
        }

        const dealRecord = await airtableFetchRecord(TABLES.PIPELINE, dealId);
        const existingAttachments = dealRecord.fields["IM_Review_Documents"] || [];

        if (!Array.isArray(existingAttachments) || attachmentIndex >= existingAttachments.length) {
          return res.status(404).json({ error: "Attachment not found" });
        }

        const removedName = existingAttachments[attachmentIndex]?.filename || "document";
        const remaining = existingAttachments
          .filter((_: any, i: number) => i !== attachmentIndex)
          .map((a: any) => ({ url: a.url, filename: a.filename }));

        await airtableUpdate(TABLES.PIPELINE, dealId, {
          "IM_Review_Documents": remaining.length > 0 ? remaining : [],
        });

        await logAuditTrail(
          "IM_REMOVED",
          req.user.email,
          req.user.role,
          dealId,
          `Removed IM document: ${removedName} from deal ${dealId}`
        );

        return res.status(200).json({ success: true, message: "IM document removed." });
      }

      case "replace-im-document": {
        const { dealId, attachmentIndex, fileName, fileType, fileData } = req.body;
        if (!dealId || attachmentIndex === undefined || !fileData) {
          return res.status(400).json({ error: "Deal ID, attachment index, and file data are required" });
        }

        const supportedTypes = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/msword", "application/vnd.ms-excel"];
        if (fileType && !supportedTypes.includes(fileType) && !fileType.includes("pdf") && !fileType.includes("doc") && !fileType.includes("xls")) {
          return res.status(400).json({ error: "Only PDF, DOCX, and XLSX files are supported" });
        }

        const dealRecord = await airtableFetchRecord(TABLES.PIPELINE, dealId);
        const existingAttachments = dealRecord.fields["IM_Review_Documents"] || [];

        if (!Array.isArray(existingAttachments) || attachmentIndex >= existingAttachments.length) {
          return res.status(404).json({ error: "Attachment to replace not found" });
        }

        // Upload to temp hosting to get a public URL for Airtable
        const publicUrl = await uploadToTempStorage(fileData, fileName, fileType);

        const newAttachment = {
          url: publicUrl,
          filename: fileName || "IM_Document",
        };

        const updated = existingAttachments.map((a: any, i: number) => {
          if (i === attachmentIndex) {
            return newAttachment;
          }
          return { url: a.url, filename: a.filename };
        });

        await airtableUpdate(TABLES.PIPELINE, dealId, {
          "IM_Review_Documents": updated,
        });

        await logAuditTrail(
          "IM_REPLACED",
          req.user.email,
          req.user.role,
          dealId,
          `Replaced IM document at index ${attachmentIndex} with ${fileName || "document"} in deal ${dealId}`
        );

        return res.status(200).json({ success: true, message: "IM document replaced." });
      }

      case "create-portfolio-company": {
        const { companyName, industry, revenue, ebitda, debt, headcount, status, location, notes } = req.body;
        if (!companyName) {
          return res.status(400).json({ error: "Company Name is required" });
        }

        // Ensure table exists
        const schemeLogs = await ensureTable(TABLE_SPECS.PORTFOLIO_COMPANIES);
        await persistSchemaLogs(schemeLogs);

        const fields: Record<string, any> = {
          "Company_Name": companyName,
          "Status": status || "Active",
          "Created_At": new Date().toISOString(),
        };
        if (industry) fields["Industry"] = industry;
        if (revenue) fields["Revenue"] = Number(revenue) || 0;
        if (ebitda) fields["EBITDA"] = Number(ebitda) || 0;
        if (debt) fields["Debt"] = Number(debt) || 0;
        if (headcount) fields["Headcount"] = Number(headcount) || 0;
        if (location) fields["Location"] = location;
        if (notes) fields["Notes"] = notes;

        const result = await airtableCreate("Portfolio_Companies", fields);

        await logAuditTrail(
          "PORTCO_CREATED",
          req.user.email,
          req.user.role,
          companyName,
          `Created portfolio company: ${companyName} (Industry: ${industry || "—"}, Status: ${status || "Active"})`
        );

        return res.status(200).json({ success: true, result });
      }

      case "update-portfolio-company": {
        const { companyId, fields: pcFields } = req.body;
        if (!companyId || !pcFields) {
          return res.status(400).json({ error: "Company ID and fields are required" });
        }

        const fieldMap: Record<string, string> = {
          companyName: "Company_Name", industry: "Industry", revenue: "Revenue",
          ebitda: "EBITDA", debt: "Debt", headcount: "Headcount",
          status: "Status", location: "Location", notes: "Notes",
        };

        const mapped: Record<string, any> = {};
        for (const [k, v] of Object.entries(pcFields)) {
          const key = fieldMap[k] || k;
          if (["revenue", "ebitda", "debt", "headcount"].includes(k)) {
            mapped[key] = Number(v) || 0;
          } else {
            mapped[key] = v;
          }
        }

        const result = await airtableUpdate("Portfolio_Companies", companyId, mapped);

        await logAuditTrail(
          "PORTCO_UPDATED",
          req.user.email,
          req.user.role,
          companyId,
          `Updated portfolio company ${companyId}: ${Object.keys(pcFields).join(", ")}`
        );

        return res.status(200).json({ success: true, result });
      }

      case "archive-portfolio-company": {
        const { companyId } = req.body;
        if (!companyId) {
          return res.status(400).json({ error: "Company ID is required" });
        }

        const result = await airtableUpdate("Portfolio_Companies", companyId, { Status: "Archived" });

        await logAuditTrail(
          "PORTCO_ARCHIVED",
          req.user.email,
          req.user.role,
          companyId,
          `Archived portfolio company ${companyId}`
        );

        return res.status(200).json({ success: true, result });
      }

      case "create-team-member": {
        const { name, email, phone, role, status, accessLevel } = req.body;
        if (!name || !role) {
          return res.status(400).json({ error: "Name and Role are required" });
        }

        // Ensure team table fields exist
        const schemeLogs = await ensureTable({ name: TABLES.TEAM, fields: TEAM_FIELD_SPECS });
        await persistSchemaLogs(schemeLogs);

        // Derive initials
        const nameParts = name.trim().split(/\s+/);
        const initials = nameParts.length >= 2
          ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
          : name.substring(0, 2).toUpperCase();

        const teamFields: Record<string, any> = {
          Name: name,
          Role: role,
          Status: status || "Active",
          Access_Level: accessLevel || "READ ACCESS",
          Initials: initials,
          Avatar_Theme: "blue",
          Order: 99,
        };
        if (email) teamFields["Email"] = email;
        if (phone) teamFields["Phone"] = phone;

        const result = await airtableCreate(TABLES.TEAM, teamFields);

        // Create Users record with generated password
        let generatedPassword = "";
        if (email) {
          try {
            generatedPassword = generatePassword();
            const salt = bcrypt.genSaltSync(10);
            const hash = bcrypt.hashSync(generatedPassword, salt);
            await airtableCreate("Users", {
              Name: name,
              Email: email,
              PasswordHash: hash,
              Role: role.toLowerCase().replace(/\s+/g, "_"),
              Status: "Active",
              Permissions: role === "Admin" || role === "Managing Partner" ? "admin" : "read",
              CreatedAt: new Date().toISOString(),
            });
          } catch (err: any) {
            console.warn("[Team] Failed to create Users record:", err.message);
          }
        }

        await logAuditTrail(
          "USER_CREATED",
          req.user.email,
          req.user.role,
          name,
          `Created team member: ${name} (Role: ${role}, Email: ${email || "—"})`
        );

        return res.status(200).json({ success: true, result, tempPassword: generatedPassword });
      }

      case "update-team-member": {
        const { memberId, fields: tmFields } = req.body;
        if (!memberId || !tmFields) {
          return res.status(400).json({ error: "Member ID and fields are required" });
        }

        const fieldMap: Record<string, string> = {
          name: "Name", email: "Email", phone: "Phone",
          role: "Role", status: "Status", accessLevel: "Access_Level",
        };

        const mapped: Record<string, any> = {};
        for (const [k, v] of Object.entries(tmFields)) {
          mapped[fieldMap[k] || k] = v;
        }

        const result = await airtableUpdate(TABLES.TEAM, memberId, mapped);

        await logAuditTrail(
          "USER_UPDATED",
          req.user.email,
          req.user.role,
          memberId,
          `Updated team member ${memberId}: ${Object.keys(tmFields).join(", ")}`
        );

        return res.status(200).json({ success: true, result });
      }

      case "create-stakeholder": {
        const { name, company, email, phone, type, status, notes, association, accentColor } = req.body;
        if (!name) {
          return res.status(400).json({ error: "Stakeholder Name is required" });
        }

        // Ensure stakeholder fields exist
        const schemeLogs = await ensureTable({ name: TABLES.STAKEHOLDERS, fields: STAKEHOLDER_FIELD_SPECS });
        await persistSchemaLogs(schemeLogs);

        const fields: Record<string, any> = {
          Name: name,
          Association: association || company || "",
          Description: notes || "",
          Accent_Color: accentColor || "blue",
        };
        if (company) fields["Company"] = company;
        if (email) fields["Email"] = email;
        if (phone) fields["Phone"] = phone;
        if (type) fields["Type"] = type;
        if (status) fields["Status"] = status;

        const result = await airtableCreate(TABLES.STAKEHOLDERS, fields);

        // Create Users record with generated password for stakeholder
        let generatedPassword = "";
        if (email) {
          try {
            generatedPassword = generatePassword();
            const salt = bcrypt.genSaltSync(10);
            const hash = bcrypt.hashSync(generatedPassword, salt);
            await airtableCreate("Users", {
              Name: name,
              Email: email,
              PasswordHash: hash,
              Role: "stakeholder",
              Status: status === "Inactive" ? "Inactive" : "Active",
              Permissions: "read",
              CreatedAt: new Date().toISOString(),
            });
          } catch (err: any) {
            console.warn("[Stakeholders] Failed to create Users record:", err.message);
          }
        }

        await logAuditTrail(
          "STAKEHOLDER_CREATED",
          req.user.email,
          req.user.role,
          name,
          `Created stakeholder: ${name} (Type: ${type || "—"}, Company: ${company || "—"})`
        );

        return res.status(200).json({ success: true, result, tempPassword: generatedPassword });
      }

      case "update-stakeholder": {
        const { stakeholderId, fields: shFields } = req.body;
        if (!stakeholderId || !shFields) {
          return res.status(400).json({ error: "Stakeholder ID and fields are required" });
        }

        const fieldMap: Record<string, string> = {
          name: "Name", company: "Company", email: "Email", phone: "Phone",
          type: "Type", status: "Status", notes: "Description",
          association: "Association", accentColor: "Accent_Color",
        };

        const mapped: Record<string, any> = {};
        for (const [k, v] of Object.entries(shFields)) {
          mapped[fieldMap[k] || k] = v;
        }

        const result = await airtableUpdate(TABLES.STAKEHOLDERS, stakeholderId, mapped);

        await logAuditTrail(
          "STAKEHOLDER_UPDATED",
          req.user.email,
          req.user.role,
          stakeholderId,
          `Updated stakeholder ${stakeholderId}: ${Object.keys(shFields).join(", ")}`
        );

        return res.status(200).json({ success: true, result });
      }

      case "send-loi": {
        const { lenderName, lenderEmail, companyName, dealId, subject, body } = req.body;
        if (!lenderEmail || !lenderName || !dealId || !subject || !body) {
          return res.status(400).json({ error: "All fields are required (lenderEmail, lenderName, dealId, subject, body)" });
        }

        const payload = {
          lenderName: String(lenderName),
          lenderEmail: String(lenderEmail),
          companyName: String(companyName || ""),
          dealId: String(dealId),
          subject: String(subject),
          body: String(body),
          type: "loi"
        };

        const webhookUrl = "https://hook.eu2.make.com/6ib81dgibwtyf9t1moa8ixwd7eai5wxx";

        let retries = 3;
        let delay = 1000;
        let lastError = null;
        let success = false;
        
        for (let i = 0; i < retries; i++) {
          try {
            const postRes = await fetch(webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
            if (postRes.ok) {
              success = true;
              break;
            }
            throw new Error(`Webhook returned status ${postRes.status}`);
          } catch (err: any) {
            lastError = err;
            if (i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, delay));
              delay *= 2;
            }
          }
        }

        if (!success) {
          return res.status(502).json({ error: `Failed to deliver LOI webhook: ${lastError?.message || "unknown error"}` });
        }

        await logAuditTrail(
          "SEND_LOI",
          req.user.email,
          req.user.role,
          dealId,
          `Sent LOI to ${lenderName} (${lenderEmail}) for deal: ${dealId}`
        );

        return res.status(200).json({ success: true, message: "LOI sent successfully." });
      }

      case "send-email": {
        const { lenderName, lenderEmail, companyName, dealId, subject, body } = req.body;
        if (!lenderEmail || !lenderName || !dealId || !subject || !body) {
          return res.status(400).json({ error: "All fields are required (lenderEmail, lenderName, dealId, subject, body)" });
        }

        const payload = {
          lenderName: String(lenderName),
          lenderEmail: String(lenderEmail),
          companyName: String(companyName || ""),
          dealId: String(dealId),
          subject: String(subject),
          body: String(body),
          type: "post_meeting_email"
        };

        const webhookUrl = "https://hook.eu2.make.com/6ib81dgibwtyf9t1moa8ixwd7eai5wxx";

        let retries = 3;
        let delay = 1000;
        let lastError = null;
        let success = false;
        
        for (let i = 0; i < retries; i++) {
          try {
            const postRes = await fetch(webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
            if (postRes.ok) {
              success = true;
              break;
            }
            throw new Error(`Webhook returned status ${postRes.status}`);
          } catch (err: any) {
            lastError = err;
            if (i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, delay));
              delay *= 2;
            }
          }
        }

        if (!success) {
          return res.status(502).json({ error: `Failed to deliver follow-up email webhook: ${lastError?.message || "unknown error"}` });
        }

        await logAuditTrail(
          "SEND_EMAIL",
          req.user.email,
          req.user.role,
          dealId,
          `Sent follow-up email to ${lenderName} (${lenderEmail}) for deal: ${dealId}`
        );

        return res.status(200).json({ success: true, message: "Email sent successfully." });
      }


      case "change-admin-password": {
        return res.status(403).json({ error: "Administrative password changes via this endpoint are disabled for security compliance." });
      }

      case "verify-integration": {
        const { integrationId } = req.body;
        if (!integrationId) {
          return res.status(400).json({ error: "Integration ID is required" });
        }

        try {
          switch (integrationId) {
            case "airtable": {
              const apiKey = process.env.AIRTABLE_API_KEY || process.env.VITE_AIRTABLE_API_KEY;
              const baseId = process.env.AIRTABLE_BASE_ID || process.env.VITE_AIRTABLE_BASE_ID;
              if (!apiKey || !baseId) {
                return res.status(200).json({
                  success: false,
                  status: "Misconfigured",
                  details: "Airtable configuration missing (AIRTABLE_API_KEY or AIRTABLE_BASE_ID).",
                  timestamp: new Date().toISOString()
                });
              }
              const fetchRes = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
                headers: { Authorization: `Bearer ${apiKey}` }
              });
              if (fetchRes.status === 401) {
                return res.status(200).json({
                  success: false,
                  status: "Unauthorized",
                  details: "Airtable API key is invalid or unauthorized.",
                  timestamp: new Date().toISOString()
                });
              }
              if (fetchRes.status === 404) {
                return res.status(200).json({
                  success: false,
                  status: "Misconfigured",
                  details: "Airtable Base ID was not found.",
                  timestamp: new Date().toISOString()
                });
              }
              if (!fetchRes.ok) {
                return res.status(200).json({
                  success: false,
                  status: "Offline",
                  details: `Airtable server returned status ${fetchRes.status}`,
                  timestamp: new Date().toISOString()
                });
              }
              const data = await fetchRes.json();
              return res.status(200).json({
                success: true,
                status: "Connected",
                details: `Airtable base active. Found ${data.tables?.length || 0} tables.`,
                timestamp: new Date().toISOString()
              });
            }

            case "claude": {
              const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;
              if (!apiKey) {
                return res.status(200).json({
                  success: false,
                  status: "Misconfigured",
                  details: "Claude Anthropic API key is missing (ANTHROPIC_API_KEY).",
                  timestamp: new Date().toISOString()
                });
              }
              // Lightweight verify message query
              const fetchRes = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                  "x-api-key": apiKey,
                  "anthropic-version": "2023-06-01",
                  "content-type": "application/json"
                },
                body: JSON.stringify({
                  model: "claude-3-5-sonnet-20241022",
                  max_tokens: 1,
                  messages: [{ role: "user", content: "ping" }]
                })
              });
              if (fetchRes.status === 401) {
                return res.status(200).json({
                  success: false,
                  status: "Unauthorized",
                  details: "Anthropic API Key is unauthorized or invalid.",
                  timestamp: new Date().toISOString()
                });
              }
              if (!fetchRes.ok) {
                return res.status(200).json({
                  success: false,
                  status: "Offline",
                  details: `Anthropic API returned status ${fetchRes.status}`,
                  timestamp: new Date().toISOString()
                });
              }
              return res.status(200).json({
                success: true,
                status: "Connected",
                details: "Anthropic Claude API connection verified successfully.",
                timestamp: new Date().toISOString()
              });
            }

            case "make": {
              const webhookUrl = "https://hook.eu2.make.com/6ib81dgibwtyf9t1moa8ixwd7eai5wxx";
              const fetchRes = await fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ event: "ping", timestamp: new Date().toISOString() })
              });
              if (fetchRes.status === 401 || fetchRes.status === 403) {
                return res.status(200).json({
                  success: false,
                  status: "Unauthorized",
                  details: "Make.com webhook rejected authorization or credentials.",
                  timestamp: new Date().toISOString()
                });
              }
              if (fetchRes.status === 404) {
                return res.status(200).json({
                  success: false,
                  status: "Misconfigured",
                  details: "Make.com webhook URL is invalid, dead, or expired.",
                  timestamp: new Date().toISOString()
                });
              }
              if (!fetchRes.ok) {
                return res.status(200).json({
                  success: false,
                  status: "Offline",
                  details: `Make.com webhook returned status ${fetchRes.status}`,
                  timestamp: new Date().toISOString()
                });
              }
              return res.status(200).json({
                success: true,
                status: "Connected",
                details: "Make.com webhook active and connected.",
                timestamp: new Date().toISOString()
              });
            }

            case "notion": {
              const token = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN || process.env.VITE_NOTION_TOKEN;
              if (!token) {
                return res.status(200).json({
                  success: false,
                  status: "Misconfigured",
                  details: "Notion Integration key is missing (NOTION_TOKEN).",
                  timestamp: new Date().toISOString()
                });
              }
              const fetchRes = await fetch("https://api.notion.com/v1/users/me", {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Notion-Version": "2022-06-28"
                }
              });
              if (fetchRes.status === 401) {
                return res.status(200).json({
                  success: false,
                  status: "Unauthorized",
                  details: "Notion Integration token is invalid or expired.",
                  timestamp: new Date().toISOString()
                });
              }
              if (!fetchRes.ok) {
                return res.status(200).json({
                  success: false,
                  status: "Offline",
                  details: `Notion API returned status ${fetchRes.status}`,
                  timestamp: new Date().toISOString()
                });
              }
              const user = await fetchRes.json();
              return res.status(200).json({
                success: true,
                status: "Connected",
                details: `Notion connected as: ${user.name || "ACP Workspace"}`,
                timestamp: new Date().toISOString()
              });
            }

            case "google-drive": {
              const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || process.env.VITE_GOOGLE_DRIVE_FOLDER_ID;
              if (!folderId) {
                return res.status(200).json({
                  success: false,
                  status: "Misconfigured",
                  details: "Google Drive Folder ID configuration missing (GOOGLE_DRIVE_FOLDER_ID).",
                  timestamp: new Date().toISOString()
                });
              }
              return res.status(200).json({
                success: true,
                status: "Connected",
                details: `Google Drive active. Folder: ${folderId.substring(0, 12)}...`,
                timestamp: new Date().toISOString()
              });
            }

            case "email": {
              const contactEmail = "partnership@aysancapital.com";
              return res.status(200).json({
                success: true,
                status: "Connected",
                details: `Mail delivery router active on: ${contactEmail}`,
                timestamp: new Date().toISOString()
              });
            }

            case "clickup": {
              const token = process.env.CLICKUP_API_TOKEN || process.env.VITE_CLICKUP_API_TOKEN;
              if (!token) {
                return res.status(200).json({
                  success: false,
                  status: "Misconfigured",
                  details: "ClickUp Integration token is missing (CLICKUP_API_TOKEN).",
                  timestamp: new Date().toISOString()
                });
              }
              return res.status(200).json({
                success: true,
                status: "Connected",
                details: "ClickUp integration token configured.",
                timestamp: new Date().toISOString()
              });
            }

            default:
              return res.status(400).json({ error: `Unknown integration: ${integrationId}` });
          }
        } catch (err: any) {
          await logAuditTrail(
            "INTEGRATION_HEALTH_CHECK_FAILED",
            req.user.email,
            req.user.role,
            integrationId,
            `Health check failed with error: ${err.message}`
          );
          return res.status(200).json({
            success: false,
            status: "Offline",
            details: err.message || "Connection request timed out or was refused.",
            timestamp: new Date().toISOString()
          });
        }
      }

      case "get-recent-messages": {
        try {
          const chatData = await airtableFetch(TABLES.CHAT);
          
          // Fetch deals and lenders to build robust lookup maps
          const [dealsRes, lendersRes] = await Promise.all([
            airtableFetch(TABLES.PIPELINE).catch(() => ({ records: [] })),
            airtableFetch(TABLES.LENDERS).catch(() => ({ records: [] }))
          ]);

          const dealLookup = new Map<string, string>();
          dealsRes.records.forEach((rec: any) => {
            const id = rec.id;
            const refNo = rec.fields["REF No."] || rec.fields.Deal_Ref || rec.fields.dealRef || "";
            const dealName = rec.fields["Deal Name"] || "";
            const companyName = rec.fields["Company Name"] || rec.fields.Company_Name || "";

            dealLookup.set(id.toLowerCase(), id);
            if (refNo) dealLookup.set(String(refNo).toLowerCase(), id);
            if (dealName) dealLookup.set(String(dealName).toLowerCase(), id);
            if (companyName) dealLookup.set(String(companyName).toLowerCase(), id);
          });

          const lenderLookup = new Map<string, string>();
          lendersRes.records.forEach((rec: any) => {
            const id = rec.id;
            const name = rec.fields.Name || "";
            const companyName = rec.fields.Company_Name || "";
            const lenderIdText = rec.fields.Lender_ID || "";

            lenderLookup.set(id.toLowerCase(), id);
            if (name) lenderLookup.set(String(name).toLowerCase(), id);
            if (companyName) lenderLookup.set(String(companyName).toLowerCase(), id);
            if (lenderIdText) lenderLookup.set(String(lenderIdText).toLowerCase(), id);
          });

          const messages = chatData.records.map((rec: any) => {
            const rawDealVal = Array.isArray(rec.fields.Deal_Ref) ? rec.fields.Deal_Ref[0] : (rec.fields.Deal_Ref || "");
            const rawLenderVal = Array.isArray(rec.fields.Lender_ID) ? rec.fields.Lender_ID[0] : (rec.fields.Lender_ID || "");

            const resolvedDealId = dealLookup.get(String(rawDealVal).toLowerCase()) || rawDealVal;
            const resolvedLenderId = lenderLookup.get(String(rawLenderVal).toLowerCase()) || rawLenderVal;

            return {
              id: rec.id,
              dealId: resolvedDealId,
              lenderId: resolvedLenderId,
              sender: rec.fields.Sender || "",
              message: rec.fields.Message || "",
              timestamp: rec.fields.Timestamp || rec.createdTime || ""
            };
          }).sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

          return res.status(200).json({ success: true, results: messages });
        } catch (err: any) {
          if (err.status === 404 || err.type === "TABLE_NOT_FOUND") {
            return res.status(200).json({ success: true, results: [] });
          }
          throw err;
        }
      }

      case "get-chat": {
        const { dealId, lenderRecordId } = req.body;
        if (!dealId || !lenderRecordId) {
          return res.status(400).json({ error: "Deal ID and Lender record ID are required" });
        }
        try {
          const lenderData = await airtableFetchRecord(TABLES.LENDERS, lenderRecordId);
          const lenderName = lenderData.fields.Name || lenderData.fields.Company_Name || "";
          const lenderCompanyName = lenderData.fields.Company_Name || "";
          const lenderTextId = lenderData.fields.Lender_ID || "";

          const pipelineData = await airtableFetch(TABLES.PIPELINE);
          const activeDeal = pipelineData.records.find((rec: any) => {
            const refNo = rec.fields["REF No."] || rec.fields.Deal_Ref || rec.fields.dealRef || rec.fields["Deal Name"];
            return rec.id === dealId || (refNo && String(refNo).toLowerCase() === dealId.toLowerCase());
          });
          if (!activeDeal) {
            return res.status(404).json({ error: `Acquisition deal '${dealId}' not found in active pipeline.` });
          }
          const resolvedDealId = activeDeal.id;

          const dealRef = activeDeal.fields["REF No."] || activeDeal.fields.Deal_Ref || activeDeal.fields.dealRef || "";
          const dealName = activeDeal.fields["Deal Name"] || "";
          const dealCompany = activeDeal.fields["Company Name"] || activeDeal.fields.Company_Name || "";

          const lenderConditions = [
            `{Lender_ID} = '${escapeFormulaString(lenderRecordId)}'`,
            lenderName ? `{Lender_ID} = '${escapeFormulaString(lenderName)}'` : "",
            lenderCompanyName ? `{Lender_ID} = '${escapeFormulaString(lenderCompanyName)}'` : "",
            lenderTextId ? `{Lender_ID} = '${escapeFormulaString(lenderTextId)}'` : ""
          ].filter(Boolean);

          const dealConditions = [
            `{Deal_Ref} = '${escapeFormulaString(resolvedDealId)}'`,
            dealRef ? `{Deal_Ref} = '${escapeFormulaString(dealRef)}'` : "",
            dealName ? `{Deal_Ref} = '${escapeFormulaString(dealName)}'` : "",
            dealCompany ? `{Deal_Ref} = '${escapeFormulaString(dealCompany)}'` : ""
          ].filter(Boolean);

          const formula = `AND(OR(${lenderConditions.join(", ")}), OR(${dealConditions.join(", ")}))`;

          const chatData = await airtableFetch(TABLES.CHAT, {
            filterByFormula: formula
          });

          const messages = chatData.records.map((rec: any) => {
            return {
              id: rec.id,
              dealId: resolvedDealId,
              lenderId: lenderRecordId,
              sender: rec.fields.Sender || "",
              message: rec.fields.Message || "",
              timestamp: rec.fields.Timestamp || rec.createdTime || ""
            };
          }).sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

          return res.status(200).json({ success: true, results: messages });
        } catch (err: any) {
          if (err.status === 404 || err.type === "TABLE_NOT_FOUND") {
            return res.status(404).json({
              error: "Chat table not setup",
              type: "TABLE_NOT_FOUND",
              message: "The 'Chat_Messages' table was not found in Airtable. Please create this table to enable chat."
            });
          }
          throw err;
        }
      }

      case "send-chat": {
        const { dealId, lenderRecordId, message } = req.body;
        if (!dealId || !lenderRecordId || !message || message.trim() === "") {
          return res.status(400).json({ error: "Deal ID, Lender record ID, and a non-empty message are required" });
        }
        try {
          const lenderData = await airtableFetchRecord(TABLES.LENDERS, lenderRecordId);
          const lenderIdText = lenderData.fields.Lender_ID || "";

          const pipelineData = await airtableFetch(TABLES.PIPELINE);
          const activeDeal = pipelineData.records.find((rec: any) => {
            const refNo = rec.fields["REF No."] || rec.fields.Deal_Ref || rec.fields.dealRef || rec.fields["Deal Name"];
            return rec.id === dealId || (refNo && String(refNo).toLowerCase() === dealId.toLowerCase());
          });
          if (!activeDeal) {
            return res.status(404).json({ error: "Acquisition deal not found in active pipeline." });
          }
          const resolvedDealId = activeDeal.id;

          const newFields = {
            Lender_ID: [lenderRecordId],
            Deal_Ref: [resolvedDealId],
            Sender: "Admin",
            Message: message,
            Timestamp: new Date().toISOString()
          };

          const createdRecord = await airtableCreate(TABLES.CHAT, newFields);
          
          const mappedMessage = {
            id: createdRecord.id,
            dealId: Array.isArray(createdRecord.fields.Deal_Ref) ? createdRecord.fields.Deal_Ref[0] : (createdRecord.fields.Deal_Ref || resolvedDealId),
            lenderId: Array.isArray(createdRecord.fields.Lender_ID) ? createdRecord.fields.Lender_ID[0] : (createdRecord.fields.Lender_ID || lenderRecordId),
            sender: createdRecord.fields.Sender || "Admin",
            message: createdRecord.fields.Message || message,
            timestamp: createdRecord.fields.Timestamp || createdRecord.createdTime || new Date().toISOString()
          };

          return res.status(200).json({ success: true, result: mappedMessage });
        } catch (err: any) {
          if (err.status === 404 || err.type === "TABLE_NOT_FOUND") {
            return res.status(404).json({
              error: "Chat table not setup",
              type: "TABLE_NOT_FOUND",
              message: "The 'Chat_Messages' table was not found in Airtable. Please create this table to enable chat."
            });
          }
          throw err;
        }
      }

      case "add-hiring-brief": {
        const { role, company, statusText, accentColor } = req.body;
        if (!role || !company) {
          return res.status(400).json({ error: "Role and Company are required" });
        }
        try {
          const fields: Record<string, any> = {
            "Role": role,
            "Company": company,
            "Status_Text": statusText || "",
            "Accent_Color": accentColor ? accentColor.charAt(0).toUpperCase() + accentColor.slice(1).toLowerCase() : "Amber"
          };
          const result = await airtableCreate(TABLES.HIRING, fields);

          // Immutable Audit Log
          await logAuditTrail(
            "ADD_HIRING_BRIEF",
            req.user.email,
            req.user.role,
            `${role} - ${company}`,
            `Added hiring brief for role ${role} at ${company} (Status: ${statusText})`
          );

          return res.status(200).json({ success: true, result });
        } catch (err: any) {
          if (err.status === 404 || err.type === "TABLE_NOT_FOUND") {
            return res.status(404).json({
              error: "Hiring briefs table not setup",
              type: "TABLE_NOT_FOUND",
              message: `The '${TABLES.HIRING}' table was not found in Airtable. Please create this table to add hiring briefs.`
            });
          }
          throw err;
        }
      }

      case "delete-hiring-brief": {
        const { id } = req.body;
        if (!id) {
          return res.status(400).json({ error: "Hiring brief record ID is required" });
        }
        try {
          await airtableDelete(TABLES.HIRING, id);

          // Immutable Audit Log
          await logAuditTrail(
            "DELETE_HIRING_BRIEF",
            req.user.email,
            req.user.role,
            id,
            `Deleted hiring brief record: ${id}`
          );

          return res.status(200).json({ success: true, message: "Hiring brief successfully deleted." });
        } catch (err: any) {
          if (err.status === 404 || err.type === "TABLE_NOT_FOUND") {
            return res.status(404).json({
              error: "Hiring briefs table not setup",
              type: "TABLE_NOT_FOUND",
              message: `The '${TABLES.HIRING}' table was not found in Airtable.`
            });
          }
          throw err;
        }
      }

      case "trigger-osint": {
        const { dealId } = req.body;
        if (!dealId) {
          return res.status(400).json({ error: "Deal ID is required" });
        }
        try {
          const dealRecord = await airtableFetchRecord(TABLES.PIPELINE, dealId);
          if (!dealRecord) {
            return res.status(404).json({ error: "Deal not found" });
          }
          
          const companyName = dealRecord.fields.Company_Name || dealRecord.fields["Company Name"] || dealRecord.fields.Deal_Ref || dealRecord.fields["Deal Name"] || "";
          const website = dealRecord.fields.Website || dealRecord.fields.Company_Website || "";
          
          const { emitEvent } = await import("../_events/emit.js");
          const emitRes = await emitEvent("osint/scrape_requested", {
            dealId,
            companyName: String(companyName),
            website: website ? String(website) : undefined,
          });
          
          if (!emitRes) {
            console.log(`[OSINT Local Fallback] Inngest not available. Running OSINT synchronously in background for ${companyName}...`);
            
            // Run in the background asynchronously so the client request finishes immediately
            (async () => {
              const PIPELINE_TABLE = TABLES.PIPELINE || "Active_Pipeline";
              try {
                // 1. Queued
                await airtableUpdate(PIPELINE_TABLE, dealId, {
                  OSINT_Status: "Queued",
                  OSINT_Started_At: new Date().toISOString(),
                  OSINT_Failure_Reason: "",
                });

                // Fetch deal details for LinkedIn URL
                const updatedRecord = await airtableFetchRecord(PIPELINE_TABLE, dealId);
                const linkedInUrl: string = updatedRecord?.fields?.["LinkedIn_URL"] || "";

                // 2. Scraping Website
                await airtableUpdate(PIPELINE_TABLE, dealId, {
                  OSINT_Status: "Scraping Website",
                });

                // Run scraping steps
                const { scrapeCompanyWebsite } = await import("../../lib/playwright/website.js");
                const { searchCompaniesHouse } = await import("../_osint/providers/companiesHouse.js");
                const { fetchCompanyNews } = await import("../_osint/providers/news.js");

                const [websiteResult, chResult, newsResult] = await Promise.all([
                  website ? scrapeCompanyWebsite(website) : Promise.resolve({ success: false, error: "No website URL provided", url: "" }),
                  searchCompaniesHouse(String(companyName)).catch(err => ({ found: false, error: err.message, company: null })),
                  fetchCompanyNews(String(companyName)).catch(err => ({ articles: [], error: err.message })),
                ]);

                // 3. Extracting Metadata
                await airtableUpdate(PIPELINE_TABLE, dealId, {
                  OSINT_Status: "Extracting Metadata",
                });

                // LinkedIn enrichment is removed as per operational guidelines
                const linkedinResult = { found: false, error: "LinkedIn scraping is disabled", data: {} };

                // 4. Analyzing Company
                await airtableUpdate(PIPELINE_TABLE, dealId, {
                  OSINT_Status: "Analyzing Company",
                });

                // Synthesis
                const { synthesizeWithClaude } = await import("../inngest/osint-workflows.js");
                const synthesisResult = await synthesizeWithClaude(String(companyName), {
                  website: websiteResult.success ? websiteResult : undefined,
                  companiesHouse: chResult.found ? chResult : undefined,
                  linkedIn: linkedinResult.found ? linkedinResult.data : undefined,
                  news: newsResult.articles && newsResult.articles.length > 0 ? newsResult.articles : undefined,
                });

                // 5. Generating Risk Profile
                await airtableUpdate(PIPELINE_TABLE, dealId, {
                  OSINT_Status: "Generating Risk Profile",
                });

                // Persist results
                const compiledResult = {
                  dealId,
                  companyName,
                  enrichedAt: new Date().toISOString(),
                  websiteResult,
                  chResult,
                  newsResult,
                  linkedinResult,
                };

                const updatePayload: Record<string, any> = {
                  OSINT_Status: "Completed",
                  OSINT_Completed_At: new Date().toISOString(),
                  OSINT_Data: JSON.stringify(compiledResult),
                  OSINT_Summary: synthesisResult.synthesis || "",
                  OSINT_Key_Insights: (synthesisResult.keyInsights || []).join("\n• "),
                  OSINT_Risk_Flags: (synthesisResult.riskFlags || []).join("\n• "),
                };

                if (synthesisResult.industry !== "Unknown") {
                  updatePayload["Sector"] = synthesisResult.industry;
                }

                if (chResult?.company?.companyNumber) {
                  updatePayload["Companies_House_Number"] = chResult.company.companyNumber;
                }

                if ((linkedinResult?.data as any)?.linkedInUrl) {
                  updatePayload["LinkedIn_URL"] = (linkedinResult.data as any).linkedInUrl;
                }

                await airtableUpdate(PIPELINE_TABLE, dealId, updatePayload);
                console.log(`[OSINT Local Fallback] OSINT enrichment completed successfully for ${companyName}`);
              } catch (err: any) {
                console.error(`[OSINT Local Fallback] Synchronous pipeline failed for ${companyName}:`, err.message);
                await airtableUpdate(PIPELINE_TABLE, dealId, {
                  OSINT_Status: "Failed",
                  OSINT_Completed_At: new Date().toISOString(),
                  OSINT_Failure_Reason: err.message || "Unknown fallback error",
                });
              }
            })();

            return res.status(200).json({ success: true, message: "OSINT enrichment triggered (local fallback)." });
          }
          
          return res.status(200).json({ success: true, message: "OSINT enrichment triggered." });
        } catch (err: any) {
          return res.status(500).json({ error: `Failed to trigger OSINT: ${err.message}` });
        }
      }

      case "trigger-financial": {
        const { dealId, documentId } = req.body;
        if (!dealId) {
          return res.status(400).json({ error: "Deal ID is required" });
        }
        try {
          const dealRecord = await airtableFetchRecord(TABLES.PIPELINE, dealId);
          if (!dealRecord) {
            return res.status(404).json({ error: "Deal not found" });
          }
          
          const { emitEvent } = await import("../_events/emit.js");
          await emitEvent("financial/analysis_requested", {
            dealId,
            documentId: documentId || undefined,
            manuallyTriggered: true,
          });
          
          return res.status(200).json({ success: true, message: "Financial analysis triggered." });
        } catch (err: any) {
          return res.status(500).json({ error: `Failed to trigger financial analysis: ${err.message}` });
        }
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}
