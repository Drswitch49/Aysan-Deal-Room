/**
 * /api/stakeholders — external stakeholders list + create.
 *
 * Choosing type "Investor" on this form is how a capital partner enters the
 * system, so a create with that type also lays down the investor record the
 * portal hangs off (api/_lib/investor-access.ts). It grants no access: that is
 * a separate, gated act on the Capital Partners tab.
 */
import { collectionHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { INVESTOR_ROLES } from "../_lib/authz.js";
import { syncInvestorFromStakeholder } from "../_lib/investor-access.js";

export default collectionHandler(repositories.externalStakeholders, {
  readRoles: INVESTOR_ROLES,
  writeRoles: INVESTOR_ROLES,
  onCreated: async (row) => {
    await syncInvestorFromStakeholder(row);
  },
});
