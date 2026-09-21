/**
 * /api/postcall-controls?deal_id=… — per-deal post-call scorecard controls.
 *
 * GET   → institutional band + DSCR sanction state for the deal.
 * PATCH → { deal_id, institutional_band_pct?, dscr_sanctioned?, dscr_sanction_note? }.
 *         Admins only: the sanction is what unlocks loi_ready and figures in
 *         broker emails, so it is not writable through the generic deal PATCH.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { ALL_ADMINS, displayName } from "../_lib/authz.js";
import { ForbiddenError } from "../../lib/core/errors.js";
import { dealControlsPatchSchema, getDealControls, setDealControls } from "../../lib/postcall/playbook.js";

const querySchema = z.object({ deal_id: z.string().uuid("A deal id (uuid) is required") });

export default createHandler({
  methods: ["GET", "PATCH"],
  requireAuth: true,
  handle: async ({ req, body, query, user }) => {
    if (req.method === "GET") return getDealControls(querySchema.parse(query).deal_id);
    if (!user || !ALL_ADMINS.includes(user.role)) throw new ForbiddenError("Setting post-call controls requires an admin role");
    return setDealControls(dealControlsPatchSchema.parse(body ?? {}), displayName(user));
  },
});
