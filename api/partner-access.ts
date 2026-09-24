/**
 * POST /api/partner-access — issue, revoke, restore or reset a capital
 * partner's portal access.
 *
 * Kept off /api/investors/:id deliberately. Editing a record and granting
 * someone access to a regulated relationship are different acts with different
 * consequences, and a PATCH that could quietly do the second is exactly the
 * kind of accident the Build Pack's gates exist to prevent.
 *
 * `issue` returns the temporary password once. It is also emailed to the
 * partner straight away; the response says whether it actually went, and to
 * the admin address instead while portal_settings.notify_only holds.
 */
import { z } from "zod";
import { createHandler } from "./_lib/handler.js";
import { PARTNER_MANAGERS } from "./_lib/authz.js";
import { BadRequestError, InternalError, NotFoundError } from "../lib/core/errors.js";
import { adminClient } from "../lib/data/supabase/client.js";
import { generatePassword } from "../lib/core/secure-random.js";
import { queueAndSend, supersedeQueued } from "../lib/email/send.js";
import {
  issuePortalAccess,
  portalUrl,
  recordAudit,
  setPortalAccess,
} from "./_lib/investor-access.js";

const bodySchema = z.object({
  investor_id: z.string().uuid(),
  action: z.enum(["issue", "revoke", "restore", "reset_password"]),
  /** Required for revoke: the record has to say why access was withdrawn. */
  reason: z.string().trim().min(3).optional(),
});

export default createHandler<z.infer<typeof bodySchema>>({
  methods: ["POST"],
  requireAuth: true,
  roles: PARTNER_MANAGERS,
  bodySchema,
  handle: async ({ req, body, user }) => {
    switch (body.action) {
      case "issue":
        return issuePortalAccess(body.investor_id, user!, req);

      case "revoke": {
        if (!body.reason) throw new BadRequestError("Give a reason — it is recorded against the partner.");
        const result = await setPortalAccess(body.investor_id, false, user!, body.reason);
        return { ...result, login_mode: "revoked" };
      }

      case "restore": {
        const result = await setPortalAccess(body.investor_id, true, user!, body.reason);
        return { ...result, login_mode: "full" };
      }

      case "reset_password": {
        const db = adminClient();
        const { data: investor } = await db
          .from("investors")
          .select("id, name, email")
          .eq("id", body.investor_id)
          .is("deleted_at", null)
          .maybeSingle();
        if (!investor) throw new NotFoundError("Capital partner not found");

        const { data: map } = await db
          .from("investor_auth_map")
          .select("auth_uid")
          .eq("investor_id", body.investor_id)
          .maybeSingle();
        if (!map?.auth_uid) {
          throw new BadRequestError("This partner has no portal account yet — issue access first.");
        }

        const password = generatePassword(16);
        const { error } = await db.auth.admin.updateUserById(map.auth_uid, {
          password,
          app_metadata: { role: "investor", investor_id: body.investor_id, must_change_password: true },
        });
        if (error) throw new InternalError(`Could not reset the password: ${error.message}`);

        const base = portalUrl(req);
        await supersedeQueued(body.investor_id, "credentials");
        const delivery = await queueAndSend({
          investorId: body.investor_id,
          template: "credentials",
          to: investor.email,
          payload: { name: investor.name, password, portalUrl: base },
        });
        await recordAudit({
          action: "RESET_PARTNER_PASSWORD",
          entityId: body.investor_id,
          actor: user!,
          details: `Reset portal password for ${investor.name}`,
          reason: body.reason,
        });

        return {
          investorId: body.investor_id,
          email: investor.email,
          password,
          portalUrl: base,
          notifyOnly: delivery.notifyOnly,
          delivery,
        };
      }
    }
  },
});
