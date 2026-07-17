/**
 * POST /api/lenders/provision — create a lender WITH a real Supabase Auth
 * account (Phase 4 decision: no more shared slug passwords). Returns the
 * generated password ONCE so the admin can hand it to the lender; the lender
 * signs in at the normal login with email + password.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { ALL_ADMINS } from "../_lib/authz.js";
import { ForbiddenError, ConflictError, InternalError } from "../../lib/core/errors.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { generatePassword, generateSlugSuffix } from "../../lib/core/secure-random.js";

const bodySchema = z.object({
  company_name: z.string().min(1),
  contact_name: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  criteria_pills: z.string().optional(),
  nda_approved: z.boolean().optional(),
});

export default createHandler<z.infer<typeof bodySchema>>({
  methods: ["POST"],
  requireAuth: true,
  roles: ALL_ADMINS,
  bodySchema,
  handle: async ({ body, user }) => {
    const db = adminClient();

    // Slug retained for display/legacy URLs; auth is email+password via Supabase.
    const slugBase = body.company_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "lender";
    const portal_slug = `${slugBase}-${generateSlugSuffix(6)}`;
    const lender_ref = `LND-${generateSlugSuffix(6).toUpperCase()}`;
    const password = generatePassword(14);

    const lender = await repositories.lenders.create({
      company_name: body.company_name,
      contact_name: body.contact_name,
      email: body.email,
      phone: body.phone,
      portal_slug,
      criteria_pills: body.criteria_pills,
      lender_ref,
      nda_approved: body.nda_approved ?? false,
    } as never);

    const { data: created, error } = await db.auth.admin.createUser({
      email: body.email,
      password,
      email_confirm: true,
      app_metadata: { role: "lender", lender_id: (lender as any).id },
      user_metadata: { company_name: body.company_name, contact_name: body.contact_name },
    });
    if (error) {
      await repositories.lenders.remove((lender as any).id).catch(() => undefined);
      if (/already/i.test(error.message)) throw new ConflictError(`An account already exists for ${body.email}`);
      throw new InternalError(`Auth account creation failed: ${error.message}`);
    }
    await db.from("lenders").update({ auth_user_id: created.user.id }).eq("id", (lender as any).id);

    await repositories.auditLogs.create({
      action: "CREATE_LENDER",
      event_type: "lender.create",
      entity_type: "lender",
      entity_id: (lender as any).id,
      operator: user?.email,
      operator_role: user?.role,
      details: `Provisioned lender ${body.company_name} (${body.email})`,
      occurred_at: new Date().toISOString(),
    });

    return { lender, portal_slug, password };
  },
});
