/** /api/audit-logs — read-only list (filter by entity_type/entity_id). Admins only. */
import { createHandler } from "../_lib/handler.js";
import { ALL_ADMINS } from "../_lib/authz.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  roles: ALL_ADMINS,
  handle: async ({ query }) => repositories.auditLogs.list(query as Record<string, unknown>),
});
