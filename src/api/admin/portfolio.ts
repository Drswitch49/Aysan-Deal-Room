/** Admin client — Portfolio companies, metrics, alerts, health. */
import { api, type Paginated } from "../http";
import { type Row, mapKeys } from "./_shared";

export async function fetchPortfolioData(): Promise<Row> {
  const s = await api.get<Row>("/api/portfolio/summary");
  const metrics = (s.metrics ?? []).map((m: Row) => ({
    id: m.id,
    companyId: m.company_id ?? m.legacy_company_id ?? "",
    companyName: m.company_name ?? "",
    reportingPeriod: m.reporting_period ?? "",
    revenue: m.revenue ?? 0,
    ebitda: m.ebitda ?? 0,
    dscr: m.dscr ?? 0,
    leverage: m.leverage ?? 0,
    headcount: m.headcount ?? 0,
    churnRate: m.churn_rate ?? 0,
    recurringRevenue: m.recurring_revenue ?? 0,
  }));
  const alerts = (s.alerts ?? []).map((a: Row) => ({
    id: a.id,
    companyId: a.company_id ?? a.legacy_company_id ?? "",
    companyName: a.company_name ?? "",
    alertType: a.alert_type ?? "",
    severity: a.severity ?? "info",
    explanation: a.explanation ?? "",
    triggeredAt: a.triggered_at ?? "",
    resolvedAt: a.resolved_at ?? null,
  }));
  const healths = (s.healths ?? []).map((h: Row) => ({
    id: h.id,
    companyId: h.company_id ?? h.legacy_company_id ?? "",
    companyName: h.company_name ?? "",
    portfolioScore: h.portfolio_score ?? 0,
    riskLevel: h.risk_level ?? "",
    activeAlerts: h.active_alerts ?? 0,
    trendSummary: h.trend_summary ?? "",
    updatedAt: h.updated_at ?? "",
  }));
  const healthIndex = healths.length
    ? Math.round(healths.reduce((sum: number, h: Row) => sum + (h.portfolioScore ?? 0), 0) / healths.length)
    : 100;
  return {
    success: true,
    metrics,
    alerts,
    healths,
    companies: s.companies ?? [],
    summaryBriefing: "",
    healthIndex,
    isFallbackActive: false,
  };
}

export async function triggerPortfolioAnalysis() {
  const job = await api.post<Row>("/api/ai/jobs", { type: "portfolio-briefing", payload: {} });
  return { success: true, jobId: job.job_id };
}

export interface PortfolioCompanyPayload {
  companyName: string;
  industry?: string;
  location?: string;
  revenue?: number;
  ebitda?: number;
  debt?: number;
  headcount?: number;
  status?: string;
  notes?: string;
}

export async function createPortfolioCompany(data: PortfolioCompanyPayload) {
  return api.post<Row>("/api/portfolio-companies", {
    company_name: data.companyName,
    industry: data.industry,
    location: data.location,
    revenue: data.revenue,
    ebitda: data.ebitda,
    debt: data.debt,
    headcount: data.headcount,
    status: (data.status ?? "active").toLowerCase(),
    notes: data.notes,
  });
}

export async function updatePortfolioCompany(companyId: string, fields: Row) {
  const map: Record<string, string> = {
    Company_Name: "company_name", Industry: "industry", Location: "location", Revenue: "revenue",
    EBITDA: "ebitda", Debt: "debt", Headcount: "headcount", Status: "status", Notes: "notes",
  };
  return api.patch<Row>(`/api/portfolio-companies/${encodeURIComponent(companyId)}`, mapKeys(fields, map));
}

export async function archivePortfolioCompany(companyId: string) {
  return api.patch<Row>(`/api/portfolio-companies/${encodeURIComponent(companyId)}`, { status: "archived" });
}

export async function fetchPortfolioCompanies() {
  const page = await api.get<Paginated<Row>>("/api/portfolio-companies?limit=200");
  return page.rows;
}
