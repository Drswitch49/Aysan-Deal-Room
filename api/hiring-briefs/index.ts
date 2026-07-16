/** /api/hiring-briefs — list + create. Replaces the add-hiring-brief action case. */
import { collectionHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { ALL_ADMINS } from "../_lib/authz.js";

export default collectionHandler(repositories.hiringBriefs, { writeRoles: ALL_ADMINS });
