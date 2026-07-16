/** /api/shareholders — list + create shareholders. */
import { collectionHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { ALL_ADMINS } from "../_lib/authz.js";

export default collectionHandler(repositories.shareholders, { writeRoles: ALL_ADMINS });
