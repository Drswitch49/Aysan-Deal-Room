/** /api/stakeholders — external stakeholders list + create. */
import { collectionHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { PEOPLE_MANAGERS } from "../_lib/authz.js";

export default collectionHandler(repositories.externalStakeholders, { writeRoles: PEOPLE_MANAGERS });
