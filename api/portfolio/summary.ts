/**
 * GET /api/portfolio/summary — companies + metrics + alerts + health in one
 * call (replaces the legacy /api/admin/portfolio aggregate).
 */
import { createHandler } from "../_lib/handler.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

export default createHandler({
  methods: ["GET"],
  requireAuth: true,
  handle: async () => {
    const [companies, metrics, alerts, healths] = await Promise.all([
      repositories.portfolioCompanies.list({ limit: 200 }),
      repositories.portfolioMetrics.list({ limit: 200 }),
      repositories.portfolioAlerts.list({ limit: 200 }),
      repositories.portfolioHealth.list({ limit: 200 }),
    ]);
    return {
      companies: companies.rows,
      metrics: metrics.rows,
      alerts: alerts.rows,
      healths: healths.rows,
    };
  },
});
