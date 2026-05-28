import { config, getMissingRequiredConfig } from "../config/env";
import type { AirtableListResponse, RawAirtableFields } from "../types/airtable";
import type { DealDocument, PipelineDeal, SubmissionLogEntry } from "../types/deal";
import { asBoolean, asText, asUrl, firstField } from "../utils/fields";

const AIRTABLE_API_ROOT = "https://api.airtable.com/v0";
const MAX_RETRIES = 2;

type QueryParams = {
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  fields?: string[];
};

class AirtableConfigError extends Error {
  constructor(missing: string[]) {
    super(`Missing Airtable configuration: ${missing.join(", ")}`);
    this.name = "AirtableConfigError";
  }
}

class AirtableRequestError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`Airtable request failed (${status}): ${detail}`);
    this.name = "AirtableRequestError";
    this.status = status;
    this.detail = detail;
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function assertAirtableConfig(): void {
  const missing = getMissingRequiredConfig();
  if (missing.length > 0) {
    throw new AirtableConfigError(missing);
  }
}

function buildTableUrl(tableName: string, params: QueryParams = {}, offset?: string): string {
  const url = new URL(`${AIRTABLE_API_ROOT}/${config.airtableBaseId}/${encodeURIComponent(tableName)}`);

  if (params.filterByFormula) {
    url.searchParams.set("filterByFormula", params.filterByFormula);
  }

  params.sort?.forEach((sortItem, index) => {
    url.searchParams.set(`sort[${index}][field]`, sortItem.field);
    url.searchParams.set(`sort[${index}][direction]`, sortItem.direction);
  });

  params.fields?.forEach((field, index) => {
    url.searchParams.set(`fields[${index}]`, field);
  });

  if (offset) {
    url.searchParams.set("offset", offset);
  }

  return url.toString();
}

async function airtableFetch<TFields extends RawAirtableFields>(
  tableName: string,
  params: QueryParams = {},
): Promise<AirtableListResponse<TFields>> {
  assertAirtableConfig();

  const allRecords: AirtableListResponse<TFields>["records"] = [];
  let offset: string | undefined;

  do {
    const page = await fetchAirtablePage<TFields>(buildTableUrl(tableName, params, offset));
    allRecords.push(...page.records);
    offset = page.offset;
  } while (offset);

  return { records: allRecords };
}

async function fetchAirtablePage<TFields extends RawAirtableFields>(
  url: string,
  attempt = 0,
): Promise<AirtableListResponse<TFields>> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.airtableApiKey}`,
    },
  });

  if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
    await delay(500 * (attempt + 1));
    return fetchAirtablePage<TFields>(url, attempt + 1);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new AirtableRequestError(response.status, detail || response.statusText);
  }

  return response.json() as Promise<AirtableListResponse<TFields>>;
}

export async function getDeals(): Promise<PipelineDeal[]> {
  const response = await airtableFetch<RawAirtableFields>(config.pipelineTable);
  return response.records.map((record) => mapPipelineDeal(record.id, record.fields));
}

export async function getDealByRef(ref: string): Promise<PipelineDeal | null> {
  const deals = await getDeals();
  return deals.find((deal) => deal.dealRef.toLowerCase() === ref.toLowerCase()) ?? null;
}

export async function getAllDocuments(): Promise<DealDocument[]> {
  try {
    const response = await airtableFetch<RawAirtableFields>(config.documentsTable);
    return response.records.map((record) => mapDocument(record.id, record.fields));
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

export async function getDocumentsForDeal(ref: string): Promise<DealDocument[]> {
  try {
    const deal = await getDealByRef(ref);
    if (!deal) return [];
    const allDocs = await getAllDocuments();
    return allDocs.filter((doc) => doc.dealRef.toLowerCase() === deal.id.toLowerCase());
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

export async function getAllSubmissionLog(): Promise<SubmissionLogEntry[]> {
  try {
    const response = await airtableFetch<RawAirtableFields>(config.submissionTable, {
      sort: [{ field: "Date", direction: "desc" }],
    });

    return response.records.map((record) => mapSubmissionLogEntry(record.id, record.fields));
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

export async function getSubmissionLogForDeal(ref: string): Promise<SubmissionLogEntry[]> {
  try {
    const deal = await getDealByRef(ref);
    if (!deal) return [];
    const allLogs = await getAllSubmissionLog();
    return allLogs
      .filter((entry) => entry.dealRef.toLowerCase() === deal.id.toLowerCase())
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

const SAFE_DOCUMENT_FIELDS = [
  "Deal_Ref", "Deal Ref", "Deal Reference",
  "Document_Name", "Document Name", "Name",
  "Category", "category",
  "ABL_Critical", "ABL Critical", "abl_critical", "abl critical", "Critical",
  "Status", "status", "Stage",
  "Source", "source",
  "Date_Received", "Date Received", "date_received", "date received", "Date",
  "drive link", "Drive Link", "Drive_Link", "drive_link", "Link", "link",
  "Expected_Date", "Expected Date", "expected_date", "expected date",
  "Date_Sent_To_Lender", "Date Sent To Lender", "date_sent_to_lender", "date sent to lender"
];

const SAFE_PIPELINE_FIELDS = [
  "REF No.", "Ref No.", "Deal_Ref", "Deal Ref", "Deal Reference", "Deal Name",
  "Company_Name", "Company Name", "company name", "Company",
  "Status", "Deal_Status", "Deal Status", "Stage",
  "Location", "Company Location", "HQ", "Headquarters",
  "Sector", "Industry",
  "EV", "Enterprise Value", "Enterprise_Value", "EV Multiple",
  "DSCR_Base", "DSCR Base", "DSCR base", "DSCR_Proxy", "DSCR Proxy",
  "DSCR_Stress", "DSCR Stress", "DSCR stress", "DSCR_SCORE", "DSCR Score",
  "Post_Completion_Roles", "Post-Completion Roles", "Post Completion Roles",
  "Senior_Debt", "Senior Debt", "Senior Debt Amount",
  "Sub_Debt", "Sub Debt", "Subordinated Debt",
  "Equity", "Equity Amount",
  "Seller_Note", "Seller Note"
];

let cachedSchema: any = null;

async function fetchSchema(): Promise<any> {
  if (cachedSchema) return cachedSchema;
  assertAirtableConfig();

  const response = await fetch(`${AIRTABLE_API_ROOT}/meta/bases/${config.airtableBaseId}/tables`, {
    headers: {
      Authorization: `Bearer ${config.airtableApiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch schema metadata: ${response.statusText}`);
  }

  const data = await response.json();
  cachedSchema = data;
  return data;
}

async function getExistFields(tableName: string, safeFields: string[]): Promise<string[]> {
  try {
    const schema = await fetchSchema();
    const table = schema.tables.find(
      (t: any) =>
        t.name.toLowerCase() === tableName.toLowerCase() ||
        t.name.toLowerCase().replace(/_/g, " ") === tableName.toLowerCase().replace(/_/g, " ") ||
        t.name.toLowerCase().replace(/ /g, "_") === tableName.toLowerCase().replace(/ /g, "_")
    );
    if (table) {
      const existingFieldNames = table.fields.map((f: any) => f.name);
      const matched = safeFields.filter((f) => existingFieldNames.includes(f));
      if (matched.length > 0) return matched;
    }
  } catch (metaError) {
    console.warn("Airtable Metadata API not available, falling back to record scanning:", metaError);
  }

  try {
    const response = await fetchAirtablePage<RawAirtableFields>(
      buildTableUrl(tableName) + "&maxRecords=100"
    );
    if (response.records.length === 0) {
      return safeFields.slice(0, 5);
    }
    const allKeys = new Set<string>();
    for (const record of response.records) {
      for (const key of Object.keys(record.fields)) {
        allKeys.add(key);
      }
    }
    return safeFields.filter((f) => allKeys.has(f));
  } catch {
    return safeFields.slice(0, 5);
  }
}


export async function getDealByRefForLender(ref: string): Promise<PipelineDeal | null> {
  try {
    const projectedFields = await getExistFields(config.pipelineTable, SAFE_PIPELINE_FIELDS);
    const response = await airtableFetch<RawAirtableFields>(config.pipelineTable, {
      fields: projectedFields.length > 0 ? projectedFields : undefined
    });
    const deals = response.records.map((record) => mapPipelineDeal(record.id, record.fields));
    return deals.find((deal) => deal.dealRef.toLowerCase() === ref.toLowerCase()) ?? null;
  } catch (error) {
    return getDealByRef(ref);
  }
}

export async function getDocumentsForLender(ref: string): Promise<DealDocument[]> {
  try {
    const deal = await getDealByRef(ref);
    if (!deal) return [];

    const projectedFields = await getExistFields(config.documentsTable, SAFE_DOCUMENT_FIELDS);
    const response = await airtableFetch<RawAirtableFields>(config.documentsTable, {
      fields: projectedFields.length > 0 ? projectedFields : undefined
    });

    const allDocs = response.records.map((record) => mapDocument(record.id, record.fields));
    return allDocs.filter(
      (doc) => 
        doc.dealRef.toLowerCase() === deal.id.toLowerCase() && 
        doc.status.trim().toLowerCase() === "sent to lender"
    );
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

function mapPipelineDeal(id: string, fields: RawAirtableFields): PipelineDeal {
  return {
    id,
    dealRef: asText(firstField(fields, ["Deal_Ref", "Deal Ref", "Deal Reference", "REF No.", "Ref No.", "Deal Name"])),
    companyName: asText(firstField(fields, ["Company_Name", "Company Name", "company name", "Company", "Deal Name"])),
    status: asText(firstField(fields, ["Status", "Deal_Status", "Deal Status", "Stage"])),
    location: asText(firstField(fields, ["Location", "Company Location", "HQ", "Headquarters"])),
    sector: asText(firstField(fields, ["Sector", "Industry"])),
    ev: asText(firstField(fields, ["EV", "Enterprise Value", "Enterprise_Value", "EV Multiple"])),
    dscrBase: asText(firstField(fields, ["DSCR_Base", "DSCR Base", "DSCR base", "DSCR_Proxy", "DSCR Proxy"])),
    dscrStress: asText(firstField(fields, ["DSCR_Stress", "DSCR Stress", "DSCR stress", "DSCR_SCORE", "DSCR Score"])),
    broker: asText(firstField(fields, ["Broker", "Broker_Name", "Broker Name"])),
    lenderAssigned: asText(firstField(fields, ["Lender_Assigned", "Lender Assigned", "Lender"])),
    vendorNames: asText(firstField(fields, ["Vendor_Names", "Vendor Names", "Vendor Details", "vendor details"])),
    postCompletionRoles: asText(
      firstField(fields, ["Post_Completion_Roles", "Post-Completion Roles", "Post Completion Roles"]),
    ),
    capitalStructure: buildCapitalStructure(fields),
    rawFields: fields,
  };
}

function mapDocument(id: string, fields: RawAirtableFields): DealDocument {
  return {
    id,
    dealRef: asText(firstField(fields, ["Deal_Ref", "Deal Ref", "Deal Reference"])),
    documentName: asText(firstField(fields, ["Document_Name", "Document Name", "Name"])),
    category: asText(firstField(fields, ["Category", "category"])),
    ablCritical: asBoolean(firstField(fields, ["ABL_Critical", "ABL Critical", "abl_critical", "abl critical", "Critical"])),
    status: asText(firstField(fields, ["Status", "status", "Stage"])),
    source: asText(firstField(fields, ["Source", "source"])),
    dateReceived: asText(firstField(fields, ["Date_Received", "Date Received", "date_received", "date received", "Date"])),
    driveLink: asUrl(firstField(fields, ["drive link", "Drive Link", "Drive_Link", "drive_link", "Link", "link"])),
    expectedDate: asText(firstField(fields, ["Expected_Date", "Expected Date", "expected_date", "expected date"])),
    internalNotes: asText(firstField(fields, ["Internal_Notes", "Internal Notes", "Notes", "notes"])),
    dateSentToLender: asText(firstField(fields, ["Date_Sent_To_Lender", "Date Sent To Lender", "date_sent_to_lender", "date sent to lender"])),
    lenderTarget: asText(firstField(fields, ["Lender_Target", "Lender Target", "lender_target", "lender target"])),
  };
}

function mapSubmissionLogEntry(id: string, fields: RawAirtableFields): SubmissionLogEntry {
  return {
    id,
    dealRef: asText(firstField(fields, ["Deal_Ref", "Deal Ref", "Deal Reference"])),
    date: asText(firstField(fields, ["Date", "date"])),
    whatWasSent: asText(firstField(fields, ["What_Was_Sent", "What Was Sent", "what was sent"])),
    sentTo: asText(firstField(fields, ["Sent_To", "Sent To", "sent to"])),
    sentVia: asText(firstField(fields, ["Sent_Via", "Sent Via", "sent via"])),
    responseReceived: asText(firstField(fields, ["Response_Received", "Response Received", "response received"])),
    flag: asText(firstField(fields, ["Flag", "flag"])),
  };
}

function buildCapitalStructure(fields: RawAirtableFields) {
  const rows = [
    {
      label: "Senior Debt",
      provider: asText(firstField(fields, ["Senior_Debt_Provider", "Senior Debt Provider", "Senior Lender"])),
      amount: asText(firstField(fields, ["Senior_Debt", "Senior Debt", "Senior Debt Amount"])),
      notes: asText(firstField(fields, ["Senior_Debt_Notes", "Senior Debt Notes"])),
    },
    {
      label: "Subordinated Debt",
      provider: asText(firstField(fields, ["Sub_Debt_Provider", "Sub Debt Provider", "Subordinated Debt Provider"])),
      amount: asText(firstField(fields, ["Sub_Debt", "Sub Debt", "Subordinated Debt"])),
      notes: asText(firstField(fields, ["Sub_Debt_Notes", "Sub Debt Notes"])),
    },
    {
      label: "Equity",
      provider: asText(firstField(fields, ["Equity_Provider", "Equity Provider"])),
      amount: asText(firstField(fields, ["Equity", "Equity Amount"])),
      notes: asText(firstField(fields, ["Equity_Notes", "Equity Notes"])),
    },
    {
      label: "Seller Note",
      provider: asText(firstField(fields, ["Seller_Note_Provider", "Seller Note Provider"])),
      amount: asText(firstField(fields, ["Seller_Note", "Seller Note"])),
      notes: asText(firstField(fields, ["Seller_Note_Notes", "Seller Note Notes"])),
    },
  ];

  return rows.filter((row) => row.provider || row.amount || row.notes);
}

function escapeFormulaString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isMissingTableError(error: unknown): boolean {
  if (!(error instanceof AirtableRequestError)) return false;
  const detail = error.detail.toLowerCase();
  return (
    error.status === 404 ||
    detail.includes("table_not_found") ||
    detail.includes("could not find table") ||
    detail.includes("model was not found") ||
    detail.includes("requested model was not found")
  );
}
