/** /api/transcripts — transcript analyses (list by deal_id + create). */
import { collectionHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { ALL_STAFF } from "../_lib/authz.js";

export default collectionHandler(repositories.transcriptAnalyses, { writeRoles: ALL_STAFF });
