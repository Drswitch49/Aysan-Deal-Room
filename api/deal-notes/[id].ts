/** /api/deal-notes/:id — fetch / update / soft-delete a note. */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { ALL_STAFF } from "../_lib/authz.js";

export default itemHandler(repositories.dealNotes, { writeRoles: ALL_STAFF });
