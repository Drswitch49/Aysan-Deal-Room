/** /api/im-documents/:id — fetch / update / remove (replaces remove/replace-im-document). */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { ALL_STAFF } from "../_lib/authz.js";

export default itemHandler(repositories.imReviewDocuments, { writeRoles: ALL_STAFF });
