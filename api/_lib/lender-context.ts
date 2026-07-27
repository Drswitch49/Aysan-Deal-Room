/**
 * Lender session context (Phase 6) — resolves the signed-in lender and their
 * assigned deal ids. Staff (admin/etc.) may also call lender endpoints for a
 * specific lender via ?lender_id=… ; lenders are always scoped to themselves.
 */
import type { UserContext } from "./authz.js";
import { ALL_STAFF } from "./authz.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/core/errors.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export interface LenderScope {
  lenderId: string;
  dealIds: string[];
}

export async function resolveLenderScope(user: UserContext | null, requestedLenderId?: string): Promise<LenderScope> {
  if (!user) throw new UnauthorizedError();

  let lenderId: string | null = null;
  if (user.role === "lender") {
    lenderId = user.lenderId ?? null;
  } else if (ALL_STAFF.includes(user.role)) {
    lenderId = requestedLenderId ?? null;
  }
  if (!lenderId) throw new ForbiddenError("No lender scope available for this session");

  const assignments = await repositories.lenderDealAssignments.list({ lender_id: lenderId, limit: 200 });
  const dealIds = assignments.rows.map((a: any) => a.deal_id).filter(Boolean);
  return { lenderId, dealIds };
}
