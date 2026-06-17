/**
 * API endpoint for IM Review Document Management
 * POST /api/im-documents - Upload document
 * GET /api/im-documents - List documents (optionally filtered by dealRef)
 * GET /api/im-documents/:id - Get document by ID
 * DELETE /api/im-documents/:id - Delete document
 */

import { airtableCreate, airtableUpdate, airtableFetchRecord, airtableFetchAll } from "../src/lib/airtable/client.js";
import { ensureTable, ensureField } from "../src/lib/airtable/schema-manager.js";
import { extractUserFromRequest, requirePermission } from "../src/lib/rbac.js";
import { auditDocumentUploaded, auditDocumentRemoved } from "../src/lib/audit.js";

export default async function handler(req: any, res: any) {
  const user = extractUserFromRequest(req);
  const ipAddress = req.headers["x-forwarded-for"] || req.connection?.remoteAddress;

  try {
    // GET /api/im-documents - List documents
    if (req.method === "GET") {
      const { id, dealRef } = req.query;

      if (id) {
        // Get single document
        const record = await airtableFetchRecord("IM_Review_Documents", id);
        if (!record) {
          return res.status(404).json({ error: "Document not found" });
        }
        return res.status(200).json({
          id: record.id,
          documentName: record.fields.Document_Name,
          fileType: record.fields.File_Type,
          fileUrl: record.fields.File_Url,
          dealRef: record.fields.Deal_Ref,
          uploadedBy: record.fields.Uploaded_By,
          uploadedAt: record.fields.Uploaded_At,
          fileSize: record.fields.File_Size
        });
      }

      // Get all documents or filter by deal
      let filterFormula = "";
      if (dealRef) {
        filterFormula = `{Deal_Ref} = "${dealRef}"`;
      }

      const result = await airtableFetchAll("IM_Review_Documents", {
        filterByFormula: filterFormula || undefined
      });

      const documents = result.records.map((r: any) => ({
        id: r.id,
        documentName: r.fields.Document_Name,
        fileType: r.fields.File_Type,
        fileUrl: r.fields.File_Url,
        dealRef: r.fields.Deal_Ref,
        uploadedBy: r.fields.Uploaded_By,
        uploadedAt: r.fields.Uploaded_At,
        fileSize: r.fields.File_Size
      }));
      return res.status(200).json(documents);
    }

    // POST /api/im-documents - Upload document
    if (req.method === "POST") {
      requirePermission(user, "upload_documents", "You don't have permission to upload documents");

      const { documentName, fileType, fileUrl, dealRef } = req.body;

      // Validate required fields
      if (!documentName || !fileType || !fileUrl || !dealRef) {
        return res.status(400).json({
          error: "Missing required fields: documentName, fileType, fileUrl, dealRef"
        });
      }

      // Validate file type
      const validTypes = ["PDF", "DOCX", "XLSX"];
      if (!validTypes.includes(fileType)) {
        return res.status(400).json({
          error: `Invalid file type. Must be one of: ${validTypes.join(", ")}`
        });
      }

      await ensureTable("IM_Review_Documents");

      // Extract file size if available (can be enhanced later)
      const fileSize = req.body.fileSize || 0;

      const record = await airtableCreate("IM_Review_Documents", {
        Document_Name: documentName,
        File_Type: fileType,
        File_Url: fileUrl,
        Deal_Ref: dealRef,
        Uploaded_By: user?.name || "System",
        File_Size: fileSize
      });

      // Link document to deal
      const dealsTable = await airtableFetchAll("Deals", {
        filterByFormula: `{Deal_Ref} = "${dealRef}"`
      });

      if (dealsTable.records.length > 0) {
        const dealRecord = dealsTable.records[0];
        const existingDocs = dealRecord.fields.IM_Review_Documents || [];
        await airtableUpdate("Deals", dealRecord.id, {
          IM_Review_Documents: [...existingDocs, record.id]
        });
      }

      // Log audit event
      if (user) {
        await auditDocumentUploaded(dealRef, dealRef, documentName, user.id, ipAddress);
      }

      return res.status(201).json({
        id: record.id,
        documentName: record.fields.Document_Name,
        fileType: record.fields.File_Type,
        fileUrl: record.fields.File_Url,
        dealRef: record.fields.Deal_Ref,
        uploadedBy: record.fields.Uploaded_By,
        uploadedAt: record.fields.Uploaded_At,
        fileSize: record.fields.File_Size
      });
    }

    // DELETE /api/im-documents/:id - Delete document
    if (req.method === "DELETE") {
      const { id } = req.query;
      requirePermission(user, "upload_documents", "You don't have permission to delete documents");

      if (!id) {
        return res.status(400).json({ error: "Document ID is required" });
      }

      const record = await airtableFetchRecord("IM_Review_Documents", id);
      if (!record) {
        return res.status(404).json({ error: "Document not found" });
      }

      const dealRef = record.fields.Deal_Ref;
      const documentName = record.fields.Document_Name;

      // Remove document reference from deal
      const dealsTable = await airtableFetchAll("Deals", {
        filterByFormula: `{Deal_Ref} = "${dealRef}"`
      });

      if (dealsTable.records.length > 0) {
        const dealRecord = dealsTable.records[0];
        const existingDocs = dealRecord.fields.IM_Review_Documents || [];
        const updatedDocs = existingDocs.filter((docId: string) => docId !== id);
        await airtableUpdate("Deals", dealRecord.id, {
          IM_Review_Documents: updatedDocs
        });
      }

      // Note: Actual deletion from Airtable requires deleting the record
      // For now, we'll use a soft delete by clearing fields
      // Full deletion requires a different API endpoint
      await airtableUpdate("IM_Review_Documents", id, {
        File_Url: null
      });

      // Log audit event
      if (user) {
        await auditDocumentRemoved(dealRef, dealRef, documentName, user.id, ipAddress);
      }

      return res.status(200).json({
        id: record.id,
        deleted: true,
        message: "Document removed"
      });
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
