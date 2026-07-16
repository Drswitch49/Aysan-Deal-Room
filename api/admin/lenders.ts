/**
 * LEGACY URL ALIAS — /api/admin/lenders now serves the new Supabase-backed
 * lenders collection handler. Remove in Phase 6 when the frontend calls
 * /api/lenders directly.
 */
import lendersHandler from "../lenders/index.js";

export default lendersHandler;
export { authenticateAdmin } from "./lenders_auth_helper.js";
