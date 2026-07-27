/** /api/submissions/:id — fetch / update / soft-delete a submission entry. */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export default itemHandler(repositories.submissionLog);
