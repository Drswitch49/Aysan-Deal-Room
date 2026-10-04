/**
 * GET /api/investor-portal/agreement-pdf[?version=n] — a signed Investors
 * Agreement as a PDF.
 *
 * Built on request from the stored signature (the exact text the partner was
 * shown, plus the signature page), so the copy always carries the latest
 * countersignature. A partner gets only their own; staff in the Investors area
 * name the partner with ?investor_id=.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { INVESTOR_ROLES } from "../_lib/authz.js";
import { ForbiddenError, NotFoundError } from "../../lib/core/errors.js";
import { resolveInvestorScope } from "../_lib/investor-context.js";
import { signaturesFor, signedAgreementPdf } from "../_lib/agreements.js";

const querySchema = z.object({
  version: z.coerce.number().int().positive().optional(),
  investor_id: z.string().uuid().optional(),
});

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async ({ res, query, user }) => {
    const { version, investor_id } = querySchema.parse(query ?? {});
    if (user && user.role !== "investor" && !INVESTOR_ROLES.includes(user.role)) {
      throw new ForbiddenError("Your role cannot read capital partner agreements.");
    }
    const scope = await resolveInvestorScope(user, investor_id);

    const signatures = await signaturesFor(scope.investorId);
    const sig = version ? signatures.find((s) => s.version === version) : signatures[0];
    if (!sig) throw new NotFoundError("No signed agreement found");

    const bytes = await signedAgreementPdf(sig);
    const name = `Investors_Agreement_v${sig.version}_${scope.name.replace(/[^A-Za-z0-9]+/g, "_")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).send(Buffer.from(bytes));
    return undefined;
  },
});
