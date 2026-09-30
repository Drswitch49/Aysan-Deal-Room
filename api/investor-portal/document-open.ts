/**
 * GET /api/investor-portal/document-open?id=…[&download=1] — open one document.
 *
 * The gate is the same one the document list uses (api/_lib/document-gates.ts):
 * a document the partner may not see now — out of scope, revoked, gate not met,
 * category still locked, or not yet released — gets the same "not found"
 * answer, so nothing can be opened around a gate by id. Only then is the file
 * looked up, the open written to access_log, and a two-minute signed URL
 * handed back. The response never carries the public id itself.
 *
 * Offer documents are view only and never go out unmarked: the partner gets
 * their own numbered copy with their name on every page (api/_lib/offer-copies.ts).
 *
 * Cloudinary cannot put the real filename on a download (see the
 * cloudinary-filename note in lib/core/cloudinary.ts), so file_name comes back
 * alongside the URL for the browser to apply.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { ForbiddenError, NotFoundError } from "../../lib/core/errors.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { logAccess, resolveInvestorScope } from "../_lib/investor-context.js";
import { partnerVisibleDocuments } from "../_lib/document-gates.js";
import { partnerCopyUrl } from "../_lib/offer-copies.js";
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

    const { rows } = await partnerVisibleDocuments(scope);
    const visible = rows.find((r) => r.id === id);
    // Not theirs, revoked, gated, or never existed: the same answer, so no probing.
    if (!visible) throw new NotFoundError("Document not found");
    if (!visible.available) throw new ForbiddenError("This document has not been published yet");

    const { data: doc, error: docErr } = await adminClient()
      .from("investor_documents")
      .select("id, title, version, category, file_link, cloudinary_public_id, cloudinary_resource_type, file_format, file_name")
      .eq("id", id)
      .maybeSingle();
    if (docErr || !doc) throw new NotFoundError("Document not found");

    const viewOnly = visible.view_only || doc.category === "offer";
    let url: string | null = null;
    let copyNo: number | null = null;

    if (doc.category === "offer" && doc.cloudinary_public_id && !scope.viewedByStaff) {
      const copy = await partnerCopyUrl(doc as any, scope);
      url = copy.url;
      copyNo = copy.copyNo;
    } else if (doc.cloudinary_public_id) {
      const resourceType = (doc.cloudinary_resource_type ?? "image") as "image" | "raw" | "video";
      url = downloadUrl(doc.cloudinary_public_id, {
        resourceType,
        // A raw asset's public id already ends in its extension.
        format: resourceType === "raw" ? "" : (doc.file_format ?? ""),
        expiresInSeconds: 120,
        attachment: download === "1" && !viewOnly,
      });
    } else if (doc.file_link && doc.category !== "offer") {
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
      view_only: viewOnly,
      copy_no: copyNo,
    };
  },
});
