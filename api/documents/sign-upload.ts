/**
 * /api/documents/sign-upload — return a short-lived signed payload so the browser
 * can upload a file DIRECTLY to Cloudinary (bytes never transit our server), then
 * report the resulting public_id back when creating/updating the document row.
 *
 * Replaces the legacy path that PUT confidential files to public filebin.net.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { ALL_STAFF } from "../_lib/authz.js";
import { ForbiddenError } from "../../lib/core/errors.js";
import { signUploadParams } from "../../lib/core/cloudinary.js";

const bodySchema = z.object({
  folder: z.string().default("aysan-deal-room/documents"),
  publicId: z.string().optional(),
});

export default createHandler<z.infer<typeof bodySchema>>({
  methods: ["POST"],
  requireAuth: true,
  bodySchema,
  handle: async ({ body, user }) => {
    // Any authenticated staff role may upload documents.
    if (!user || !ALL_STAFF.includes(user.role)) throw new ForbiddenError("Insufficient role to upload");
    const params: Record<string, string> = { folder: body.folder, type: "authenticated" };
    if (body.publicId) params.public_id = body.publicId;
    const signed = signUploadParams(params);
    return { ...signed, ...params };
  },
});
