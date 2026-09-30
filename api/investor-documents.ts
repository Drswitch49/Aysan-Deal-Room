/**
 * /api/investor-documents — the partner documents staff file, gate and release.
 *
 * Investor Portal Document Standard v1.1: 11 document types in 7 categories.
 * The category always follows from the type (lib/core/investor-docs.ts), so it
 * is never taken from the request, and "other" no longer exists.
 *
 * Lifecycle of one document version:
 *   1. Upload. It is a draft: no partner can see it.
 *   2. Sign-offs. The written parts of its capital gate (legal counsel
 *      approval, CFO sanctions) are recorded against this exact version. CFO
 *      sign-offs need the cfo role; legal counsel is not a system user, so an
 *      admin records their approval with a reference to it.
 *   3. Release. Refused with NOT READY and the blockers named unless every
 *      gate is met. The partner routes re-check the gates on every read too.
 *   4. After release the version is locked (the database refuses edits and
 *      deletes). A correction is a new version that supersedes it; the old one
 *      stays visible to partners, marked superseded. Revoke hides it.
 *
 * investor_id null means every partner in the deal whose subscription the
 * category reaches (see the partner_documents view).
 */
import { z } from "zod";
import { createHandler } from "./_lib/handler.js";
import { INVESTOR_ROLES, PARTNER_MANAGERS } from "./_lib/authz.js";
import { BadRequestError, ConflictError, ForbiddenError, InternalError, NotFoundError } from "../lib/core/errors.js";
import { adminClient } from "../lib/data/supabase/client.js";
import { logActivity, recordAudit, translateGateError } from "./_lib/investor-access.js";
import { isCertifiedNow, scopeForAnnouncement } from "./_lib/investor-context.js";
import { loadGateDeals, partnerVisibleDocuments } from "./_lib/document-gates.js";
import { deleteAsset, downloadUrl } from "../lib/core/cloudinary.js";
import {
  DOC_TYPES,
  DOC_TYPE_INFO,
  NOTICE_TYPES,
  SIGNOFFS,
  evaluateDealGate,
  type DocType,
  type SignoffKey,
} from "../lib/core/investor-docs.js";

const createSchema = z
  .object({
    investor_id: z.string().uuid().nullable().optional(),
    deal_id: z.string().uuid().nullable().optional(),
    doc_type: z.enum(DOC_TYPES),
    notice_type: z.enum(NOTICE_TYPES).nullable().optional(),
    event_date: z.string().nullable().optional(),
    title: z.string().trim().min(1),
    file_link: z.string().nullable().optional(),
    cloudinary_public_id: z.string().nullable().optional(),
    cloudinary_resource_type: z.enum(["image", "raw", "video"]).nullable().optional(),
    file_format: z.string().nullable().optional(),
    file_name: z.string().nullable().optional(),
    file_bytes: z.number().int().nonnegative().nullable().optional(),
    /** A correction: the released version this one replaces. */
    supersedes_id: z.string().uuid().nullable().optional(),
    /** Try to release straight away. If a gate is not met it stays a draft. */
    release: z.boolean().optional(),
  })
  .refine((v) => v.file_link || v.cloudinary_public_id, { message: "Upload a file or give a link." })
  .refine((v) => v.deal_id || v.doc_type === "onboarding_pack", {
    message: "Every document except the onboarding pack belongs to an acquisition.",
  })
  // A correction keeps the scope of the version it replaces (checked below),
  // which for documents filed before the standard can be the whole acquisition.
  .refine((v) => DOC_TYPE_INFO[v.doc_type].scope !== "partner" || v.investor_id || v.supersedes_id, {
    message: "This document is issued to one partner. Choose the partner.",
  })
  .refine((v) => v.doc_type !== "partner_notice" || v.notice_type, { message: "Choose the notice type." })
  .refine((v) => DOC_TYPE_INFO[v.doc_type].category !== "offer" || (v.cloudinary_public_id && String(v.file_format).toLowerCase() === "pdf"), {
    message: "Offer documents must be uploaded as a PDF so each partner's copy can be watermarked.",
  });

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("release"), id: z.string().uuid() }),
  z.object({
    action: z.literal("signoff"),
    id: z.string().uuid(),
    key: z.enum(Object.keys(SIGNOFFS) as [SignoffKey, ...SignoffKey[]]),
    reference: z.string().trim().min(3, "Give a reference: where the approval or sanction is recorded."),
  }),
  z.object({
    action: z.literal("withdraw_signoff"),
    id: z.string().uuid(),
    key: z.enum(Object.keys(SIGNOFFS) as [SignoffKey, ...SignoffKey[]]),
  }),
  z.object({ action: z.literal("revoke"), id: z.string().uuid(), revoked: z.boolean() }),
  z.object({
    action: z.literal("edit"),
    id: z.string().uuid(),
    title: z.string().trim().min(1).optional(),
    notice_type: z.enum(NOTICE_TYPES).optional(),
    event_date: z.string().nullable().optional(),
  }),
]);

const deleteSchema = z.object({ id: z.string().uuid() });

export default createHandler({
  methods: ["GET", "POST", "PATCH", "DELETE"],
  requireAuth: true,
  roles: INVESTOR_ROLES,
  handle: async ({ req, body, query, user }) => {
    const db = adminClient();

    if (req.method === "GET") {
      // ?open=<id> — a short-lived link so staff can check what they uploaded.
      const openId = (query as any)?.open as string | undefined;
      if (openId) {
        const { data: doc } = await db.from("investor_documents").select("*").eq("id", openId).maybeSingle();
        if (!doc) throw new NotFoundError("Document not found");
        if (doc.cloudinary_public_id) {
          const resourceType = (doc.cloudinary_resource_type ?? "image") as "image" | "raw" | "video";
          return {
            url: downloadUrl(doc.cloudinary_public_id, {
              resourceType,
              format: resourceType === "raw" ? "" : (doc.file_format ?? ""),
              expiresInSeconds: 120,
            }),
          };
        }
        if (doc.file_link) return { url: doc.file_link };
        throw new NotFoundError("This document has no file attached");
      }

      const investorId = (query as any)?.investor_id as string | undefined;
      const dealId = (query as any)?.deal_id as string | undefined;
      let q = db
        .from("investor_documents")
        .select("*, investors(id, name, email, certification_status, certification_date, is_test)")
        .order("uploaded_at", { ascending: false });
      if (investorId) q = q.eq("investor_id", investorId);
      if (dealId) q = q.eq("deal_id", dealId);
      const { data, error } = await q;
      if (error) throw new InternalError(`investor_documents: ${error.message}`);
      const rows = (data ?? []) as any[];

      const deals = await loadGateDeals(rows.map((r) => r.deal_id).filter(Boolean));
      const copies = await copyCounts(rows.map((r) => r.id));
      const supersededBy = new Map<string, string>();
      for (const r of rows) if (r.supersedes_id && !r.revoked_at) supersededBy.set(r.supersedes_id, r.id);

      return {
        rows: rows.map((r) => {
          const deal = (r.deal_id && deals.get(r.deal_id)) || { dscr_status: null, commitments: [] };
          const gate = evaluateDealGate(r, deal, { includeTest: Boolean(r.investors?.is_test) });
          const partnerBlockers: string[] = [];
          if (r.category === "offer") {
            if (r.investors) {
              if (!isCertifiedNow(r.investors.certification_status, r.investors.certification_date)) {
                partnerBlockers.push(`${r.investors.name}'s certification is not complete, or is older than 12 months`);
              }
            }
          }
          return {
            ...r,
            gate,
            partner_blockers: partnerBlockers,
            superseded_by: supersededBy.get(r.id) ?? null,
            copies_issued: copies.get(r.id) ?? 0,
          };
        }),
        total: rows.length,
        can_sign_cfo: user?.role === "cfo",
      };
    }

    if (!user || !PARTNER_MANAGERS.includes(user.role)) {
      throw new ForbiddenError("Managing partner documents requires an admin or CFO role");
    }

    if (req.method === "POST") {
      const input = createSchema.parse(body ?? {});
      const { release, supersedes_id, ...fields } = input;
      const info = DOC_TYPE_INFO[input.doc_type];

      let version = 1;
      if (supersedes_id) {
        const { data: prev } = await db.from("investor_documents").select("*").eq("id", supersedes_id).maybeSingle();
        if (!prev) throw new NotFoundError("The version being corrected was not found");
        if (prev.doc_type !== input.doc_type || prev.deal_id !== (input.deal_id ?? null) || prev.investor_id !== (input.investor_id ?? null)) {
          throw new BadRequestError("A new version must be the same document, for the same acquisition and partner.");
        }
        if (!prev.published_at) throw new BadRequestError("That version was never released. Replace the draft instead of versioning it.");
        const { data: already } = await db
          .from("investor_documents")
          .select("id")
          .eq("supersedes_id", supersedes_id)
          .is("revoked_at", null)
          .limit(1);
        if (already?.length) throw new ConflictError("That version has already been corrected. Correct the newest version.");
        version = Number(prev.version ?? 1) + 1;
      }

      const { data: created, error } = await db
        .from("investor_documents")
        .insert({
          ...fields,
          investor_id: input.investor_id ?? null,
          deal_id: input.deal_id ?? null,
          category: info.category,
          notice_type: input.doc_type === "partner_notice" ? input.notice_type : null,
          event_date: input.doc_type === "partner_notice" ? (input.event_date ?? null) : null,
          view_only: info.category === "offer",
          supersedes_id: supersedes_id ?? null,
          version,
          uploaded_by: user.id,
        })
        .select("*")
        .single();
      if (error) throw translateGateError(error.message);

      await recordAudit({
        action: "ADD_PARTNER_DOCUMENT",
        entityId: created.id,
        entityType: "investor_documents",
        actor: user,
        details: `Filed ${info.code} ${info.label} v${version} "${created.title}"`,
        newValue: created,
      });

      if (release) {
        const result = await tryRelease(created, user);
        return { ...result.doc, gate: result.gate, released: result.released };
      }
      return { ...created, released: false };
    }

    if (req.method === "DELETE") {
      const { id } = deleteSchema.parse({ id: (query as any)?.id ?? (body as any)?.id });
      const { data: doc } = await db.from("investor_documents").select("*").eq("id", id).maybeSingle();
      if (!doc) throw new NotFoundError("Document not found");
      if (doc.published_at) {
        throw new ConflictError("A released document is never deleted. Revoke it, or issue a corrected version.");
      }

      const { error } = await db.from("investor_documents").delete().eq("id", id);
      if (error) throw translateGateError(error.message);
      // The row is what grants access, so it goes first: a file left behind by
      // a failed asset delete is unreachable, not exposed.
      if (doc.cloudinary_public_id) {
        await deleteAsset(doc.cloudinary_public_id, doc.cloudinary_resource_type ?? "image").catch(() => undefined);
      }
      await recordAudit({
        action: "DELETE_PARTNER_DOCUMENT",
        entityId: id,
        entityType: "investor_documents",
        actor: user,
        details: `Deleted draft ${doc.doc_type} "${doc.title}"`,
        oldValue: doc,
      });
      return { deleted: true, id };
    }

    // PATCH
    const input = patchSchema.parse(body ?? {});
    const { data: before } = await db.from("investor_documents").select("*").eq("id", input.id).maybeSingle();
    if (!before) throw new NotFoundError("Document not found");

    if (input.action === "release") {
      if (before.published_at) return { ...before, released: true };
      const result = await tryRelease(before, user);
      if (!result.released) {
        throw new ConflictError(`NOT READY: ${result.gate.blockers.join("; ")}.`);
      }
      return { ...result.doc, released: true };
    }

    let patch: Record<string, unknown>;
    let details: string;

    if (input.action === "signoff" || input.action === "withdraw_signoff") {
      if (before.published_at) throw new ConflictError("This version is released and locked. Sign-offs cannot change.");
      const allowed = (DOC_TYPE_INFO[before.doc_type as DocType]?.signoffs ?? []) as SignoffKey[];
      if (!allowed.includes(input.key)) throw new BadRequestError("That sign-off does not apply to this document.");
      const def = SIGNOFFS[input.key];
      if (def.owner === "cfo" && user.role !== "cfo") {
        throw new ForbiddenError(`${def.label} belongs to the CFO. Only a CFO login can record it.`);
      }
      const signoffs = { ...(before.signoffs ?? {}) } as Record<string, unknown>;
      if (input.action === "signoff") {
        signoffs[input.key] = {
          by: user.email ?? user.id,
          role: user.role,
          at: new Date().toISOString(),
          reference: input.reference,
        };
        details = `Recorded "${def.label}" on "${before.title}" (${input.reference})`;
      } else {
        delete signoffs[input.key];
        details = `Withdrew "${def.label}" on "${before.title}"`;
      }
      patch = { signoffs };
    } else if (input.action === "revoke") {
      patch = { revoked_at: input.revoked ? new Date().toISOString() : null };
      details = input.revoked ? `Revoked partner access to "${before.title}"` : `Restored partner access to "${before.title}"`;
    } else {
      if (before.published_at) throw new ConflictError("This version is released and locked. Issue a corrected version instead.");
      patch = {};
      if (input.title !== undefined) patch.title = input.title;
      if (before.doc_type === "partner_notice") {
        if (input.notice_type !== undefined) patch.notice_type = input.notice_type;
        if (input.event_date !== undefined) patch.event_date = input.event_date;
      }
      details = `Updated draft "${before.title}"`;
    }

    const { data: updated, error } = await db
      .from("investor_documents")
      .update(patch)
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) throw translateGateError(error.message);

    await recordAudit({
      action: "UPDATE_PARTNER_DOCUMENT",
      entityId: input.id,
      entityType: "investor_documents",
      actor: user,
      details,
      oldValue: before,
      newValue: updated,
    });
    return updated;
  },
});

/** Release a draft if its gate is met; otherwise report the blockers. */
async function tryRelease(doc: any, user: any): Promise<{ released: boolean; doc: any; gate: ReturnType<typeof evaluateDealGate> }> {
  const deals = await loadGateDeals(doc.deal_id ? [doc.deal_id] : []);
  const deal = (doc.deal_id && deals.get(doc.deal_id)) || { dscr_status: null, commitments: [] };
  let includeTest = false;
  if (doc.investor_id) {
    const { data: inv } = await adminClient().from("investors").select("is_test").eq("id", doc.investor_id).maybeSingle();
    includeTest = Boolean(inv?.is_test);
  }
  const gate = evaluateDealGate(doc, deal, { includeTest });
  if (!gate.ready) return { released: false, doc, gate };

  const { data: released, error } = await adminClient()
    .from("investor_documents")
    .update({ published_at: new Date().toISOString() })
    .eq("id", doc.id)
    .select("*")
    .single();
  if (error) throw translateGateError(error.message);

  await recordAudit({
    action: "RELEASE_PARTNER_DOCUMENT",
    entityId: doc.id,
    entityType: "investor_documents",
    actor: user,
    details: `Released "${doc.title}" to partners`,
    newValue: released,
  });
  await announce(released);
  return { released: true, doc: released, gate };
}

/**
 * "Document added" for every partner who can now actually see it: in scope,
 * gate met for them, and its category open for them.
 */
async function announce(doc: any): Promise<void> {
  const db = adminClient();
  const payload = { title: doc.title, doc_type: doc.doc_type };

  const candidates = new Set<string>();
  if (doc.investor_id) candidates.add(doc.investor_id);
  else if (doc.deal_id) {
    const { data } = await db.from("commitments").select("investor_id").eq("deal_id", doc.deal_id);
    for (const row of data ?? []) candidates.add(row.investor_id);
  }

  for (const investorId of candidates) {
    const scope = await scopeForAnnouncement(investorId);
    if (!scope) continue;
    const { rows } = await partnerVisibleDocuments(scope, doc.deal_id ?? undefined);
    if (rows.some((r) => r.id === doc.id && r.available)) {
      await logActivity(investorId, doc.deal_id ?? null, "document_added", payload);
    }
  }
}

async function copyCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const { data } = await adminClient().from("investor_document_copies").select("document_id").in("document_id", ids);
  for (const row of data ?? []) out.set(row.document_id, (out.get(row.document_id) ?? 0) + 1);
  return out;
}
