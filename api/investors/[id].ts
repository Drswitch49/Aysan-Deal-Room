/**
 * /api/investors/:id — the partner record behind the admin drawer.
 *
 * GET returns everything the record's tabs need in one read: details,
 * certification, portal access, commitments with their capital transactions,
 * documents and the audit trail.
 *
 * PATCH edits the record. Two fields carry rules the database also enforces and
 * which are spelled out here so the refusal reads plainly:
 *   · certification — a valid certification needs a kind, a date signed and an
 *     evidence link, and only admin/cfo may record it;
 *   · passing a partner — needs both a reason and a category, and revokes the
 *     login the same day.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { ALL_STAFF, PARTNER_MANAGERS } from "../_lib/authz.js";
import { ForbiddenError, NotFoundError, BadRequestError, InternalError } from "../../lib/core/errors.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { isCertifiedNow } from "../_lib/investor-context.js";
import { recordAudit, setPortalAccess, translateGateError } from "../_lib/investor-access.js";

const idSchema = z.object({ id: z.string().uuid("A capital partner id (uuid) is required") });

const patchSchema = z
  .object({
    name: z.string().min(1).optional(),
    entity: z.string().nullable().optional(),
    email: z.string().email().optional(),
    phone: z.string().nullable().optional(),
    type: z.enum(["holdco_equity", "deal_equity", "prospective"]).optional(),
    warmth: z.number().int().min(0).max(3).optional(),
    source: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    last_touch: z.string().nullable().optional(),
    perimeter_flag: z.boolean().optional(),

    status: z.enum(["prospective", "certified", "invited", "active", "committed", "passed", "ended"]).optional(),
    pass_reason: z.string().nullable().optional(),
    pass_category: z.string().nullable().optional(),

    certification_status: z.enum(["not_certified", "pending", "valid", "expired"]).optional(),
    certification_kind: z.enum(["hnw", "self_cert_sophisticated"]).nullable().optional(),
    certification_date: z.string().nullable().optional(),
    certification_evidence_link: z.string().nullable().optional(),
  })
  .strict();

/** Fields only admin/cfo may touch — the regulated half of the record. */
const RESTRICTED = new Set([
  "certification_status",
  "certification_kind",
  "certification_date",
  "certification_evidence_link",
  "perimeter_flag",
  "status",
  "pass_reason",
  "pass_category",
]);

export default createHandler({
  methods: ["GET", "PATCH"],
  requireAuth: true,
  roles: ALL_STAFF,
  handle: async ({ req, body, query, user }) => {
    const { id } = idSchema.parse(query);
    const db = adminClient();

    if (req.method === "GET") return loadRecord(id);

    // ── PATCH ──
    const patch = patchSchema.parse(body ?? {});
    if (Object.keys(patch).length === 0) throw new BadRequestError("Empty update");

    const restricted = Object.keys(patch).filter((k) => RESTRICTED.has(k));
    if (restricted.length && (!user || !PARTNER_MANAGERS.includes(user.role))) {
      throw new ForbiddenError(
        `Only an admin or the CFO may change: ${restricted.join(", ")}`,
      );
    }

    const { data: before, error: readErr } = await db
      .from("investors")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (readErr) throw new InternalError(`investors: ${readErr.message}`);
    if (!before) throw new NotFoundError("Capital partner not found");

    // Recording a valid certification moves a prospective partner to certified.
    // It does NOT grant access — that is a separate, deliberate act.
    const next: Record<string, unknown> = { ...patch };
    if (patch.certification_status === "valid" && before.status === "prospective") {
      next.status = next.status ?? "certified";
    }

    const { data: updated, error } = await db
      .from("investors")
      .update(next)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw translateGateError(error.message);

    await recordAudit({
      action: "UPDATE_PARTNER",
      entityId: id,
      actor: user!,
      details: `Updated capital partner ${updated.name}`,
      reason: typeof patch.pass_reason === "string" ? patch.pass_reason : undefined,
      oldValue: before,
      newValue: updated,
    });

    // Passing or ending the relationship revokes the login the same day, so the
    // record and the access can never disagree.
    if ((patch.status === "passed" || patch.status === "ended") && before.status !== patch.status) {
      await setPortalAccess(id, false, user!, patch.pass_reason ?? `Partner ${patch.status}`);
    }

    return loadRecord(id);
  },
});

/** One read for the whole drawer. */
async function loadRecord(id: string) {
  const db = adminClient();

  const { data: investor, error } = await db
    .from("investors")
    .select("*, investor_auth_map(*)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new InternalError(`investors: ${error.message}`);
  if (!investor) throw new NotFoundError("Capital partner not found");

  const { investor_auth_map: rawMap, ...investorFields } = investor as any;
  const authMap = Array.isArray(rawMap) ? rawMap[0] : rawMap;

  const [commitments, invites, documents, audit, access] = await Promise.all([
    db
      .from("commitments")
      .select(
        "*, deals(id, partner_display_name, acp_ref_no, company_name, dscr_status, next_report_date), " +
          "capital_transactions(*)",
      )
      .eq("investor_id", id)
      .order("created_at", { ascending: false }),
    db.from("portal_invites").select("*").eq("investor_id", id).order("issued_at", { ascending: false }).limit(10),
    db.from("investor_documents").select("*").eq("investor_id", id).order("uploaded_at", { ascending: false }),
    db
      .from("audit_logs")
      .select("id, action, operator, operator_role, details, reason, occurred_at")
      .eq("entity_type", "investors")
      .eq("entity_id", id)
      .order("occurred_at", { ascending: false })
      .limit(50),
    db
      .from("access_log")
      .select("id, event, created_at, ip")
      .eq("investor_id", id)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const docsOpened30d = (access.data ?? []).filter(
    (r: any) => r.event === "doc_open" && Date.now() - new Date(r.created_at).getTime() < 30 * 864e5,
  ).length;

  return {
    investor: {
      ...investorFields,
      certified_now: isCertifiedNow(investor.certification_status, investor.certification_date),
    },
    access: {
      login_mode: authMap?.login_mode ?? "none",
      auth_bound: Boolean(authMap?.auth_uid),
      first_login_at: authMap?.first_login_at ?? null,
      last_login_at: authMap?.last_login_at ?? null,
      terms_version: authMap?.terms_version ?? null,
      terms_accepted_at: authMap?.terms_accepted_at ?? null,
      read_only_until: authMap?.read_only_until ?? null,
      documents_opened_30d: docsOpened30d,
    },
    invites: invites.data ?? [],
    commitments: commitments.data ?? [],
    documents: documents.data ?? [],
    audit: audit.data ?? [],
    access_log: access.data ?? [],
  };
}
