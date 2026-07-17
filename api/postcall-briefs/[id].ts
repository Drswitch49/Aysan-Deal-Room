/** /api/postcall-briefs/:id — fetch / update (e.g. score overrides) / delete. */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { ALL_STAFF } from "../_lib/authz.js";

export default itemHandler(repositories.postcallBriefs, { writeRoles: ALL_STAFF });
