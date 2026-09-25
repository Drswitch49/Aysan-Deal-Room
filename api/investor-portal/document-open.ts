/**
 * GET /api/investor-portal/document-open?id=…[&download=1] — open one document.
 *
 * The partner_documents view is the gate: it only returns a document the
 * session's partner may see, that has published and has not been revoked. Only
 * then is the stored file looked up, the open is written to access_log, and a
 * signed Cloudinary URL that expires in two minutes is handed back. The
 * response never carries the public id itself.
 *
 * Cloudinary cannot put the real filename on a download (see the
 * cloudinary-filename note in lib/core/cloudinary.ts), so file_name comes back
 * alongside the URL for the browser to apply.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { ForbiddenError, InternalError, NotFoundError } from "../../lib/core/errors.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { logAccess, resolveInvestorScope } from "../_lib/investor-context.js";
import { downloadUrl } from "../../lib/core/cloudinary.js";

const querySchema = z.object({
  id: z.string().uuid("A document id is required"),
  investor_id: z.string().uuid().optional(),
  download: z.string().optional(),
});

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ req, query, user }) => {
    const { id, investor_id, download } = querySchema.parse(query ?? {});
    const scope = await resolveInvestorScope(user, investor_id);
    const db = adminClient();

    const { data: visible, error } = await db
      .from("partner_documents")
      .select("id, available, view_only")
      .eq("investor_id", scope.investorId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new InternalError(`partner_documents: ${error.message}`);
    // Not theirs, revoked, or never existed: the same answer, so no probing.
    if (!visible) throw new NotFoundError("Document not found");
    if (!visible.available) throw new ForbiddenError("This document has not been published yet");

    const { data: doc, error: docErr } = await db
      .from("investor_documents")
      .select("title, file_link, cloudinary_public_id, cloudinary_resource_type, file_format, file_name")
      .eq("id", id)
      .maybeSingle();
    if (docErr || !doc) throw new NotFoundError("Document not found");

    const attachment = download === "1" && !visible.view_only;
    let url: string | null = null;
    if (doc.cloudinary_public_id) {
      const resourceType = (doc.cloudinary_resource_type ?? "image") as "image" | "raw" | "video";
      url = downloadUrl(doc.cloudinary_public_id, {
        resourceType,
        // A raw asset's public id already ends in its extension.
        format: resourceType === "raw" ? "" : (doc.file_format ?? ""),
        expiresInSeconds: 120,
        attachment,
      });
    } else if (doc.file_link) {
      url = doc.file_link;
    }
    if (!url) throw new NotFoundError("This document has no file attached yet");

    // Staff previewing a partner's portal are not the partner opening it.
    if (!scope.viewedByStaff) {
      await logAccess("doc_open", { investorId: scope.investorId, authUid: user?.id, documentId: id, req });
    }

    return {
      url,
      file_name: doc.file_name ?? (doc.file_format ? `${doc.title}.${doc.file_format}` : doc.title),
      view_only: visible.view_only,
    };
  },
});
