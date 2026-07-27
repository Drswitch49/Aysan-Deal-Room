/** /api/lenders/:id — fetch / update / soft-delete a lender. */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { ALL_ADMINS } from "../_lib/authz.js";

export default itemHandler(repositories.lenders, { writeRoles: ALL_ADMINS });
