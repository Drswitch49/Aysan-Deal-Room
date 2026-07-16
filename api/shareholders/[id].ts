/** /api/shareholders/:id — fetch / update / soft-delete a shareholder. */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { ALL_ADMINS } from "../_lib/authz.js";

export default itemHandler(repositories.shareholders, { writeRoles: ALL_ADMINS });
