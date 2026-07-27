/** /api/portfolio-companies — list + create. */
import { collectionHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export default collectionHandler(repositories.portfolioCompanies);
