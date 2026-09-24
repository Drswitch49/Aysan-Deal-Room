/**
 * POST /api/investor-portal/forgot — start a partner password reset.
 *
 * Public by design: somebody who has forgotten their password has no session.
 *
 * The response is identical whether or not the address belongs to a partner —
 * "if that email has portal access, a reset link is on its way". Anything else
 * turns this endpoint into a way of asking whether a named person is one of
 * ACP's capital partners, which is exactly the fact the portal exists to keep
 * private.
 *
 * For the same reason the work happens after the reply is decided, and every
 * failure inside it is swallowed rather than surfaced.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { queueAndSend } from "../../lib/email/send.js";
import { logger } from "../../lib/core/logger.js";
import { portalUrl } from "../_lib/investor-access.js";

const bodySchema = z.object({ email: z.string().email() });

/** The one answer this endpoint ever gives. */
const ALWAYS = {
  ok: true,
  message: "If that email has portal access, a reset link is on its way.",
};

export default createHandler<z.infer<typeof bodySchema>>({
  methods: ["POST"],
  requireAuth: false,
  bodySchema,
  handle: async ({ req, body }) => {
    const email = body.email.trim().toLowerCase();

    try {
      const db = adminClient();
      const { data: investor } = await db
        .from("investors")
        .select("id, name, email, status, investor_auth_map(auth_uid, login_mode)")
        .ilike("email", email)
        .is("deleted_at", null)
        .maybeSingle();

      if (!investor) return ALWAYS;

      const rawMap = (investor as any).investor_auth_map;
      const map = Array.isArray(rawMap) ? rawMap[0] : rawMap;

      // No account, or access withdrawn: say the same thing, send nothing. A
      // revoked partner must not be handed a working link back in.
      if (!map?.auth_uid) return ALWAYS;
      if (!["pending", "full", "read_only"].includes(String(map.login_mode))) return ALWAYS;
      if (["passed", "ended"].includes(String(investor.status))) return ALWAYS;

      const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email: investor.email });
      if (error || !data.properties?.hashed_token) {
        logger.error({ err: error }, "partner recovery link generation failed");
        return ALWAYS;
      }

      const base = portalUrl(req);
      const origin = new URL(base).origin;
      const link = `${origin}/api/auth/callback?token=${encodeURIComponent(
        data.properties.hashed_token,
      )}&type=recovery`;

      await queueAndSend({
        investorId: investor.id,
        template: "password_reset",
        to: investor.email,
        payload: { name: investor.name, link, portalUrl: base },
      });
    } catch (err) {
      // Never let an internal failure become a different answer.
      logger.error({ err }, "partner password reset failed");
    }

    return ALWAYS;
  },
});
