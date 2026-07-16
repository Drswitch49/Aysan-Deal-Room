/** /api/documents — list (filter by deal_id/category/status) + create. */
import { collectionHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export default collectionHandler(repositories.documents);
