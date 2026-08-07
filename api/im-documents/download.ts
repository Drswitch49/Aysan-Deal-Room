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

/**
 * Turn a Google Drive share link into one that serves the file.
 *
 * `…/file/d/<id>/view?usp=sharing` opens Drive's preview page; `uc?export=
 * download&id=<id>` serves the bytes for anyone the file is shared with.
 * Anything we don't recognise is handed back untouched.
 */
function directDownloadLink(url: string): string {
  const drive = url.match(/^https:\/\/drive\.google\.com\/file\/d\/([^/?#]+)/i);
  if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  return url;
}

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

    // No Cloudinary id → external/legacy link. We can't stream someone else's
    // file, but a Drive *share* link renders a preview page rather than serving
    // the document, so rewrite it to the direct-download form first.
    if (!publicId) return { url: directDownloadLink(storedUrl) };

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
