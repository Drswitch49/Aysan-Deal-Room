/** /api/documents — list (filter by deal_id/category/status) + create.
 *  Any authenticated staff role may create/upload documents. */
import { collectionHandler } from "../_lib/crud-route.js";
import { ALL_STAFF } from "../_lib/authz.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export default collectionHandler(repositories.documents, { writeRoles: ALL_STAFF });
