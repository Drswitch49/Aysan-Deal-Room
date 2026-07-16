/** /api/team-members — ACP team roster list + create. */
import { collectionHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { ALL_ADMINS } from "../_lib/authz.js";

export default collectionHandler(repositories.acpTeam, { writeRoles: ALL_ADMINS });
