/** /api/hiring-briefs/:id — fetch / update / delete. Replaces delete-hiring-brief. */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { PEOPLE_MANAGERS } from "../_lib/authz.js";

export default itemHandler(repositories.hiringBriefs, { writeRoles: PEOPLE_MANAGERS, deleteRoles: PEOPLE_MANAGERS });
