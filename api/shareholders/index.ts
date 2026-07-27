/** /api/shareholders — list + create shareholders. */
import { collectionHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { PEOPLE_MANAGERS } from "../_lib/authz.js";

export default collectionHandler(repositories.shareholders, { writeRoles: PEOPLE_MANAGERS });
