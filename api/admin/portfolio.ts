import { authenticateAdmin } from "./lenders.js";
import { emitEvent } from "../_events/emit.js";
import {
  getPortfolioMetrics,
  getPortfolioAlerts,
  getPortfolioHealth,
  getPortfolioSummaryBriefing,
  isAirtableConnected,
} from "../../lib/portfolio/db.js";
import { calculatePortfolioHealthIndex } from "../../lib/portfolio/scoring/index.js";

export default async function handler(req: any, res: any) {
  if (req.method === "GET") {
    try {
      // 1. Authenticate Admin
      await authenticateAdmin(req);

      // 2. Fetch all portfolio data
      const [metrics, alerts, healths] = await Promise.all([
        getPortfolioMetrics().catch(() => []),
        getPortfolioAlerts().catch(() => []),
        getPortfolioHealth().catch(() => []),
      ]);

      const summaryBriefing = getPortfolioSummaryBriefing();
      const healthIndex = calculatePortfolioHealthIndex(healths);

      return res.status(200).json({
        success: true,
        metrics,
        alerts,
        healths,
        summaryBriefing,
        healthIndex,
        isFallbackActive: !isAirtableConnected(),
      });
    } catch (err: any) {
      console.error("[Portfolio API GET] Error loading portfolio data:", err);
      return res.status(err.status || 500).json({ error: err.message || "Failed to load portfolio data" });
    }
  } else if (req.method === "POST") {
    try {
      // 1. Authenticate Admin
      await authenticateAdmin(req);

      // 2. Emit process requested event to queue the Inngest workflow
      const result = await emitEvent("portfolio/process_requested", {
        triggeredBy: "admin_manual",
      });

      if (!result) {
        throw new Error("Failed to queue Inngest event.");
      }

      return res.status(200).json({
        success: true,
        message: "Portfolio analysis task successfully queued.",
      });
    } catch (err: any) {
      console.error("[Portfolio API POST] Error queueing task:", err);
      return res.status(err.status || 500).json({ error: err.message || "Failed to queue analysis task" });
    }
  } else {
    return res.status(405).json({ error: "Method not allowed" });
  }
}
