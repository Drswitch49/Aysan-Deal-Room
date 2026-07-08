import { airtableCreate, airtableUpdate, airtableFetch, airtableDelete, TABLES, escapeFormulaString } from "./_utils/airtable.js";
import { authenticateAdmin } from "./admin/lenders_auth_helper.js";

export default async function handler(req: any, res: any) {
  try {
    await authenticateAdmin(req);
    const user = req.user;

    if (req.method === "GET") {
      const { dealRef } = req.query;
      if (!dealRef) {
        return res.status(400).json({ error: "Missing dealRef" });
      }
      
      const result = await airtableFetch(TABLES.DEAL_NOTES, {
        filterByFormula: `{Deal_Ref} = '${escapeFormulaString(dealRef)}'`
      });

      const notes = (result.records || []).map((r: any) => ({
        id: r.id,
        dealRef: r.fields.Deal_Ref,
        author: r.fields.Author,
        authorEmail: r.fields.Author_Email,
        content: r.fields.Note_Content,
        createdAt: r.fields.Created_At || r.createdTime,
        updatedAt: r.fields.Updated_At || r.createdTime
      }));

      return res.status(200).json(notes);
    }

    if (req.method === "POST") {
      const { dealRef, content } = req.body;
      if (!dealRef || !content) {
        return res.status(400).json({ error: "Missing dealRef or content" });
      }

      const result = await airtableCreate(TABLES.DEAL_NOTES, {
        Deal_Ref: dealRef,
        Author: user.name || user.email || "Unknown",
        Author_Email: user.email,
        Note_Content: content
      });

      return res.status(200).json({
        id: result.id,
        dealRef: result.fields.Deal_Ref,
        author: result.fields.Author,
        authorEmail: result.fields.Author_Email,
        content: result.fields.Note_Content,
        createdAt: result.fields.Created_At || result.createdTime,
        updatedAt: result.fields.Updated_At || result.createdTime
      });
    }

    if (req.method === "PATCH") {
      const { id, content } = req.body;
      if (!id || !content) {
        return res.status(400).json({ error: "Missing id or content" });
      }

      const existing = await airtableFetch(TABLES.DEAL_NOTES, {
        filterByFormula: `RECORD_ID() = '${escapeFormulaString(id)}'`
      });
      if (!existing.records || existing.records.length === 0) {
        return res.status(404).json({ error: "Note not found" });
      }
      if (existing.records[0].fields.Author_Email !== user.email && user.role !== "admin" && user.role !== "super admin") {
        return res.status(403).json({ error: "You can only edit your own notes" });
      }

      const result = await airtableUpdate(TABLES.DEAL_NOTES, id, {
        Note_Content: content
      });

      return res.status(200).json({
        id: result.id,
        content: result.fields.Note_Content
      });
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: "Missing id" });
      }

      const existing = await airtableFetch(TABLES.DEAL_NOTES, {
        filterByFormula: `RECORD_ID() = '${escapeFormulaString(id)}'`
      });
      if (!existing.records || existing.records.length === 0) {
        return res.status(404).json({ error: "Note not found" });
      }
      if (existing.records[0].fields.Author_Email !== user.email && user.role !== "admin" && user.role !== "super admin") {
        return res.status(403).json({ error: "You can only delete your own notes" });
      }

      await airtableDelete(TABLES.DEAL_NOTES, id);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error("Notes API error:", err);
    return res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  }
}
