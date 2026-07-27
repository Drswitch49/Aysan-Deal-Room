/**
 * POST /api/lenders/reset-password — admin resets a lender's Supabase Auth
 * password to a fresh random one, returned ONCE. Replaces the legacy
 * reset-password / get-lender-passcode / regenerate-portal action cases
 * (plaintext passcodes are gone).
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { ALL_ADMINS } from "../_lib/authz.js";
import { NotFoundError, BadRequestError, InternalError } from "../../lib/core/errors.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { generatePassword } from "../../lib/core/secure-random.js";

const bodySchema = z.object({ lender_id: z.string().uuid() });

export default createHandler<z.infer<typeof bodySchema>>({
  methods: ["POST"],
  requireAuth: true,
  roles: ALL_ADMINS,
  bodySchema,
  handle: async ({ body, user }) => {
    const lender = await repositories.lenders.findById(body.lender_id);
    if (!lender) throw new NotFoundError("Lender not found");
    if (!lender.auth_user_id) throw new BadRequestError("Lender has no auth account yet — use provision.");

    const password = generatePassword(14);
    const { error } = await adminClient().auth.admin.updateUserById(lender.auth_user_id, { password });
    if (error) throw new InternalError(`Password reset failed: ${error.message}`);

    await repositories.auditLogs.create({
      action: "RESET_LENDER_PASSWORD",
      event_type: "lender.reset_password",
      entity_type: "lender",
      entity_id: body.lender_id,
      operator: user?.email,
      operator_role: user?.role,
      occurred_at: new Date().toISOString(),
    });
    return { password };
  },
});
