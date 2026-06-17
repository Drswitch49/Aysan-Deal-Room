import { airtableCreate } from "./airtable/client";
import { ensureTable } from "./airtable/schema-manager";
import type { AuditEventType, CreateAuditLogInput } from "../types/entities.js";

/**
 * Log an audit event to the Audit_Logs table
 */
export async function createAuditLog(
  input: CreateAuditLogInput
): Promise<void> {
  try {
    // Ensure the audit logs table exists
    await ensureTable("Audit_Logs");

    // Create the audit record
    await airtableCreate("Audit_Logs", {
      Event_Type: input.eventType,
      Entity_Type: input.entityType,
      Entity_Id: input.entityId,
      User_Id: input.userId,
      Action: input.action,
      Changes: input.changes ? JSON.stringify(input.changes) : undefined,
      IP_Address: input.ipAddress,
      Timestamp: new Date().toISOString()
    });

    console.log(`[Audit] ${input.eventType}: ${input.entityType}/${input.entityId} by ${input.userId}`);
  } catch (error) {
    console.error("[Audit] Error creating audit log:", error);
    // Don't throw - audit logging should not block operations
  }
}

/**
 * Log a deal creation event
 */
export async function auditDealCreated(
  dealId: string,
  dealRef: string,
  userId: string,
  ipAddress?: string
): Promise<void> {
  await createAuditLog({
    eventType: "CREATE_DEAL",
    entityType: "Deal",
    entityId: dealId,
    userId,
    action: `Created deal ${dealRef}`,
    ipAddress
  });
}

/**
 * Log a deal update event
 */
export async function auditDealUpdated(
  dealId: string,
  dealRef: string,
  userId: string,
  changes: Record<string, any>,
  ipAddress?: string
): Promise<void> {
  await createAuditLog({
    eventType: "UPDATE_DEAL",
    entityType: "Deal",
    entityId: dealId,
    userId,
    action: `Updated deal ${dealRef}`,
    changes,
    ipAddress
  });
}

/**
 * Log a deal deletion event
 */
export async function auditDealDeleted(
  dealId: string,
  dealRef: string,
  userId: string,
  ipAddress?: string
): Promise<void> {
  await createAuditLog({
    eventType: "DELETE_DEAL",
    entityType: "Deal",
    entityId: dealId,
    userId,
    action: `Deleted deal ${dealRef}`,
    ipAddress
  });
}

/**
 * Log a stage change event
 */
export async function auditStageChanged(
  dealId: string,
  dealRef: string,
  fromStage: string,
  toStage: string,
  userId: string,
  ipAddress?: string
): Promise<void> {
  await createAuditLog({
    eventType: "STAGE_CHANGED",
    entityType: "Deal",
    entityId: dealId,
    userId,
    action: `Changed stage from ${fromStage} to ${toStage}`,
    changes: { fromStage, toStage },
    ipAddress
  });
}

/**
 * Log a document upload event
 */
export async function auditDocumentUploaded(
  dealId: string,
  dealRef: string,
  documentName: string,
  userId: string,
  ipAddress?: string
): Promise<void> {
  await createAuditLog({
    eventType: "IM_UPLOADED",
    entityType: "Deal",
    entityId: dealId,
    userId,
    action: `Uploaded document: ${documentName}`,
    changes: { documentName },
    ipAddress
  });
}

/**
 * Log a document removal event
 */
export async function auditDocumentRemoved(
  dealId: string,
  dealRef: string,
  documentName: string,
  userId: string,
  ipAddress?: string
): Promise<void> {
  await createAuditLog({
    eventType: "IM_REMOVED",
    entityType: "Deal",
    entityId: dealId,
    userId,
    action: `Removed document: ${documentName}`,
    changes: { documentName },
    ipAddress
  });
}

/**
 * Log a portfolio company creation event
 */
export async function auditPortfolioCompanyCreated(
  companyId: string,
  companyName: string,
  userId: string,
  ipAddress?: string
): Promise<void> {
  await createAuditLog({
    eventType: "PORTCO_CREATED",
    entityType: "PortfolioCompany",
    entityId: companyId,
    userId,
    action: `Created portfolio company ${companyName}`,
    ipAddress
  });
}

/**
 * Log a portfolio company update event
 */
export async function auditPortfolioCompanyUpdated(
  companyId: string,
  companyName: string,
  userId: string,
  changes: Record<string, any>,
  ipAddress?: string
): Promise<void> {
  await createAuditLog({
    eventType: "PORTCO_UPDATED",
    entityType: "PortfolioCompany",
    entityId: companyId,
    userId,
    action: `Updated portfolio company ${companyName}`,
    changes,
    ipAddress
  });
}

/**
 * Log a portfolio company archival event
 */
export async function auditPortfolioCompanyArchived(
  companyId: string,
  companyName: string,
  userId: string,
  ipAddress?: string
): Promise<void> {
  await createAuditLog({
    eventType: "PORTCO_ARCHIVED",
    entityType: "PortfolioCompany",
    entityId: companyId,
    userId,
    action: `Archived portfolio company ${companyName}`,
    ipAddress
  });
}

/**
 * Log a team member creation event
 */
export async function auditTeamMemberCreated(
  memberId: string,
  memberName: string,
  memberEmail: string,
  userId: string,
  ipAddress?: string
): Promise<void> {
  await createAuditLog({
    eventType: "USER_CREATED",
    entityType: "TeamMember",
    entityId: memberId,
    userId,
    action: `Created team member ${memberName} (${memberEmail})`,
    ipAddress
  });
}

/**
 * Log a team member update event
 */
export async function auditTeamMemberUpdated(
  memberId: string,
  memberName: string,
  userId: string,
  changes: Record<string, any>,
  ipAddress?: string
): Promise<void> {
  await createAuditLog({
    eventType: "USER_UPDATED",
    entityType: "TeamMember",
    entityId: memberId,
    userId,
    action: `Updated team member ${memberName}`,
    changes,
    ipAddress
  });
}

/**
 * Log a stakeholder creation event
 */
export async function auditStakeholderCreated(
  stakeholderId: string,
  stakeholderName: string,
  userId: string,
  ipAddress?: string
): Promise<void> {
  await createAuditLog({
    eventType: "STAKEHOLDER_CREATED",
    entityType: "ExternalStakeholder",
    entityId: stakeholderId,
    userId,
    action: `Created stakeholder ${stakeholderName}`,
    ipAddress
  });
}

/**
 * Log a stakeholder update event
 */
export async function auditStakeholderUpdated(
  stakeholderId: string,
  stakeholderName: string,
  userId: string,
  changes: Record<string, any>,
  ipAddress?: string
): Promise<void> {
  await createAuditLog({
    eventType: "STAKEHOLDER_UPDATED",
    entityType: "ExternalStakeholder",
    entityId: stakeholderId,
    userId,
    action: `Updated stakeholder ${stakeholderName}`,
    changes,
    ipAddress
  });
}
