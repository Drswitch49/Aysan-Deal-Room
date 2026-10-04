/**
 * POST /api/investor-portal/memorandum — a partner's response to a Deal
 * Memorandum (the O2 Acquisition Memorandum), under clause 3 of the Investors
 * Agreement.
 *
 *   receive — "I have received and read this." Records the receipt and starts
 *             the 10-business-day right of first refusal window (clause 3.3).
 *             Refused until the partner has opened the memorandum at least once.
 *   exercise / waive — the election, made once, inside the window.
 *
 * The memorandum must be one the partner can see right now: the same gate the
 * document list applies, so nothing is answered around it by id. Staff viewing
 * a partner's portal cannot respond for them, and a read-only partner has no
 * actions.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { BadRequestError, ConflictError, ForbiddenError, InternalError, NotFoundError } from "../../lib/core/errors.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { resolveInvestorScope } from "../_lib/investor-context.js";
import { partnerVisibleDocuments } from "../_lib/document-gates.js";
import { logActivity } from "../_lib/investor-access.js";
import { requestOrigin } from "../_lib/agreements.js";
import { ROFR_BUSINESS_DAYS, addWorkingDays } from "../../lib/core/investor-agreement.js";

const bodySchema = z.object({
  document_id: z.string().uuid("A document id is required"),
  action: z.enum(["receive", "exercise", "waive"]),
});

export default createHandler({
  methods: ["POST"],
  requireAuth: true,
  handle: async ({ req, body, user }) => {
    const input = bodySchema.parse(body ?? {});
    const scope = await resolveInvestorScope(user);
    if (scope.viewedByStaff) throw new ForbiddenError("Only the partner can respond to a memorandum.");
    if (scope.readOnly) throw new ForbiddenError("Your access is read only.");

    const { rows } = await partnerVisibleDocuments(scope);
    const doc = rows.find((r) => r.id === input.document_id);
    if (!doc || !doc.available) throw new NotFoundError("Document not found");
    if (doc.doc_type !== "diligence_pack") throw new BadRequestError("Only a Deal Memorandum takes this response.");

    const db = adminClient();
    const { data: existing, error: readErr } = await db
      .from("memorandum_receipts")
      .select("*")
      .eq("investor_id", scope.investorId)
      .eq("document_id", input.document_id)
      .maybeSingle();
    if (readErr) throw new InternalError(`memorandum_receipts: ${readErr.message}`);

    if (input.action === "receive") {
      if (existing) return { receipt: existing };

      const { data: opened } = await db
        .from("access_log")
        .select("id")
        .eq("investor_id", scope.investorId)
        .eq("document_id", input.document_id)
        .eq("event", "doc_open")
        .limit(1);
      if (!opened?.length) throw new BadRequestError("Open and read the memorandum before confirming you have received it.");

      const { data: meta } = await db
        .from("investor_documents")
        .select("deal_id, title, version")
        .eq("id", input.document_id)
        .maybeSingle();
      const { ip, userAgent } = requestOrigin(req);
      const now = new Date();
      const { data: receipt, error } = await db
        .from("memorandum_receipts")
        .insert({
          investor_id: scope.investorId,
          document_id: input.document_id,
          deal_id: meta?.deal_id ?? null,
          doc_title: meta?.title ?? doc.title,
          doc_version: meta?.version ?? 1,
          received_at: now.toISOString(),
          respond_by: addWorkingDays(now, ROFR_BUSINESS_DAYS),
          ip,
          user_agent: userAgent,
        })
        .select("*")
        .single();
      if (error) throw new InternalError(`Could not record the receipt: ${error.message}`);
      await logActivity(scope.investorId, meta?.deal_id ?? null, "memorandum_received", {
        title: receipt.doc_title,
        respond_by: receipt.respond_by,
      });
      return { receipt };
    }

    // exercise / waive
    if (!existing) throw new BadRequestError("Confirm you have received the memorandum first.");
    if (existing.election) throw new ConflictError("You have already responded to this memorandum.");
    // The window runs to the end of its last business day, UK time.
    const closes = new Date(`${existing.respond_by}T23:59:59+01:00`).getTime();
    if (Date.now() > closes) {
      throw new ConflictError("The response window for this memorandum has closed. Contact partnerships@aysancapital.com.");
    }

    const { data: receipt, error } = await db
      .from("memorandum_receipts")
      .update({ election: input.action, elected_at: new Date().toISOString() })
      .eq("id", existing.id)
      .is("election", null)
      .select("*")
      .single();
    if (error) throw new InternalError(`Could not record your response: ${error.message}`);
    await logActivity(scope.investorId, existing.deal_id ?? null, input.action === "exercise" ? "rofr_exercised" : "rofr_waived", {
      title: receipt.doc_title,
    });
    return { receipt };
  },
});
