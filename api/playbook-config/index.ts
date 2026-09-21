/**
 * /api/playbook-config — the post-call scorecard thresholds.
 *
 * GET  → every version, newest first (the first is what new runs use).
 * POST → a new version. The table is insert-only: thresholds are never edited
 *        in place, so every past run still points at the values it was scored on.
 */
import { createHandler } from "../_lib/handler.js";
import { ALL_ADMINS, displayName } from "../_lib/authz.js";
import { ForbiddenError } from "../../lib/core/errors.js";
import { createPlaybookVersion, listPlaybookVersions, newPlaybookVersionSchema } from "../../lib/postcall/playbook.js";

export default createHandler({
  methods: ["GET", "POST"],
  requireAuth: true,
  handle: async ({ req, body, user }) => {
    if (req.method === "GET") return listPlaybookVersions();
    if (!user || !ALL_ADMINS.includes(user.role)) throw new ForbiddenError("Changing the Playbook config requires an admin role");
    const input = newPlaybookVersionSchema.parse(body ?? {});
    return createPlaybookVersion(input, displayName(user));
  },
});
