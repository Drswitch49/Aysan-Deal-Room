/** /api/team-members/:id — fetch / update / soft-delete a team member. */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { PEOPLE_MANAGERS } from "../_lib/authz.js";

export default itemHandler(repositories.acpTeam, { writeRoles: PEOPLE_MANAGERS, deleteRoles: PEOPLE_MANAGERS });
