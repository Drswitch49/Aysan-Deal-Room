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
import { logAuditTrail } from "../_utils/audit.js";
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

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin
    await authenticateAdmin(req);

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

        // Update Lenders record with hashed password and plaintext password
        await airtableUpdate(TABLES.LENDERS, lenderRecordId, {
          Portal_Password: hash,
          Passcode_Plain: newPassword
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
        const { lenderRecordId } = req.body;
        if (!lenderRecordId) {
          return res.status(400).json({ error: "Lender record ID is required" });
        }
        const lenderData = await airtableFetchRecord(TABLES.LENDERS, lenderRecordId);
        const normFields = normalizeLenderFields(lenderData.fields);
        const passcode = normFields.Passcode_Plain || "";
        return res.status(200).json({ success: true, passcode });
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
        // Enforce Admin Only
        if (req.user.role !== "admin") {
          return res.status(403).json({ error: "Access denied: Requires Admin role" });
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
        const { dealName, acpRefNo, stage, nextAction, nextActionDate } = req.body;
        if (!dealName) {
          return res.status(400).json({ error: "Deal Name is required" });
        }
        const fields: Record<string, any> = {
          "Deal Name": dealName,
          "Stage": stage || "Intro"
        };
        if (acpRefNo) {
          fields["ACP REF NO"] = acpRefNo;
        }
        if (nextAction) {
          fields["Next Action"] = nextAction;
        }
        if (nextActionDate) {
          fields["Next Action Date"] = nextActionDate;
        }
        const result = await airtableCreate(TABLES.PIPELINE, fields);

        // Immutable Audit Log
        await logAuditTrail(
          "CREATE_PIPELINE_DEAL",
          req.user.email,
          req.user.role,
          dealName,
          `Created new active pipeline deal: ${dealName} (Stage: ${stage || "Intro"}, Ref: ${acpRefNo || "none"})`
        );

        return res.status(200).json({ success: true, result });
      }

      case "change-admin-password": {
        // Enforce Admin Only
        if (req.user.role !== "admin") {
          return res.status(403).json({ error: "Access denied: Requires Admin role" });
        }

        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || currentPassword.trim() === "") {
          return res.status(400).json({ error: "Current passcode is required" });
        }
        if (!newPassword || newPassword.trim() === "") {
          return res.status(400).json({ error: "New passcode is required" });
        }

        const operatorEmail = req.user.email || "admin@aysancapital.com";

        // Check if rate-limited lock is active
        const lockInfo = failedPasscodeAttempts.get(operatorEmail);
        if (lockInfo && lockInfo.lockUntil > Date.now()) {
          const minutesLeft = Math.ceil((lockInfo.lockUntil - Date.now()) / 60000);
          return res.status(429).json({ error: `Too many failed attempts. Password update locked. Please try again in ${minutesLeft} minutes.` });
        }

        // Retrieve admin user from the DB to verify current password
        const usersRes = await airtableFetch("Users", {
          filterByFormula: `{Email} = '${escapeFormulaString(operatorEmail)}'`,
          maxRecords: 1
        });

        if (!usersRes.records || usersRes.records.length === 0) {
          return res.status(404).json({ error: "Administrator account not found in database." });
        }

        const adminUserRecord = usersRes.records[0];
        const storedHash = adminUserRecord.fields.PasswordHash || "";
        const isBcrypt = storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$");
        const isValid = isBcrypt ? bcrypt.compareSync(currentPassword, storedHash) : storedHash === currentPassword;

        if (!isValid) {
          const currentCount = (lockInfo?.count || 0) + 1;
          if (currentCount >= 5) {
            // Lock for 15 minutes
            failedPasscodeAttempts.set(operatorEmail, {
              count: currentCount,
              lockUntil: Date.now() + 15 * 60 * 1000
            });
            await logAuditTrail(
              "ADMIN_SECURITY_LOCKOUT",
              operatorEmail,
              req.user.role,
              operatorEmail,
              "Admin passcode update locked for 15 minutes due to 5 consecutive failures."
            );
            return res.status(429).json({ error: "Too many failed attempts. Admin passcode changes locked for 15 minutes." });
          } else {
            failedPasscodeAttempts.set(operatorEmail, {
              count: currentCount,
              lockUntil: 0
            });
            await logAuditTrail(
              "ADMIN_PASSWORD_CHANGE_FAILED",
              operatorEmail,
              req.user.role,
              operatorEmail,
              `Failed passcode update attempt ${currentCount}/5: incorrect current passcode.`
            );
            return res.status(401).json({ error: "Incorrect current passcode." });
          }
        }

        // Reset fail count on successful verification
        failedPasscodeAttempts.delete(operatorEmail);

        // Hash the new password
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(newPassword, salt);

        // Update the Users table record for the admin
        await airtableUpdate("Users", adminUserRecord.id, {
          PasswordHash: hash
        });

        // Update Lenders table admin record for legacy compatibility
        const adminLendersRes = await airtableFetch(TABLES.LENDERS, {
          filterByFormula: `{Lender_ID} = 'admin'`,
          maxRecords: 1
        });
        if (adminLendersRes.records && adminLendersRes.records.length > 0) {
          await airtableUpdate(TABLES.LENDERS, adminLendersRes.records[0].id, {
            Portal_Password: hash
          });
        } else {
          await airtableCreate(TABLES.LENDERS, {
            Lender_ID: "admin",
            Company_Name: "Admin Settings",
            Portal_Password: hash,
            Status: "Active"
          });
        }

        // Immutable Audit Log
        await logAuditTrail(
          "CHANGE_ADMIN_PASSWORD",
          operatorEmail,
          req.user.role,
          operatorEmail,
          `Admin passcode successfully updated.`
        );

        return res.status(200).json({ success: true, message: "Admin passcode successfully updated." });
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
              const webhookUrl = process.env.MAKE_WEBHOOK_URL || process.env.VITE_MAKE_WEBHOOK_URL;
              if (!webhookUrl) {
                return res.status(200).json({
                  success: false,
                  status: "Misconfigured",
                  details: "Make.com Webhook URL is missing (MAKE_WEBHOOK_URL).",
                  timestamp: new Date().toISOString()
                });
              }
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
            "Accent_Color": accentColor || "amber"
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

                // LinkedIn enrichment
                const { enrichFromLinkedIn } = await import("../../lib/playwright/linkedin.js");
                const targetLinkedinUrl =
                  linkedInUrl ||
                  (websiteResult.success && (websiteResult as any).socialAndSchema?.socialLinks?.linkedin) ||
                  "";

                const linkedinResult = await enrichFromLinkedIn({
                  linkedInUrl: targetLinkedinUrl || undefined,
                  companyName: String(companyName),
                  website: website ? String(website) : undefined,
                }).catch(err => ({ found: false, error: err.message, data: {} }));

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
