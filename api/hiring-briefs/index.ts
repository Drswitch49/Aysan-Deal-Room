/** /api/hiring-briefs — list + create. Replaces the add-hiring-brief action case. */
import { collectionHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { PEOPLE_MANAGERS } from "../_lib/authz.js";

export default collectionHandler(repositories.hiringBriefs, { writeRoles: PEOPLE_MANAGERS });
