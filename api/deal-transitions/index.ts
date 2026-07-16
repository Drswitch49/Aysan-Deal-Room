/**
 * POST /api/deal-transitions — move a deal through its lifecycle
 * (inbox → review → active → archived / revive). Replaces the legacy
 * promote-deal / remove-deal / update-inbox-status action cases.
 */
import { createHandler } from "../_lib/handler.js";
import { WRITERS } from "../_lib/authz.js";
import { ForbiddenError } from "../../lib/core/errors.js";
import { transitionDeal, transitionInputSchema, type TransitionInput } from "../_services/deals.js";

export default createHandler<TransitionInput>({
  methods: ["POST"],
  requireAuth: true,
  bodySchema: transitionInputSchema,
  handle: async ({ body, user }) => {
    if (!user || !WRITERS.includes(user.role)) {
      throw new ForbiddenError("Transitioning deals requires a writer role");
    }
    return transitionDeal(body, { email: user.email, role: user.role });
  },
});
