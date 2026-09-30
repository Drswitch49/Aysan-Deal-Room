/**
 * GET /api/investor-portal/documents — every document the partner may see now,
 * across their holdings, newest first, optionally filtered to one acquisition.
 *
 * Scope comes from the partner_documents view; release comes from the capital
 * gates and the category order (api/_lib/document-gates.ts). A document whose
 * gate is not met is simply absent, whatever its release date says.
 *
 * The view carries no storage_path, file_link or sign-offs, so this response
 * cannot leak a shareable URL even by accident. A scheduled document comes back
 * with available: false and its publishes_on date. A corrected document keeps
 * its old version, marked superseded.
 */
import { createHandler } from "../_lib/handler.js";
import { resolveInvestorScope } from "../_lib/investor-context.js";
import { partnerVisibleDocuments } from "../_lib/document-gates.js";

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ query, user }) => {
    const scope = await resolveInvestorScope(user, (query as any)?.investor_id);
    const dealKey = (query as any)?.deal_key as string | undefined;
    const { rows } = await partnerVisibleDocuments(scope, dealKey);
    return { rows, total: rows.length, certified_now: scope.certifiedNow };
  },
});
