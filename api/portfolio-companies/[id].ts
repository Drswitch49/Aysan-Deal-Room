/** /api/portfolio-companies/:id — fetch / update / soft-delete. */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export default itemHandler(repositories.portfolioCompanies);
