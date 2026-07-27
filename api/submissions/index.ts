/** /api/submissions — lender submission log (list by deal_id + create). */
import { collectionHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export default collectionHandler(repositories.submissionLog);
