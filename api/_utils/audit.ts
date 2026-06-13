import { airtableCreate } from "./airtable.js";

/**
 * Creates an immutable operational log in the Audit_Logs table.
 * Does not fail the parent transaction if logging fails, but prints a warning.
 */
export async function logAuditTrail(
  action: string,
  operatorEmail: string,
  operatorRole: string,
  target: string,
  details: string
) {
  try {
    await airtableCreate("Audit_Logs", {
      Action: action,
      Operator: operatorEmail,
      Operator_Role: operatorRole,
      Target: target,
      Details: details,
      Timestamp: new Date().toISOString()
    });
    console.log(`[Audit Log] ${action} logged for ${operatorEmail} (${operatorRole}) -> Target: ${target}`);
  } catch (err: any) {
    console.warn(`[Audit Log Warning] Failed to save audit trail: ${err.message}`);
  }
}
