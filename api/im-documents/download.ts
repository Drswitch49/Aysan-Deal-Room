/**
 * GET /api/im-documents/download?id=<uuid>&mode=view|download
 *
 * Returns a short-lived SIGNED URL for an IM/Review file. The stored file_url
 * points at an `authenticated` Cloudinary asset that 401s on direct browser
 * access; private_download_url works regardless of the account's PDF/ZIP
 * delivery toggle. `view` renders inline, `download` forces an attachment —
 * without the latter the IM tab's Download button just opened the file.
 * Falls back to the raw stored URL for legacy/external (non-Cloudinary) rows.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { ALL_STAFF } from "../_lib/authz.js";
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
    if (!user || !ALL_STAFF.includes(user.role)) throw new ForbiddenError("Insufficient role to download");

    const row = (await repositories.imReviewDocuments.findById(query.id)) as any;
    if (!row) throw new NotFoundError("Document not found");

    const storedUrl: string = row.file_url || row.legacy_file_url || "";
    const publicId: string | null = row.cloudinary_public_id ?? null;

    // No Cloudinary id → external/legacy link, handed back exactly as stored.
    //
    // These used to be rewritten to Drive's `uc?export=download&id=<id>` form
    // on the theory that a share link only opens a preview page. It does serve
    // bytes — but only for a file shared with "anyone with the link". Every
    // Drive attachment here is shared with named accounts instead, and that
    // endpoint answers those with a bare 403 Forbidden page, which is what the
    // Download button was landing on. The share link itself carries the
    // viewer's own Google session, so it opens the document (or offers
    // "Request access") for the people actually entitled to it.
    if (!publicId) {
      if (!storedUrl) throw new NotFoundError("This attachment has no file or link stored");
      return { url: storedUrl };
    }

    // The resource type is encoded in the stored delivery URL
    // (…/res.cloudinary.com/<cloud>/<image|raw|video>/authenticated/…).
    const rtMatch = storedUrl.match(/\/(image|raw|video)\/(?:authenticated|upload)\//);
    const resourceType = (rtMatch?.[1] ?? "image") as "image" | "video" | "raw";

    // For image/video the public_id has no extension, so pass the format from the
    // URL; for raw the public_id already includes the extension (format stays "").
    let format = "";
    if (resourceType !== "raw") {
      const noQuery = storedUrl.split("?")[0];
      const ext = noQuery.includes(".") ? noQuery.split(".").pop() ?? "" : "";
      format = ext;
    }

    return { url: downloadUrl(publicId, { resourceType, format, attachment: query.mode === "download" }) };
  },
});
