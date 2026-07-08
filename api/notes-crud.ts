import { airtableCreate, airtableUpdate, airtableFetchAll, airtableDelete } from "../src/lib/airtable/client.js";
import { ensureTable, ensureField } from "../src/lib/airtable/schema-manager.js";
import { extractUserFromRequest } from "../src/lib/rbac.js";
import { TABLES } from "../src/lib/airtable/schema.js";

export default async function handler(req: any, res: any) {
  const user = extractUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    if (req.method === "GET") {
      const { dealRef } = req.query;
      if (!dealRef) {
        return res.status(400).json({ error: "Missing dealRef" });
      }
      
      const result = await airtableFetchAll(TABLES.DEAL_NOTES, {
        filterByFormula: `{Deal_Ref} = "${dealRef}"`
      });

      const notes = result.records.map((r: any) => ({
        id: r.id,
        dealRef: r.fields.Deal_Ref,
        author: r.fields.Author,
        content: r.fields.Note_Content,
        createdAt: r.fields.Created_At,
        updatedAt: r.fields.Updated_At
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
        Author: user.name || "Unknown",
        Note_Content: content
      });

      return res.status(200).json({
        id: result.id,
        dealRef: result.fields.Deal_Ref,
        author: result.fields.Author,
        content: result.fields.Note_Content,
        createdAt: result.fields.Created_At,
        updatedAt: result.fields.Updated_At
      });
    }

    if (req.method === "PATCH") {
      const { id, content } = req.body;
      if (!id || !content) {
        return res.status(400).json({ error: "Missing id or content" });
      }

      // We should check if the user is the author
      const existing = await airtableFetchAll(TABLES.DEAL_NOTES, {
        filterByFormula: `RECORD_ID() = "${id}"`
      });
      if (existing.records.length === 0) {
        return res.status(404).json({ error: "Note not found" });
      }
      if (existing.records[0].fields.Author !== user.name) {
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

      const existing = await airtableFetchAll(TABLES.DEAL_NOTES, {
        filterByFormula: `RECORD_ID() = "${id}"`
      });
      if (existing.records.length === 0) {
        return res.status(404).json({ error: "Note not found" });
      }
      if (existing.records[0].fields.Author !== user.name) {
        return res.status(403).json({ error: "You can only delete your own notes" });
      }

      await airtableDelete(TABLES.DEAL_NOTES, id);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error("Notes API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
