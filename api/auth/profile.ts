/**
 * PATCH /api/auth/profile — the signed-in user sets their own display name.
 *
 * Most accounts were imported without a name, which is why the sidebar fell
 * back to an email address. The name is written to both the auth account
 * (`user_metadata.full_name`, the first place every session read looks) and
 * the `profiles` row, so it survives regardless of which one is consulted.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { getTokens, invalidateAccessToken } from "../_lib/session.js";
import { forgetDisplayName, escapeLike } from "../_lib/display-name.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { InternalError, UnauthorizedError } from "../../lib/core/errors.js";

const bodySchema = z.object({
  name: z.string().trim().min(1, "A display name is required").max(80, "Keep the name under 80 characters"),
});

export default createHandler({
  methods: ["PATCH"],
  requireAuth: true,
  bodySchema,
  handle: async ({ req, body, user }) => {
    if (!user?.id) throw new UnauthorizedError();
    const db = adminClient();

    const { error } = await db.auth.admin.updateUserById(user.id, {
      user_metadata: { full_name: body.name },
    });
    if (error) throw new InternalError(`Could not save your name: ${error.message}`);

    // Mirror onto the profiles row when one exists. Absence is not an error —
    // portal accounts (lender/shareholder) have no profiles row.
    await db.from("profiles").update({ full_name: body.name }).eq("auth_user_id", user.id);
    if (user.email) {
      await db.from("profiles").update({ full_name: body.name }).is("auth_user_id", null).ilike("email", escapeLike(user.email));
    }

    // Both caches hold the old name; clear them so the change shows at once.
    forgetDisplayName(user.id);
    const { access } = getTokens(req);
    if (access) invalidateAccessToken(access);

    return { name: body.name };
  },
});
