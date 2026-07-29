/**
 * GET /api/documents/download?id=<uuid>&mode=view|download
 *
 * Returns a short-lived signed URL for a checklist document.
 *
 * Deal documents are stored as Cloudinary `authenticated` assets, so the URL
 * held in `documents.file_url` 401s on direct browser access — which is why the
 * View/Download buttons could not simply link to it. This mints a signed URL
 * instead: `view` renders inline in a new tab, `download` forces an attachment.
 * Falls back to the stored URL for legacy/external (non-Cloudinary) rows.
 *
 * Mirrors api/im-documents/download.ts, which does the same for IM files.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { ALL_STAFF } from "../_lib/authz.js";
import { resolveLenderScope } from "../_lib/lender-context.js";
import { ForbiddenError, NotFoundError } from "../../lib/core/errors.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { downloadUrl } from "../../lib/core/cloudinary.js";

const querySchema = z.object({
  id: z.string().uuid("A document id (uuid) is required"),
  mode: z.enum(["view", "download"]).default("view"),
});

export default createHandler<unknown, z.infer<typeof querySchema>>({
  methods: ["GET"],
  requireAuth: true,
  querySchema,
  handle: async ({ query, user }) => {
    if (!user) throw new ForbiddenError("Insufficient role to open documents");

    const row = (await repositories.documents.findById(query.id)) as any;
    if (!row) throw new NotFoundError("Document not found");

    // The lender portal renders the same checklist, so its View/Download must
    // work too — but only for files actually shared with that lender, on a deal
    // assigned to them. Same rule /api/lender/documents lists by.
    if (!ALL_STAFF.includes(user.role)) {
      const scope = await resolveLenderScope(user, undefined);
      const shared =
        scope.dealIds.includes(row.deal_id) &&
        String(row.status ?? "").trim().toLowerCase() === "sent to lender";
      if (!shared) throw new ForbiddenError("This document has not been shared with you");
    }

    const storedUrl: string = row.file_url || row.legacy_drive_link || "";
    const publicId: string | null = row.cloudinary_public_id ?? null;

    // No Cloudinary id → external/legacy link (Google Drive etc.), hand it back.
    if (!publicId) {
      if (!storedUrl) throw new NotFoundError("This document has no file attached");
      return { url: storedUrl };
    }

    // Resource type is encoded in the stored delivery URL
    // (…/res.cloudinary.com/<cloud>/<image|raw|video>/authenticated/…).
    const resourceType = (storedUrl.match(/\/(image|raw|video)\/(?:authenticated|upload)\//)?.[1] ?? "image") as
      | "image"
      | "video"
      | "raw";

    // image/video public_ids carry no extension, so the format has to come from
    // the URL; a raw public_id already includes it.
    let format = "";
    if (resourceType !== "raw") {
      const noQuery = storedUrl.split("?")[0];
      format = noQuery.includes(".") ? noQuery.split(".").pop() ?? "" : "";
    }

    return {
      url: downloadUrl(publicId, { resourceType, format, attachment: query.mode === "download" }),
    };
  },
});
