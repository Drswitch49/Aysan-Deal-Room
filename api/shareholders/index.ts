/** /api/shareholders — list + create shareholders. */
import { collectionHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { INVESTOR_ROLES } from "../_lib/authz.js";

export default collectionHandler(repositories.shareholders, { readRoles: INVESTOR_ROLES, writeRoles: INVESTOR_ROLES });
