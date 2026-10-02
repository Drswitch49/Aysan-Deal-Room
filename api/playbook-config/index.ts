/**
 * /api/playbook-config — the post-call scorecard thresholds, per lane.
 *
 * GET  ?lane=lane_1_cfs|lane_2_wbs → every version (of that lane), newest first.
 * POST → a new version. The table is insert-only: thresholds are never edited
 *        in place, so every past run still points at the values it was scored on.
 *        { lane: "lane_2_wbs", thresholds, weights, sign? } → a WBS version.
 *        { action: "sign", version }                       → a signed copy.
 *        Anything else                                     → a Lane 1 version.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { ALL_ADMINS, displayName } from "../_lib/authz.js";
import { ForbiddenError } from "../../lib/core/errors.js";
import {
  createPlaybookVersion, createWbsConfigVersion, listPlaybookVersions, newPlaybookVersionSchema,
  signPlaybookVersion, wbsConfigSchema,
} from "../../lib/postcall/playbook.js";
import { LANES } from "../../src/lib/acp/wbsSpec.js";

const querySchema = z.object({ lane: z.enum(LANES).optional() });
const signSchema = z.object({ action: z.literal("sign"), version: z.number().int().positive() }).strict();

export default createHandler({
  methods: ["GET", "POST"],
  requireAuth: true,
  handle: async ({ req, body, query, user }) => {
    if (req.method === "GET") return listPlaybookVersions(querySchema.parse(query ?? {}).lane);
    if (!user || !ALL_ADMINS.includes(user.role)) throw new ForbiddenError("Changing the Playbook config requires an admin role");
    const input = (body ?? {}) as Record<string, unknown>;
    if (input.action === "sign") return signPlaybookVersion(signSchema.parse(input).version, displayName(user));
    if (input.lane === "lane_2_wbs") return createWbsConfigVersion(wbsConfigSchema.parse(input), displayName(user));
    return createPlaybookVersion(newPlaybookVersionSchema.parse(input), displayName(user));
  },
});
