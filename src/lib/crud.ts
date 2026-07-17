/**
 * Deal + portfolio CRUD (Phase 6 — Supabase-backed REST).
 *
 * Previously this module called Airtable DIRECTLY from the browser (exposing
 * credentials and schema mutation to the client). It now goes through the
 * authenticated REST API. "Killing" a deal is a lifecycle transition on the
 * same row (stage → archived) — no cross-table copy/delete dance.
 */
import { api, type Paginated } from "../api/http";
import type { Deal, CreateDealInput, PortfolioCompany, CreatePortfolioCompanyInput } from "../types/entities.js";

type Row = Record<string, any>;

function mapDealEntity(d: Row): Deal {
  return {
    id: d.id,
    dealRef: d.acp_ref_no || d.ref_no || "",
    companyName: d.company_name || d.deal_name || "",
    projectName: d.project_name || "",
    industry: d.industry || d.sector || "",
    website: d.website ?? undefined,
    location: d.location || "",
    owner: d.owner || "",
    analyst: d.analyst || "",
    source: d.source || "",
    revenue: d.turnover ?? undefined,
    ebitda: d.ebitda_gbp ?? undefined,
    enterpriseValue: d.enterprise_value ?? undefined,
    askingPrice: d.asking_price_gbp ?? undefined,
    stage: d.pipeline_stage || d.stage || "Inbound",
    nextAction: d.next_action ?? undefined,
    dueDate: d.next_action_date ?? undefined,
    internalNotes: d.internal_notes ?? undefined,
    imDocumentUrl: d.deal_files_secure_url || "",
    financialPackUrl: "",
    createdAt: d.created_at ?? "",
    updatedAt: d.updated_at ?? d.created_at ?? "",
  } as Deal;
}

function toDealColumns(input: Partial<CreateDealInput>): Row {
  const f: Row = {};
  if (input.companyName !== undefined) f.company_name = input.companyName;
  if (input.projectName !== undefined) f.project_name = input.projectName;
  if (input.industry !== undefined) f.industry = input.industry;
  if (input.website !== undefined) f.website = input.website;
  if (input.location !== undefined) f.location = input.location;
  if (input.owner !== undefined) f.owner = input.owner;
  if (input.analyst !== undefined) f.analyst = input.analyst;
  if (input.source !== undefined) f.source = input.source;
  if (input.revenue !== undefined) f.turnover = input.revenue;
  if (input.ebitda !== undefined) f.ebitda_gbp = input.ebitda;
  if (input.enterpriseValue !== undefined) f.enterprise_value = input.enterpriseValue;
  if (input.askingPrice !== undefined) f.asking_price_gbp = input.askingPrice;
  if (input.stage !== undefined) f.pipeline_stage = input.stage;
  if (input.nextAction !== undefined) f.next_action = input.nextAction;
  if (input.dueDate !== undefined) f.next_action_date = input.dueDate;
  if (input.internalNotes !== undefined) f.internal_notes = input.internalNotes;
  return f;
}

export async function createDeal(input: CreateDealInput): Promise<Deal> {
  const row = await api.post<Row>("/api/deals", {
    deal_name: input.projectName || input.companyName,
    stage: "active",
    ...toDealColumns(input),
  });
  return mapDealEntity(row);
}

export async function getDeal(dealId: string): Promise<Deal | null> {
  const row = await api.get<Row>(`/api/deals/${encodeURIComponent(dealId)}`).catch(() => null);
  return row ? mapDealEntity(row) : null;
}

export async function updateDeal(dealId: string, updates: Partial<CreateDealInput>): Promise<Deal> {
  // Killing a deal → lifecycle transition (records stage history + audit).
  if (updates.stage && String(updates.stage).toLowerCase() === "killed") {
    const row = await api.post<Row>("/api/deal-transitions", {
      deal_id: dealId,
      to_stage: "archived",
      kill_reason: updates.internalNotes || undefined,
    });
    return mapDealEntity(row);
  }
  const row = await api.patch<Row>(`/api/deals/${encodeURIComponent(dealId)}`, toDealColumns(updates));
  return mapDealEntity(row);
}

export async function getAllDeals(): Promise<Deal[]> {
  const page = await api.get<Paginated<Row>>("/api/deals?stage=active&limit=200");
  return page.rows.map(mapDealEntity);
}

export async function getDealsByStage(stage: string): Promise<Deal[]> {
  const all = await getAllDeals();
  return all.filter((d) => (d.stage || "").toLowerCase() === stage.toLowerCase());
}

// ─── Portfolio companies ────────────────────────────────────────────────────

function mapPortco(r: Row): PortfolioCompany {
  return {
    id: r.id,
    companyName: r.company_name || "",
    industry: r.industry || "",
    revenue: r.revenue ?? undefined,
    ebitda: r.ebitda ?? undefined,
    debt: r.debt ?? undefined,
    headcount: r.headcount ?? undefined,
    status: r.status || "Active",
    location: r.location || "",
    notes: r.notes ?? undefined,
    createdAt: r.created_at ?? "",
    updatedAt: r.updated_at ?? r.created_at ?? "",
  } as PortfolioCompany;
}

function toPortcoColumns(input: Partial<CreatePortfolioCompanyInput>): Row {
  const f: Row = {};
  if (input.companyName !== undefined) f.company_name = input.companyName;
  if (input.industry !== undefined) f.industry = input.industry;
  if (input.revenue !== undefined) f.revenue = input.revenue;
  if (input.ebitda !== undefined) f.ebitda = input.ebitda;
  if (input.debt !== undefined) f.debt = input.debt;
  if (input.headcount !== undefined) f.headcount = input.headcount;
  if (input.status !== undefined) f.status = input.status;
  if (input.location !== undefined) f.location = input.location;
  if (input.notes !== undefined) f.notes = input.notes;
  return f;
}

export async function createPortfolioCompany(input: CreatePortfolioCompanyInput): Promise<PortfolioCompany> {
  const row = await api.post<Row>("/api/portfolio-companies", toPortcoColumns(input));
  return mapPortco(row);
}

export async function getPortfolioCompany(companyId: string): Promise<PortfolioCompany | null> {
  const row = await api.get<Row>(`/api/portfolio-companies/${encodeURIComponent(companyId)}`).catch(() => null);
  return row ? mapPortco(row) : null;
}

export async function updatePortfolioCompany(
  companyId: string,
  updates: Partial<CreatePortfolioCompanyInput>,
): Promise<PortfolioCompany> {
  const row = await api.patch<Row>(`/api/portfolio-companies/${encodeURIComponent(companyId)}`, toPortcoColumns(updates));
  return mapPortco(row);
}

export async function getAllPortfolioCompanies(): Promise<PortfolioCompany[]> {
  const page = await api.get<Paginated<Row>>("/api/portfolio-companies?limit=200");
  return page.rows.map(mapPortco);
}

export async function getActivePortfolioCompanies(): Promise<PortfolioCompany[]> {
  const all = await getAllPortfolioCompanies();
  return all.filter((c) => (c.status || "").toLowerCase() === "active");
}
