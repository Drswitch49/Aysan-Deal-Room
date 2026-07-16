/** /api/team-members/:id — fetch / update / soft-delete a team member. */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { ALL_ADMINS } from "../_lib/authz.js";

export default itemHandler(repositories.acpTeam, { writeRoles: ALL_ADMINS });
