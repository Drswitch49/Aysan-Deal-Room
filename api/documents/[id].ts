/** /api/documents/:id — fetch / update / soft-delete a document.
 *  Any authenticated staff role may edit; delete stays admin-only. */
import { itemHandler } from "../_lib/crud-route.js";
import { ALL_STAFF } from "../_lib/authz.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export default itemHandler(repositories.documents, { writeRoles: ALL_STAFF });
