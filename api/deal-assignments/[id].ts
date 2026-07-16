/** /api/deal-assignments/:id — fetch / update (e.g. NDA flag) / remove an assignment. */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export default itemHandler(repositories.lenderDealAssignments);
