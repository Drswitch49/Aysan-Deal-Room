/** /api/shareholders/:id — fetch / update / soft-delete a shareholder. */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { INVESTOR_ROLES } from "../_lib/authz.js";

export default itemHandler(repositories.shareholders, { readRoles: INVESTOR_ROLES, writeRoles: INVESTOR_ROLES, deleteRoles: INVESTOR_ROLES });
