/** /api/deal-notes — list (filter by deal_id) + create (author stamped from session). */
import { createHandler } from "../_lib/handler.js";
import { ALL_STAFF, displayName } from "../_lib/authz.js";
import { ForbiddenError } from "../../lib/core/errors.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export default createHandler({
  methods: ["GET", "POST"],
  requireAuth: true,
  handle: async ({ req, body, query, user }) => {
    if (req.method === "GET") return repositories.dealNotes.list(query as Record<string, unknown>);

    if (!user || !ALL_STAFF.includes(user.role)) throw new ForbiddenError("Insufficient role to create");

    const input = (body ?? {}) as Record<string, unknown>;
    // Stamp authorship server-side so notes reliably show who wrote them
    // (client-supplied values are honoured only as a fallback).
    return repositories.dealNotes.create({
      ...input,
      author: (input.author as string) || displayName(user),
      author_email: (input.author_email as string) || user.email || null,
    });
  },
});
