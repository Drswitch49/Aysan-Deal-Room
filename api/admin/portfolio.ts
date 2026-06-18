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

      // 2. Fetch all portfolio data (analytics + CRUD companies)
      const [metrics, alerts, healths, companiesRes] = await Promise.all([
        getPortfolioMetrics().catch(() => []),
        getPortfolioAlerts().catch(() => []),
        getPortfolioHealth().catch(() => []),
        (async () => {
          try {
            const { airtableFetch } = await import("../../api/_utils/airtable.js");
            const res = await airtableFetch("Portfolio_Companies", {});
            return (res.records || []).map((r: any) => ({
              id: r.id,
              companyName: r.fields.Company_Name || r.fields.companyName || "",
              industry: r.fields.Industry || "",
              location: r.fields.Location || "",
              status: r.fields.Status || "Active",
              revenue: Number(r.fields.Revenue) || 0,
              ebitda: Number(r.fields.EBITDA) || 0,
              debt: Number(r.fields.Debt) || 0,
              headcount: Number(r.fields.Headcount) || 0,
              cash: Number(r.fields.Cash) || 0,
              currentRatio: Number(r.fields.Current_Ratio) || 0,
              dscr: Number(r.fields.DSCR) || 0,
              operationalKpis: r.fields.Operational_KPI_Inputs || "",
              documentActivity: r.fields.Document_Activity_Inputs || "",
              notes: r.fields.Notes || "",
              createdAt: r.fields.Created_At || r.createdTime || "",
            }));
          } catch {
            return [];
          }
        })(),
      ]);

      const summaryBriefing = getPortfolioSummaryBriefing();
      const healthIndex = calculatePortfolioHealthIndex(healths);

      return res.status(200).json({
        success: true,
        metrics,
        alerts,
        healths,
        companies: companiesRes,
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
