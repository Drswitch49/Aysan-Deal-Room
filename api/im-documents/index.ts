/**
 * /api/im-documents — IM review documents (Cloudinary-backed).
 * Replaces the upload-im-document action case: the browser uploads directly to
 * Cloudinary via /api/documents/sign-upload, then POSTs the metadata here.
 */
import { collectionHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { ALL_STAFF } from "../_lib/authz.js";

export default collectionHandler(repositories.imReviewDocuments, { writeRoles: ALL_STAFF });
