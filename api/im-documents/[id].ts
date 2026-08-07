/** /api/im-documents/:id — fetch / update / remove (replaces remove/replace-im-document). */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { ALL_STAFF, WRITERS } from "../_lib/authz.js";

// Deleting an attachment used to run through PATCH /api/deals/:id (writers), so
// gating it at ALL_ADMINS — the crud default — would take the IM tab's Delete
// button away from analysts who can still upload and replace.
export default itemHandler(repositories.imReviewDocuments, { writeRoles: ALL_STAFF, deleteRoles: WRITERS });
