import fs from "fs";
import path from "path";
import { airtableFetch, airtableCreate, airtableUpdate } from "../../api/_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface PortfolioMetricRecord {
  companyId: string;
  companyName: string;
  reportingPeriod: string; // YYYY-MM
  revenue: number;
  ebitda: number;
  dscr: number;
  leverage: number;
  headcount: number;
  churnRate?: number; // as percentage, e.g. 2.5
  recurringRevenue?: number;
}

export interface PortfolioAlertRecord {
  id?: string;
  companyId: string;
  companyName: string;
  alertType: "financial" | "operational" | "reporting" | "osint" | "workflow";
  severity: "critical" | "medium" | "low";
  explanation: string;
  triggeredAt: string;
  resolvedAt?: string;
}

export interface PortfolioHealthRecord {
  companyId: string;
  companyName: string;
  portfolioScore: number;
  riskLevel: "low" | "medium" | "high";
  activeAlerts: number;
  trendSummary: string;
  updatedAt: string;
}

export interface DbPayload {
  metrics: PortfolioMetricRecord[];
  alerts: PortfolioAlertRecord[];
  healths: PortfolioHealthRecord[];
  summaryBriefing?: string;
}

const CACHE_DIR = path.resolve(process.cwd(), "scratch");
const CACHE_FILE = path.resolve(CACHE_DIR, "portfolio_db.json");

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch (err) {
    console.warn("[Portfolio DB] Failed to create local cache directory:", err);
  }
}

// Helper: Read JSON DB
export function readPortfolioDb(): DbPayload {
  if (!fs.existsSync(CACHE_FILE)) {
    return { metrics: [], alerts: [], healths: [] };
  }
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(raw) as DbPayload;
  } catch (err) {
    console.error("[Portfolio DB] Failed to parse local JSON:", err);
    return { metrics: [], alerts: [], healths: [] };
  }
}

// Helper: Write JSON DB
export function writePortfolioDb(data: DbPayload) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[Portfolio DB] Failed to write local JSON:", err);
  }
}

// ─── In-Memory Fallback State indicator ───────────────────────────────────────
let isAirtableAvailable = true;

// ─── Metrics API ──────────────────────────────────────────────────────────────

export async function getPortfolioMetrics(): Promise<PortfolioMetricRecord[]> {
  try {
    // Try Airtable
    const res = await airtableFetch(TABLES.PORTFOLIO_METRICS || "Portfolio_Metrics", { maxRecords: 1000 });
    isAirtableAvailable = true;
    return res.records.map((r: any) => ({
      companyId: r.fields.Company_Id,
      companyName: r.fields.Company_Name || "PortCo",
      reportingPeriod: r.fields.Reporting_Period,
      revenue: Number(r.fields.Revenue) || 0,
      ebitda: Number(r.fields.EBITDA) || 0,
      dscr: Number(r.fields.DSCR) || 0,
      leverage: Number(r.fields.Leverage) || 0,
      headcount: Number(r.fields.Headcount) || 0,
      churnRate: r.fields.Churn_Rate !== undefined ? Number(r.fields.Churn_Rate) : undefined,
      recurringRevenue: r.fields.Recurring_Revenue !== undefined ? Number(r.fields.Recurring_Revenue) : undefined,
    }));
  } catch (err: any) {
    if (isAirtableAvailable) {
      console.warn("[Portfolio DB] Portfolio_Metrics table not found in Airtable, falling back to JSON cache.", err.message);
      isAirtableAvailable = false;
    }
    return readPortfolioDb().metrics;
  }
}

export async function savePortfolioMetrics(records: PortfolioMetricRecord[]): Promise<boolean> {
  try {
    const table = TABLES.PORTFOLIO_METRICS || "Portfolio_Metrics";
    // For simplicity, we rewrite or append in local file.
    // In Airtable, we try to create records.
    for (const rec of records) {
      await airtableCreate(table, {
        Company_Id: rec.companyId,
        Company_Name: rec.companyName,
        Reporting_Period: rec.reportingPeriod,
        Revenue: rec.revenue,
        EBITDA: rec.ebitda,
        DSCR: rec.dscr,
        Leverage: rec.leverage,
        Headcount: rec.headcount,
        Churn_Rate: rec.churnRate,
        Recurring_Revenue: rec.recurringRevenue,
      });
    }
    return true;
  } catch (err: any) {
    // Write locally
    const db = readPortfolioDb();
    // Filter out matches to prevent duplicates
    db.metrics = db.metrics.filter(
      (m) => !(records.some((r) => r.companyId === m.companyId && r.reportingPeriod === m.reportingPeriod))
    );
    db.metrics.push(...records);
    writePortfolioDb(db);
    return false;
  }
}

// ─── Alerts API ───────────────────────────────────────────────────────────────

export async function getPortfolioAlerts(): Promise<PortfolioAlertRecord[]> {
  try {
    const res = await airtableFetch(TABLES.PORTFOLIO_ALERTS || "Portfolio_Alerts", { maxRecords: 1000 });
    return res.records.map((r: any) => ({
      id: r.id,
      companyId: r.fields.Company_Id,
      companyName: r.fields.Company_Name || "PortCo",
      alertType: r.fields.Alert_Type,
      severity: r.fields.Severity,
      explanation: r.fields.Explanation,
      triggeredAt: r.fields.Triggered_At,
      resolvedAt: r.fields.Resolved_At,
    }));
  } catch (err: any) {
    return readPortfolioDb().alerts;
  }
}

export async function savePortfolioAlerts(alerts: PortfolioAlertRecord[]): Promise<boolean> {
  try {
    const table = TABLES.PORTFOLIO_ALERTS || "Portfolio_Alerts";
    // Create new active alerts
    for (const alert of alerts) {
      await airtableCreate(table, {
        Company_Id: alert.companyId,
        Company_Name: alert.companyName,
        Alert_Type: alert.alertType,
        Severity: alert.severity,
        Explanation: alert.explanation,
        Triggered_At: alert.triggeredAt,
        Resolved_At: alert.resolvedAt,
      });
    }
    return true;
  } catch (err) {
    const db = readPortfolioDb();
    // Re-write alerts
    db.alerts = alerts;
    writePortfolioDb(db);
    return false;
  }
}

// ─── Health API ───────────────────────────────────────────────────────────────

export async function getPortfolioHealth(): Promise<PortfolioHealthRecord[]> {
  try {
    const res = await airtableFetch(TABLES.PORTFOLIO_HEALTH || "Portfolio_Health", { maxRecords: 1000 });
    return res.records.map((r: any) => ({
      companyId: r.fields.Company_Id,
      companyName: r.fields.Company_Name || "PortCo",
      portfolioScore: Number(r.fields.Portfolio_Score) || 0,
      riskLevel: r.fields.Risk_Level,
      activeAlerts: Number(r.fields.Active_Alerts) || 0,
      trendSummary: r.fields.Trend_Summary,
      updatedAt: r.fields.Updated_At,
    }));
  } catch (err) {
    return readPortfolioDb().healths;
  }
}

export async function savePortfolioHealth(healths: PortfolioHealthRecord[]): Promise<boolean> {
  try {
    const table = TABLES.PORTFOLIO_HEALTH || "Portfolio_Health";
    for (const h of healths) {
      await airtableCreate(table, {
        Company_Id: h.companyId,
        Company_Name: h.companyName,
        Portfolio_Score: h.portfolioScore,
        Risk_Level: h.riskLevel,
        Active_Alerts: h.activeAlerts,
        Trend_Summary: h.trendSummary,
        Updated_At: h.updatedAt,
      });
    }
    return true;
  } catch (err) {
    const db = readPortfolioDb();
    db.healths = healths;
    writePortfolioDb(db);
    return false;
  }
}

export function getPortfolioSummaryBriefing(): string {
  try {
    const db = readPortfolioDb();
    return db.summaryBriefing || "";
  } catch {
    return "";
  }
}

export function savePortfolioSummaryBriefing(briefing: string): void {
  try {
    const db = readPortfolioDb();
    db.summaryBriefing = briefing;
    writePortfolioDb(db);
  } catch (err) {
    console.error("[Portfolio DB] Failed to save summary briefing:", err);
  }
}


// ─── Seed Helper: Generate 6 Months History ───────────────────────────────────

export function generateHistoricalMetricsSeed(companyId: string, companyName: string): PortfolioMetricRecord[] {
  const isClearWater = companyName.toLowerCase().includes("clear water");
  
  if (isClearWater) {
    // Simulates a deterioration in months 5 and 6
    return [
      {
        companyId,
        companyName,
        reportingPeriod: "2025-12",
        revenue: 140000,
        ebitda: 15000,
        dscr: 1.45,
        leverage: 2.5,
        headcount: 14,
        churnRate: 1.2,
        recurringRevenue: 110000,
      },
      {
        companyId,
        companyName,
        reportingPeriod: "2026-01",
        revenue: 142000,
        ebitda: 16000,
        dscr: 1.44,
        leverage: 2.4,
        headcount: 14,
        churnRate: 1.1,
        recurringRevenue: 112000,
      },
      {
        companyId,
        companyName,
        reportingPeriod: "2026-02",
        revenue: 145000,
        ebitda: 17000,
        dscr: 1.43,
        leverage: 2.4,
        headcount: 14,
        churnRate: 1.1,
        recurringRevenue: 115000,
      },
      {
        companyId,
        companyName,
        reportingPeriod: "2026-03",
        revenue: 148000,
        ebitda: 16000,
        dscr: 1.41,
        leverage: 2.4,
        headcount: 14,
        churnRate: 1.3,
        recurringRevenue: 118000,
      },
      {
        companyId,
        companyName,
        reportingPeriod: "2026-04",
        revenue: 132000, // decline!
        ebitda: 13000, // decline!
        dscr: 1.25, // decline!
        leverage: 2.9, // leverage growth!
        headcount: 12, // headcount contraction!
        churnRate: 2.4, // churn increase!
        recurringRevenue: 105000,
      },
      {
        companyId,
        companyName,
        reportingPeriod: "2026-05", // current month (deteriorated state)
        revenue: 120000, // decline >15% QoQ from 148000!
        ebitda: 10500, // decline!
        dscr: 1.15, // DSCR stressed < 1.2x!
        leverage: 3.6, // leverage warning!
        headcount: 11, // headcount contraction >15% QoQ (14 to 11)!
        churnRate: 3.2, // churn >3% alert!
        recurringRevenue: 95000,
      },
    ];
  } else {
    // Normal stable/growing PortCo
    return [
      {
        companyId,
        companyName,
        reportingPeriod: "2025-12",
        revenue: 235000,
        ebitda: 28000,
        dscr: 1.42,
        leverage: 2.2,
        headcount: 20,
        churnRate: 1.5,
        recurringRevenue: 180000,
      },
      {
        companyId,
        companyName,
        reportingPeriod: "2026-01",
        revenue: 238000,
        ebitda: 29000,
        dscr: 1.43,
        leverage: 2.2,
        headcount: 20,
        churnRate: 1.4,
        recurringRevenue: 182000,
      },
      {
        companyId,
        companyName,
        reportingPeriod: "2026-02",
        revenue: 242000,
        ebitda: 30000,
        dscr: 1.45,
        leverage: 2.1,
        headcount: 21,
        churnRate: 1.3,
        recurringRevenue: 185000,
      },
      {
        companyId,
        companyName,
        reportingPeriod: "2026-03",
        revenue: 245000,
        ebitda: 31000,
        dscr: 1.46,
        leverage: 2.1,
        headcount: 21,
        churnRate: 1.2,
        recurringRevenue: 188050,
      },
      {
        companyId,
        companyName,
        reportingPeriod: "2026-04",
        revenue: 248000,
        ebitda: 32500,
        dscr: 1.47,
        leverage: 2.0,
        headcount: 22,
        churnRate: 1.2,
        recurringRevenue: 191000,
      },
      {
        companyId,
        companyName,
        reportingPeriod: "2026-05", // current month
        revenue: 252000,
        ebitda: 33500,
        dscr: 1.49,
        leverage: 1.9,
        headcount: 22,
        churnRate: 1.1,
        recurringRevenue: 195000,
      },
    ];
  }
}
