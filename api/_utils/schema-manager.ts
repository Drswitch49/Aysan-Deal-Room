/**
 * Schema Manager — Automatically validates and creates missing Airtable tables and fields.
 * Uses the Airtable Metadata API to introspect and mutate the base schema.
 */

const AIRTABLE_API_ROOT = "https://api.airtable.com/v0";
const apiKey = process.env.VITE_AIRTABLE_API_KEY || process.env.AIRTABLE_API_KEY;
const baseId = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID;

// ─── Type Definitions ────────────────────────────────────────────────────────

interface FieldSpec {
  name: string;
  type: string;
  options?: Record<string, any>;
}

interface TableSpec {
  name: string;
  fields: FieldSpec[];
}

interface SchemaChangeLog {
  action: "SCHEMA_TABLE_CREATED" | "SCHEMA_FIELD_CREATED";
  target: string;
  details: string;
  timestamp: string;
}

// ─── In-Memory Schema Cache ──────────────────────────────────────────────────

let _schemaCache: any = null;
let _schemaCacheTime = 0;
const SCHEMA_CACHE_TTL = 120_000; // 2 minutes

async function fetchBaseSchema(forceRefresh = false): Promise<any> {
  if (!forceRefresh && _schemaCache && Date.now() - _schemaCacheTime < SCHEMA_CACHE_TTL) {
    return _schemaCache;
  }

  if (!apiKey || !baseId) {
    throw new Error("Missing Airtable configuration for schema manager.");
  }

  const res = await fetch(`${AIRTABLE_API_ROOT}/meta/bases/${baseId}/tables`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn(`[Schema Manager] Failed to fetch base schema: ${res.status} ${text}`);
    throw new Error(`Schema API returned ${res.status}`);
  }

  _schemaCache = await res.json();
  _schemaCacheTime = Date.now();
  return _schemaCache;
}

function invalidateSchemaCache() {
  _schemaCache = null;
  _schemaCacheTime = 0;
}

// ─── Table Creation ──────────────────────────────────────────────────────────

async function createTable(spec: TableSpec): Promise<SchemaChangeLog | null> {
  if (!apiKey || !baseId) return null;

  const body = {
    name: spec.name,
    fields: spec.fields.map((f) => ({
      name: f.name,
      type: f.type,
      ...(f.options ? { options: f.options } : {}),
    })),
  };

  const res = await fetch(`${AIRTABLE_API_ROOT}/meta/bases/${baseId}/tables`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[Schema Manager] Failed to create table '${spec.name}': ${res.status} ${text}`);
    return null;
  }

  invalidateSchemaCache();

  const log: SchemaChangeLog = {
    action: "SCHEMA_TABLE_CREATED",
    target: spec.name,
    details: `Auto-created table '${spec.name}' with ${spec.fields.length} fields: ${spec.fields.map((f) => f.name).join(", ")}`,
    timestamp: new Date().toISOString(),
  };

  console.log(`[Schema Manager] ${log.details}`);
  return log;
}

// ─── Field Creation ──────────────────────────────────────────────────────────

async function createField(tableId: string, tableName: string, field: FieldSpec): Promise<SchemaChangeLog | null> {
  if (!apiKey || !baseId) return null;

  const body: any = {
    name: field.name,
    type: field.type,
  };
  if (field.options) body.options = field.options;

  const res = await fetch(`${AIRTABLE_API_ROOT}/meta/bases/${baseId}/tables/${tableId}/fields`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn(`[Schema Manager] Failed to create field '${field.name}' on '${tableName}': ${res.status} ${text}`);
    return null;
  }

  invalidateSchemaCache();

  const log: SchemaChangeLog = {
    action: "SCHEMA_FIELD_CREATED",
    target: `${tableName}.${field.name}`,
    details: `Auto-created field '${field.name}' (${field.type}) on table '${tableName}'`,
    timestamp: new Date().toISOString(),
  };

  console.log(`[Schema Manager] ${log.details}`);
  return log;
}

// ─── Ensure Table Exists ─────────────────────────────────────────────────────

export async function ensureTable(spec: TableSpec): Promise<SchemaChangeLog[]> {
  const logs: SchemaChangeLog[] = [];

  try {
    const schema = await fetchBaseSchema();
    const existingTable = schema.tables?.find(
      (t: any) => t.name.toLowerCase() === spec.name.toLowerCase()
    );

    if (!existingTable) {
      // Create the entire table with all fields
      const log = await createTable(spec);
      if (log) logs.push(log);
      return logs;
    }

    // Table exists — check for missing fields
    const existingFieldNames = new Set(
      (existingTable.fields || []).map((f: any) => f.name.toLowerCase())
    );

    for (const field of spec.fields) {
      if (!existingFieldNames.has(field.name.toLowerCase())) {
        const log = await createField(existingTable.id, spec.name, field);
        if (log) logs.push(log);
      }
    }
  } catch (err: any) {
    console.warn(`[Schema Manager] Schema validation for '${spec.name}' failed: ${err.message}`);
  }

  return logs;
}

// ─── Persist Schema Audit Logs ───────────────────────────────────────────────

export async function persistSchemaLogs(logs: SchemaChangeLog[]): Promise<void> {
  if (logs.length === 0) return;

  try {
    // Import dynamically to avoid circular deps
    const { logAuditTrail } = await import("./audit.js");
    for (const log of logs) {
      await logAuditTrail(log.action, "System", "system", log.target, log.details);
    }
  } catch (err: any) {
    console.warn(`[Schema Manager] Failed to persist audit logs: ${err.message}`);
  }
}

// ─── Pre-defined Table Specifications ────────────────────────────────────────

export const TABLE_SPECS: Record<string, TableSpec> = {
  AUDIT_LOGS: {
    name: "Audit_Logs",
    fields: [
      { name: "Action", type: "singleLineText" },
      { name: "Operator", type: "singleLineText" },
      { name: "Operator_Role", type: "singleLineText" },
      { name: "Target", type: "singleLineText" },
      { name: "Details", type: "multilineText" },
      { name: "Timestamp", type: "dateTime", options: { timeZone: "utc", dateFormat: { name: "iso" }, timeFormat: { name: "24hour" } } },
    ],
  },

  DEAL_STAGE_HISTORY: {
    name: "Deal_Stage_History",
    fields: [
      { name: "Deal_ID", type: "singleLineText" },
      { name: "Deal_Ref", type: "singleLineText" },
      { name: "From_Stage", type: "singleLineText" },
      { name: "To_Stage", type: "singleLineText" },
      { name: "Changed_By", type: "singleLineText" },
      { name: "Changed_By_Role", type: "singleLineText" },
      { name: "Changed_At", type: "dateTime", options: { timeZone: "utc", dateFormat: { name: "iso" }, timeFormat: { name: "24hour" } } },
      { name: "Notes", type: "multilineText" },
    ],
  },

  PORTFOLIO_COMPANIES: {
    name: "Portfolio_Companies",
    fields: [
      { name: "Company_Name", type: "singleLineText" },
      { name: "Industry", type: "singleLineText" },
      { name: "Revenue", type: "number", options: { precision: 2 } },
      { name: "EBITDA", type: "number", options: { precision: 2 } },
      { name: "Debt", type: "number", options: { precision: 2 } },
      { name: "Headcount", type: "number", options: { precision: 0 } },
      { name: "Status", type: "singleSelect", options: { choices: [{ name: "Active" }, { name: "Archived" }, { name: "Under Review" }] } },
      { name: "Location", type: "singleLineText" },
      { name: "Notes", type: "multilineText" },
      { name: "Created_At", type: "dateTime", options: { timeZone: "utc", dateFormat: { name: "iso" }, timeFormat: { name: "24hour" } } },
    ],
  },

  DOCUMENTS: {
    name: "Documents",
    fields: [
      { name: "Deal_Ref", type: "singleLineText" },
      { name: "Document_Name", type: "singleLineText" },
      { name: "Category", type: "singleLineText" },
      { name: "ABL_Critical", type: "checkbox" },
      { name: "Status", type: "singleSelect", options: { choices: [{ name: "Received" }, { name: "Sent to Lender" }, { name: "Outstanding" }] } },
      { name: "Source", type: "singleLineText" },
      { name: "Date_Received", type: "dateTime", options: { timeZone: "utc", dateFormat: { name: "iso" }, timeFormat: { name: "24hour" } } },
      { name: "Drive_Link", type: "url" },
      { name: "Expected_Date", type: "singleLineText" },
      { name: "Internal_Notes", type: "multilineText" },
      { name: "Date_Sent_To_Lender", type: "dateTime", options: { timeZone: "utc", dateFormat: { name: "iso" }, timeFormat: { name: "24hour" } } },
      { name: "Lender_Target", type: "singleLineText" },
      { name: "Document_Access", type: "singleSelect", options: { choices: [{ name: "Internal" }, { name: "Lender" }, { name: "Public" }] } },
    ],
  },
};

// ─── Pipeline Field Specs (ensure these exist on Active_Pipeline) ────────────

export const PIPELINE_FIELD_SPECS: FieldSpec[] = [
  { name: "Company_Name", type: "singleLineText" },
  { name: "Project_Name", type: "singleLineText" },
  { name: "Industry", type: "singleLineText" },
  { name: "Website", type: "url" },
  { name: "Location", type: "singleLineText" },
  { name: "Turnover", type: "number", options: { precision: 2 } },
  { name: "EBITDA_GBP", type: "number", options: { precision: 2 } },
  { name: "Enterprise_Value", type: "number", options: { precision: 2 } },
  { name: "Asking_Price_GBP", type: "number", options: { precision: 2 } },
  { name: "Owner", type: "singleLineText" },
  { name: "Analyst", type: "singleLineText" },
  { name: "Source", type: "singleLineText" },
  { name: "Internal_Notes", type: "multilineText" },
  { name: "IM_Review_Documents", type: "multipleAttachments" },
  { name: "Archived", type: "checkbox" },
  { name: "Listing_Link", type: "url" },
  { name: "Contact_Email", type: "email" },
  { name: "Contact_Phone", type: "phoneNumber" },
  { name: "Executive_Summary", type: "multilineText" },
  { name: "Business_Description", type: "multilineText" },
  { name: "Lender_Executive_Summary", type: "multilineText" },
  { name: "Investment_Highlights", type: "multilineText" },
  { name: "Acquisition_Rationale", type: "multilineText" },
  { name: "Deal_Type", type: "singleLineText" },
  { name: "Claude_Verdict", type: "multilineText" },
];

export async function ensurePipelineFields(pipelineTableName: string): Promise<SchemaChangeLog[]> {
  return ensureTable({ name: pipelineTableName, fields: PIPELINE_FIELD_SPECS });
}

// ─── Team/Stakeholder Field Specs ────────────────────────────────────────────

export const TEAM_FIELD_SPECS: FieldSpec[] = [
  { name: "Name", type: "singleLineText" },
  { name: "Email", type: "email" },
  { name: "Phone", type: "phoneNumber" },
  { name: "Role", type: "singleSelect", options: { choices: [{ name: "Managing Partner" }, { name: "Partner" }, { name: "Analyst" }, { name: "Associate" }, { name: "Admin" }, { name: "Read Only" }] } },
  { name: "Status", type: "singleSelect", options: { choices: [{ name: "Active" }, { name: "Inactive" }] } },
  { name: "Access_Level", type: "singleLineText" },
  { name: "Initials", type: "singleLineText" },
  { name: "Avatar_Theme", type: "singleLineText" },
  { name: "Order", type: "number", options: { precision: 0 } },
  { name: "Login_Link", type: "url" },
];

export const STAKEHOLDER_FIELD_SPECS: FieldSpec[] = [
  { name: "Name", type: "singleLineText" },
  { name: "Company", type: "singleLineText" },
  { name: "Email", type: "email" },
  { name: "Phone", type: "phoneNumber" },
  { name: "Type", type: "singleSelect", options: { choices: [{ name: "Advisor" }, { name: "Lawyer" }, { name: "Broker" }, { name: "Consultant" }, { name: "Investor" }, { name: "Portfolio Contact" }] } },
  { name: "Association", type: "singleLineText" },
  { name: "Description", type: "multilineText" },
  { name: "Status", type: "singleSelect", options: { choices: [{ name: "Active" }, { name: "Inactive" }] } },
  { name: "Accent_Color", type: "singleLineText" },
  { name: "Login_Link", type: "url" },
];
