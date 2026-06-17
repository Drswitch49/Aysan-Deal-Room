/**
 * API endpoint for Audit Logs
 * GET /api/audit-logs - List audit logs (with optional filtering)
 * GET /api/audit-logs?entityType=Deal&entityId=... - Filter by entity
 * GET /api/audit-logs?eventType=... - Filter by event type
 */

import { airtableFetchAll } from "../src/lib/airtable/client.js";
import { extractUserFromRequest, requirePermission } from "../src/lib/rbac.js";

export default async function handler(req: any, res: any) {
  const user = extractUserFromRequest(req);

  try {
    // GET /api/audit-logs - List audit logs
    if (req.method === "GET") {
      requirePermission(user, "view_audit_logs", "You don't have permission to view audit logs");

      const { entityType, entityId, eventType, limit } = req.query;

      let filterFormula = "";
      const filters: string[] = [];

      if (entityType) {
        filters.push(`{Entity_Type} = "${entityType}"`);
      }

      if (entityId) {
        filters.push(`{Entity_Id} = "${entityId}"`);
      }

      if (eventType) {
        filters.push(`{Event_Type} = "${eventType}"`);
      }

      if (filters.length > 0) {
        filterFormula = filters.join(" AND ");
      }

      const result = await airtableFetchAll("Audit_Logs", {
        filterByFormula: filterFormula || undefined,
        sort: [{ field: "Timestamp", direction: "desc" }],
        maxRecords: limit ? parseInt(limit) : 100
      });

      const logs = result.records.map((r: any) => ({
        id: r.id,
        eventType: r.fields.Event_Type,
        entityType: r.fields.Entity_Type,
        entityId: r.fields.Entity_Id,
        userId: r.fields.User_Id,
        action: r.fields.Action,
        changes: r.fields.Changes ? JSON.parse(r.fields.Changes) : null,
        timestamp: r.fields.Timestamp,
        ipAddress: r.fields.IP_Address
      }));

      return res.status(200).json(logs);
    }

    // Method not allowed
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    console.error("[API] Error:", error);

    if (error.message.includes("Authentication required")) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (error.message.includes("Permission denied")) {
      return res.status(403).json({ error: error.message });
    }

    return res.status(500).json({
      error: error.message || "Internal server error"
    });
  }
}
