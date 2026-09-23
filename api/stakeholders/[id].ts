/**
 * /api/stakeholders/:id — fetch / update / soft-delete.
 *
 * Editing a stakeholder that is (or has just become) an investor keeps the
 * capital partner record in step — a renamed or re-addressed stakeholder must
 * not leave the portal showing the old details. Changing the type away from
 * Investor does not delete the partner record: commitments and capital
 * transactions are a record of fact, so ending the relationship is an explicit
 * act on the partner record, not a side effect of a dropdown.
 */
import { itemHandler } from "../_lib/crud-route.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { PEOPLE_MANAGERS } from "../_lib/authz.js";
import { syncInvestorFromStakeholder } from "../_lib/investor-access.js";

export default itemHandler(repositories.externalStakeholders, {
  writeRoles: PEOPLE_MANAGERS,
  deleteRoles: PEOPLE_MANAGERS,
  onUpdated: async (row) => {
    await syncInvestorFromStakeholder(row);
  },
});
