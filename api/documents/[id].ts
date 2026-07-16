/** /api/documents/:id — fetch / update / soft-delete a document. */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export default itemHandler(repositories.documents);
