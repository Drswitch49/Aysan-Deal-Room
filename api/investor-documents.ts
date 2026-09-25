/**
 * /api/investor-documents — the documents a capital partner can see.
 *
 * investor_id null means "every partner holding a completed commitment in this
 * deal", which is how a quarterly report or a covenant certificate reaches
 * everyone without a row per partner.
 *
 * A row with only publishes_on and no link is the "Publishes 15 Oct" state:
 * the partner is told when the document arrives rather than being shown an
 * empty panel. Publishing it later is a PATCH, which writes the activity line.
 *
 * Delivery: staff upload the file to Cloudinary as an authenticated asset and
 * send its public id here. The partner views never expose it; a partner opens
 * a document through /api/investor-portal/document-open, which checks scope,
 * logs the access and returns a short-lived signed URL.
 *
 * Revoking sets revoked_at, which hides the document from every partner while
 * keeping the file and the row. Deleting removes both.
 */
import { z } from "zod";
import { createHandler } from "./_lib/handler.js";
import { INVESTOR_ROLES, PARTNER_MANAGERS } from "./_lib/authz.js";
import { ForbiddenError, InternalError, NotFoundError } from "../lib/core/errors.js";
import { adminClient } from "../lib/data/supabase/client.js";
import { logActivity, recordAudit } from "./_lib/investor-access.js";
import { deleteAsset, downloadUrl } from "../lib/core/cloudinary.js";

const DOC_TYPES = [
  "subscription",
  "spv_sha",
  "certification",
  "quarterly_report",
  "covenant_certificate",
  "notice",
  "other",
] as const;

const createSchema = z
  .object({
    investor_id: z.string().uuid().nullable().optional(),
    deal_id: z.string().uuid().nullable().optional(),
    doc_type: z.enum(DOC_TYPES),
    title: z.string().min(1),
    file_link: z.string().nullable().optional(),
    storage_path: z.string().nullable().optional(),
    cloudinary_public_id: z.string().nullable().optional(),
    cloudinary_resource_type: z.enum(["image", "raw", "video"]).nullable().optional(),
    file_format: z.string().nullable().optional(),
    file_name: z.string().nullable().optional(),
    file_bytes: z.number().int().nonnegative().nullable().optional(),
    view_only: z.boolean().optional(),
    publishes_on: z.string().nullable().optional(),
    published_at: z.string().nullable().optional(),
  })
  .refine((v) => v.file_link || v.storage_path || v.cloudinary_public_id || v.publishes_on, {
    message: "Upload a file, give a link, or set a date it publishes on.",
  })
  .refine((v) => v.investor_id || v.deal_id, {
    message: "A document belongs to a partner, a deal, or both.",
  });

const patchSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).optional(),
  file_link: z.string().nullable().optional(),
  publishes_on: z.string().nullable().optional(),
  /** Publish now. Fans the activity line out to every partner who can see it. */
  publish: z.boolean().optional(),
  /** true hides it from every partner; false gives access back. */
  revoked: z.boolean().optional(),
});

const deleteSchema = z.object({ id: z.string().uuid() });

export default createHandler({
  methods: ["GET", "POST", "PATCH", "DELETE"],
  requireAuth: true,
  roles: INVESTOR_ROLES,
  handle: async ({ req, body, query, user }) => {
    const db = adminClient();

    if (req.method === "GET") {
      // ?open=<id> — a short-lived link so staff can check what they uploaded.
      const openId = (query as any)?.open as string | undefined;
      if (openId) {
        const { data: doc } = await db.from("investor_documents").select("*").eq("id", openId).maybeSingle();
        if (!doc) throw new NotFoundError("Document not found");
        if (doc.cloudinary_public_id) {
          const resourceType = (doc.cloudinary_resource_type ?? "image") as "image" | "raw" | "video";
          return {
            url: downloadUrl(doc.cloudinary_public_id, {
              resourceType,
              format: resourceType === "raw" ? "" : (doc.file_format ?? ""),
              expiresInSeconds: 120,
            }),
          };
        }
        if (doc.file_link) return { url: doc.file_link };
        throw new NotFoundError("This document has no file attached");
      }

      const investorId = (query as any)?.investor_id as string | undefined;
      const dealId = (query as any)?.deal_id as string | undefined;
      let q = db.from("investor_documents").select("*").order("uploaded_at", { ascending: false });
      if (investorId) q = q.eq("investor_id", investorId);
      if (dealId) q = q.eq("deal_id", dealId);
      const { data, error } = await q;
      if (error) throw new InternalError(`investor_documents: ${error.message}`);
      return { rows: data ?? [], total: data?.length ?? 0 };
    }

    if (!user || !PARTNER_MANAGERS.includes(user.role)) {
      throw new ForbiddenError("Managing partner documents requires an admin or CFO role");
    }

    if (req.method === "POST") {
      const input = createSchema.parse(body ?? {});
      const { data: created, error } = await db
        .from("investor_documents")
        .insert({ ...input, uploaded_by: user.id })
        .select("*")
        .single();
      if (error) throw new InternalError(`investor_documents: ${error.message}`);

      if (created.published_at) await announce(created);
      await recordAudit({
        action: "ADD_PARTNER_DOCUMENT",
        entityId: created.id,
        entityType: "investor_documents",
        actor: user,
        details: `Added ${created.doc_type} "${created.title}"`,
        newValue: created,
      });
      return created;
    }

    if (req.method === "DELETE") {
      const { id } = deleteSchema.parse({ id: (query as any)?.id ?? (body as any)?.id });
      const { data: doc } = await db.from("investor_documents").select("*").eq("id", id).maybeSingle();
      if (!doc) throw new NotFoundError("Document not found");

      const { error } = await db.from("investor_documents").delete().eq("id", id);
      if (error) throw new InternalError(`investor_documents: ${error.message}`);
      // The row is what grants access, so it goes first: a file left behind by
      // a failed asset delete is unreachable, not exposed.
      if (doc.cloudinary_public_id) {
        await deleteAsset(doc.cloudinary_public_id, doc.cloudinary_resource_type ?? "image").catch(() => undefined);
      }
      await recordAudit({
        action: "DELETE_PARTNER_DOCUMENT",
        entityId: id,
        entityType: "investor_documents",
        actor: user,
        details: `Deleted ${doc.doc_type} "${doc.title}"`,
        oldValue: doc,
      });
      return { deleted: true, id };
    }

    // PATCH
    const input = patchSchema.parse(body ?? {});
    const { id, publish, revoked, ...rest } = input;
    const { data: before } = await db.from("investor_documents").select("*").eq("id", id).maybeSingle();
    if (!before) throw new NotFoundError("Document not found");

    const patch: Record<string, unknown> = { ...rest };
    if (publish && !before.published_at) patch.published_at = new Date().toISOString();
    if (revoked !== undefined) patch.revoked_at = revoked ? new Date().toISOString() : null;

    const { data: updated, error } = await db
      .from("investor_documents")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new InternalError(`investor_documents: ${error.message}`);

    if (patch.published_at) await announce(updated);
    await recordAudit({
      action: "UPDATE_PARTNER_DOCUMENT",
      entityId: id,
      entityType: "investor_documents",
      actor: user,
      details:
        revoked === true
          ? `Revoked partner access to "${updated.title}"`
          : revoked === false
            ? `Restored partner access to "${updated.title}"`
            : publish
              ? `Published "${updated.title}"`
              : `Updated "${updated.title}"`,
      oldValue: before,
      newValue: updated,
    });
    return updated;
  },
});

/** Write "Document added" for the partner, or for every partner in the deal. */
async function announce(doc: any): Promise<void> {
  const db = adminClient();
  const payload = { title: doc.title, doc_type: doc.doc_type };

  if (doc.investor_id) {
    await logActivity(doc.investor_id, doc.deal_id ?? null, "document_added", payload);
    return;
  }
  if (!doc.deal_id) return;

  const { data } = await db
    .from("commitments")
    .select("investor_id")
    .eq("deal_id", doc.deal_id)
    .in("status", ["completed", "converted", "bought_back"]);
  const seen = new Set<string>();
  for (const row of data ?? []) {
    if (seen.has(row.investor_id)) continue;
    seen.add(row.investor_id);
    await logActivity(row.investor_id, doc.deal_id, "document_added", payload);
  }
}
