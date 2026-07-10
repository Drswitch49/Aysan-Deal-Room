import { airtableFetchAll, airtableCreate, airtableUpdate, airtableFetchRecord, airtableDelete } from "./airtable/client.js";
import { ensureTable } from "./airtable/schema-manager.js";
import { TABLES } from "./airtable/schema.js";
import type { Deal, CreateDealInput, PortfolioCompany, CreatePortfolioCompanyInput } from "../types/entities.js";

/**
 * Create a deal
 */
export async function createDeal(input: CreateDealInput): Promise<Deal> {
  await ensureTable("Deals");

  // Generate deal reference (e.g., ACP-2026-001)
  const year = new Date().getFullYear();
  const dealRef = `ACP-${year}-${Math.random().toString().slice(2, 5).padStart(3, "0")}`;

  const record = await airtableCreate("Deals", {
    Deal_Ref: dealRef,
    Company_Name: input.companyName,
    Project_Name: input.projectName,
    Industry: input.industry,
    Website: input.website,
    Location: input.location,
    Owner: input.owner,
    Analyst: input.analyst,
    Source: input.source,
    Revenue: input.revenue,
    EBITDA: input.ebitda,
    Enterprise_Value: input.enterpriseValue,
    Asking_Price: input.askingPrice,
    Stage: input.stage || "Inbound",
    Next_Action: input.nextAction,
    Due_Date: input.dueDate,
    Internal_Notes: input.internalNotes,
    IM_Review_Documents: input.imDocumentUrl ? [{ url: input.imDocumentUrl }] : undefined,
    Attachments: input.financialPackUrl ? [{ url: input.financialPackUrl }] : undefined
  });

  return mapAirtableDealToEntity(record);
}

/**
 * Get a deal by ID
 */
export async function getDeal(dealId: string): Promise<Deal | null> {
  const record = await airtableFetchRecord("Deals", dealId);
  if (!record) return null;
  return mapAirtableDealToEntity(record);
}

/**
 * Update a deal
 */
export async function updateDeal(dealId: string, updates: Partial<CreateDealInput>): Promise<Deal> {
  const fields: Record<string, any> = {};

  if (updates.companyName) fields.Company_Name = updates.companyName;
  if (updates.projectName) fields.Project_Name = updates.projectName;
  if (updates.industry) fields.Industry = updates.industry;
  if (updates.website) fields.Website = updates.website;
  if (updates.location) fields.Location = updates.location;
  if (updates.owner) fields.Owner = updates.owner;
  if (updates.analyst) fields.Analyst = updates.analyst;
  if (updates.source) fields.Source = updates.source;
  if (updates.revenue !== undefined) fields.Revenue = updates.revenue;
  if (updates.ebitda !== undefined) fields.EBITDA = updates.ebitda;
  if (updates.enterpriseValue !== undefined) fields.Enterprise_Value = updates.enterpriseValue;
  if (updates.askingPrice !== undefined) fields.Asking_Price = updates.askingPrice;
  if (updates.stage) fields.Stage = updates.stage;
  if (updates.nextAction) fields.Next_Action = updates.nextAction;
  if (updates.dueDate) fields.Due_Date = updates.dueDate;
  if (updates.internalNotes) fields.Internal_Notes = updates.internalNotes;
  if (updates.imDocumentUrl !== undefined) {
    fields.IM_Review_Documents = updates.imDocumentUrl ? [{ url: updates.imDocumentUrl }] : [];
  }
  if (updates.financialPackUrl !== undefined) {
    fields.Attachments = updates.financialPackUrl ? [{ url: updates.financialPackUrl }] : [];
  }

  // If the stage is updated to Killed, migrate this deal to the Inbox and delete it from all pipeline tables
  if (updates.stage && String(updates.stage).toLowerCase() === "killed") {
    // 1. Fetch current deal to map remaining fields
    const dealRecord = await airtableFetchRecord("Deals", dealId).catch(() => null);
    const f = dealRecord ? (dealRecord.fields as Record<string, any>) : {};

    const inboxFields: Record<string, any> = {
      "REF. NO": f.Deal_Ref || f["ACP REF NO"] || "",
      "Deal Name": updates.companyName || f.Company_Name || "Unknown Deal",
      "Company Name": updates.companyName || f.Company_Name || "",
      "Sector": updates.industry || f.Industry || "",
      "Location": updates.location || f.Location || "",
      "BROKER": f.Broker_Name || f.Broker || "",
      "Status": "Kill",
      "Summary": updates.internalNotes || f.Internal_Notes || "",
      "Description": updates.internalNotes || f.Internal_Notes || "",
      "EBITDA_GBP": updates.ebitda !== undefined ? updates.ebitda : f.EBITDA,
      "Turnover": updates.revenue !== undefined ? updates.revenue : f.Revenue,
      "Asking_Price_GBP": updates.askingPrice !== undefined ? updates.askingPrice : f.Asking_Price,
      "Enterprise_Value": updates.enterpriseValue !== undefined ? updates.enterpriseValue : f.Enterprise_Value,
      "Contact_Name": f.Broker_Name || "",
      "Contact_Email": f.Contact_Email || "",
      "Contact_Phone": f.Contact_Phone || "",
      "Source": updates.source || f.Source || "Active Pipeline",
    };

    if (f.IM_Review_Documents) inboxFields["IM_Review_Documents"] = f.IM_Review_Documents;
    if (f.Attachments) inboxFields["Attachments"] = f.Attachments;

    // 2. Create in Deal_Inbox
    await airtableCreate(TABLES.DEAL_INBOX || "Deal_Inbox", inboxFields);

    // 3. Delete from Deals
    await airtableDelete("Deals", dealId);

    // 4. Delete from Active_Pipeline (just in case)
    try {
      await airtableDelete(TABLES.PIPELINE || "Active_Pipeline", dealId);
    } catch {}

    // Return a dummy deal entity mapping to avoid breaks
    return {
      id: dealId,
      dealRef: f.Deal_Ref || "",
      companyName: updates.companyName || f.Company_Name || "",
      projectName: updates.projectName || f.Project_Name || "",
      industry: updates.industry || f.Industry || "",
      website: updates.website || f.Website || "",
      location: updates.location || f.Location || "",
      owner: updates.owner || f.Owner || "",
      analyst: updates.analyst || f.Analyst || "",
      source: updates.source || f.Source || "",
      revenue: updates.revenue !== undefined ? updates.revenue : (f.Revenue || 0),
      ebitda: updates.ebitda !== undefined ? updates.ebitda : (f.EBITDA || 0),
      enterpriseValue: updates.enterpriseValue !== undefined ? updates.enterpriseValue : (f.Enterprise_Value || 0),
      askingPrice: updates.askingPrice !== undefined ? updates.askingPrice : (f.Asking_Price || 0),
      stage: "Killed",
      nextAction: updates.nextAction || f.Next_Action || "",
      dueDate: updates.dueDate || f.Due_Date || "",
      internalNotes: updates.internalNotes || f.Internal_Notes || "",
      createdAt: "",
      updatedAt: ""
    };
  }

  const record = await airtableUpdate("Deals", dealId, fields);
  return mapAirtableDealToEntity(record);
}

/**
 * Get all deals
 */
export async function getAllDeals(): Promise<Deal[]> {
  const result = await airtableFetchAll("Deals");
  return result.records.map(mapAirtableDealToEntity);
}

/**
 * Get deals by stage
 */
export async function getDealsByStage(stage: string): Promise<Deal[]> {
  const result = await airtableFetchAll("Deals", {
    filterByFormula: `{Stage} = "${stage}"`
  });
  return result.records.map(mapAirtableDealToEntity);
}

/**
 * Map Airtable record to Deal entity
 */
function mapAirtableDealToEntity(record: any): Deal {
  return {
    id: record.id,
    dealRef: record.fields.Deal_Ref || "",
    companyName: record.fields.Company_Name || "",
    projectName: record.fields.Project_Name || "",
    industry: record.fields.Industry || "",
    website: record.fields.Website,
    location: record.fields.Location || "",
    owner: record.fields.Owner || "",
    analyst: record.fields.Analyst || "",
    source: record.fields.Source || "",
    revenue: record.fields.Revenue,
    ebitda: record.fields.EBITDA,
    enterpriseValue: record.fields.Enterprise_Value,
    askingPrice: record.fields.Asking_Price,
    stage: record.fields.Stage || "Inbound",
    nextAction: record.fields.Next_Action,
    dueDate: record.fields.Due_Date,
    internalNotes: record.fields.Internal_Notes,
    imReviewDocuments: record.fields.IM_Review_Documents,
    attachments: record.fields.Attachments,
    imDocumentUrl: record.fields.IM_Review_Documents?.[0]?.url || "",
    financialPackUrl: record.fields.Attachments?.[0]?.url || "",
    createdAt: record.createdTime,
    updatedAt: record.createdTime // Airtable doesn't expose updatedTime directly
  };
}

/**
 * Create a portfolio company
 */
export async function createPortfolioCompany(
  input: CreatePortfolioCompanyInput
): Promise<PortfolioCompany> {
  await ensureTable("Portfolio_Companies");

  const record = await airtableCreate("Portfolio_Companies", {
    Company_Name: input.companyName,
    Industry: input.industry,
    Revenue: input.revenue,
    EBITDA: input.ebitda,
    Debt: input.debt,
    Headcount: input.headcount,
    Status: input.status,
    Location: input.location,
    Notes: input.notes
  });

  return mapAirtablePortfolioCompanyToEntity(record);
}

/**
 * Get a portfolio company by ID
 */
export async function getPortfolioCompany(companyId: string): Promise<PortfolioCompany | null> {
  const record = await airtableFetchRecord("Portfolio_Companies", companyId);
  if (!record) return null;
  return mapAirtablePortfolioCompanyToEntity(record);
}

/**
 * Update a portfolio company
 */
export async function updatePortfolioCompany(
  companyId: string,
  updates: Partial<CreatePortfolioCompanyInput>
): Promise<PortfolioCompany> {
  const fields: Record<string, any> = {};

  if (updates.companyName) fields.Company_Name = updates.companyName;
  if (updates.industry) fields.Industry = updates.industry;
  if (updates.revenue !== undefined) fields.Revenue = updates.revenue;
  if (updates.ebitda !== undefined) fields.EBITDA = updates.ebitda;
  if (updates.debt !== undefined) fields.Debt = updates.debt;
  if (updates.headcount !== undefined) fields.Headcount = updates.headcount;
  if (updates.status) fields.Status = updates.status;
  if (updates.location) fields.Location = updates.location;
  if (updates.notes) fields.Notes = updates.notes;

  const record = await airtableUpdate("Portfolio_Companies", companyId, fields);
  return mapAirtablePortfolioCompanyToEntity(record);
}

/**
 * Get all portfolio companies
 */
export async function getAllPortfolioCompanies(): Promise<PortfolioCompany[]> {
  const result = await airtableFetchAll("Portfolio_Companies");
  return result.records.map(mapAirtablePortfolioCompanyToEntity);
}

/**
 * Get active portfolio companies
 */
export async function getActivePortfolioCompanies(): Promise<PortfolioCompany[]> {
  const result = await airtableFetchAll("Portfolio_Companies", {
    filterByFormula: `{Status} = "Active"`
  });
  return result.records.map(mapAirtablePortfolioCompanyToEntity);
}

/**
 * Map Airtable record to PortfolioCompany entity
 */
function mapAirtablePortfolioCompanyToEntity(record: any): PortfolioCompany {
  return {
    id: record.id,
    companyName: record.fields.Company_Name || "",
    industry: record.fields.Industry || "",
    revenue: record.fields.Revenue,
    ebitda: record.fields.EBITDA,
    debt: record.fields.Debt,
    headcount: record.fields.Headcount,
    status: record.fields.Status || "Active",
    location: record.fields.Location || "",
    notes: record.fields.Notes,
    createdAt: record.createdTime,
    updatedAt: record.createdTime
  };
}
