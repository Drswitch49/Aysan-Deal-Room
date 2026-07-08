const AIRTABLE_API_ROOT = "https://api.airtable.com/v0";

const apiKey = process.env.VITE_AIRTABLE_API_KEY || process.env.AIRTABLE_API_KEY;
const baseId = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID;

export const TABLES = {
  LENDERS: "Lenders",
  PIPELINE: process.env.VITE_AIRTABLE_PIPELINE_TABLE || "Active_Pipeline",
  DOCUMENTS: process.env.VITE_AIRTABLE_DOCUMENTS_TABLE || "Documents",
  SUBMISSIONS: process.env.VITE_AIRTABLE_SUBMISSION_TABLE || "Submission_Log",
  ASSIGNMENTS: "Lender_Deal_Assignments",
  CHAT: "Chat_Messages",
  TEAM: process.env.AIRTABLE_TEAM_TABLE || "ACP_Team",
  HIRING: process.env.AIRTABLE_HIRING_TABLE || "Hiring_Briefs",
  STAKEHOLDERS: process.env.AIRTABLE_STAKEHOLDER_TABLE || "External_Stakeholders",
  DEAL_INBOX: "Deal_Inbox",
  TRANSCRIPT_ANALYSES: "Transcript_Analyses",
  PRECALL_BRIEFS: "Precall_Briefs",
  POSTCALL_BRIEFS: "Postcall_Briefs",
  PORTFOLIO_METRICS: "Portfolio_Metrics",
  PORTFOLIO_ALERTS: "Portfolio_Alerts",
  PORTFOLIO_HEALTH: "Portfolio_Health",
  SHAREHOLDERS: "Shareholders",
  SHAREHOLDER_DEAL_ASSIGNMENTS: "Shareholder_Deal_Assignments",
  IM_REVIEW_DOCUMENTS: "IM_Review_Documents"
};

export class AirtableError extends Error {
  status: number;
  type?: string;

  constructor(status: number, message: string, type?: string) {
    super(message);
    this.name = "AirtableError";
    this.status = status;
    this.type = type;
  }
}

export function escapeFormulaString(value: any): string {
  if (value === undefined || value === null) return "";
  const str = String(value);
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "\\'");
}

async function handleResponse(response: Response, tableName: string) {
  if (!response.ok) {
    const errorText = await response.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(errorText);
    } catch {}

    const errorCode = parsed.error?.type || parsed.error || "";
    
    // Check if it's a missing table error
    if (
      errorCode === "TABLE_NOT_FOUND" ||
      errorCode === "MODEL_ID_NOT_FOUND" ||
      errorCode.includes("table_not_found") ||
      errorText.toLowerCase().includes("could not find table") ||
      errorText.toLowerCase().includes("model was not found")
    ) {
      throw new AirtableError(
        404,
        `Table '${tableName}' not found in your Airtable base. Please create a table named '${tableName}'.`,
        "TABLE_NOT_FOUND"
      );
    }

    throw new AirtableError(
      response.status,
      parsed.error?.message || errorText || response.statusText,
      errorCode
    );
  }
  return response.json();
}

export async function airtableFetch(table: string, params: Record<string, any> = {}) {
  if (!apiKey || !baseId) {
    throw new Error("Missing Airtable environment configuration.");
  }

  const url = new URL(`${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(table)}`);
  Object.keys(params).forEach(key => {
    if (params[key] !== undefined && params[key] !== null) {
      if (key === "sort" && Array.isArray(params[key])) {
        params[key].forEach((sortItem: any, index: number) => {
          url.searchParams.set(`sort[${index}][field]`, sortItem.field);
          url.searchParams.set(`sort[${index}][direction]`, sortItem.direction);
        });
      } else if (Array.isArray(params[key])) {
        params[key].forEach((val, idx) => {
          url.searchParams.set(`${key}[${idx}]`, String(val));
        });
      } else {
        url.searchParams.set(key, String(params[key]));
      }
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });

  return handleResponse(response, table);
}

export async function airtableFetchRecord(table: string, recordId: string) {
  if (!apiKey || !baseId) {
    throw new Error("Missing Airtable environment configuration.");
  }

  const url = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(table)}/${recordId}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });

  return handleResponse(response, table);
}

export async function filterFieldsBySchema(tableName: string, fields: Record<string, any>): Promise<Record<string, any>> {
  const schema = await getTableSchema(tableName);
  if (!schema || !schema.fields) {
    return fields;
  }

  const filtered: Record<string, any> = {};

  Object.keys(fields).forEach(key => {
    // Normalise key by converting to lowercase and removing spaces/underscores/hyphens
    const cleanKey = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    
    // Find matching field in the schema
    const matchingField = schema.fields.find((f: any) => {
      const cleanFieldName = f.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      return cleanFieldName === cleanKey || 
             (cleanKey === "lenderid" && cleanFieldName === "lendersid") ||
             (cleanKey === "lendersid" && cleanFieldName === "lenderid") ||
             (cleanKey === "dealref" && cleanFieldName === "dealrefs") ||
             (cleanKey === "dealrefs" && cleanFieldName === "dealref") ||
             (cleanKey === "phone" && cleanFieldName === "phonenumber") ||
             (cleanKey === "phonenumber" && cleanFieldName === "phone");
    });

    if (matchingField) {
      let val = fields[key];
      if (matchingField.type === "checkbox") {
        val = (val === "Yes" || val === "yes" || val === true || String(val).toLowerCase() === "true");
      } else if (matchingField.type === "singleSelect" || matchingField.type === "singleLineText" || matchingField.type === "text") {
        if (cleanKey === "ndaapproved" || cleanKey === "nda") {
          val = (val === true || val === "Yes" || val === "yes" || String(val).toLowerCase() === "true") ? "Yes" : "No";
        }

        // Case/Option normalization for ACP_Team table choice values
        if (tableName.toLowerCase().includes("team") || tableName === TABLES.TEAM) {
          if (cleanKey === "accesslevel") {
            const vLower = String(val).toLowerCase().trim();
            if (vLower === "full access" || vLower === "full_access") val = "Full Access";
            else if (vLower === "write access" || vLower === "write_access" || vLower === "ops access" || vLower === "ops_access") val = "OPS Access";
            else if (vLower === "read access" || vLower === "read_access" || vLower === "read only" || vLower === "read_only") val = "Read Access";
            else if (vLower === "finance access" || vLower === "finance_access") val = "Finance Access";
            else if (vLower === "assistant") val = "Assistant";
          } else if (cleanKey === "avatartheme" || cleanKey === "avatarbg") {
            const vLower = String(val).toLowerCase().trim();
            if (vLower === "blue") val = "Blue";
            else if (vLower === "green") val = "Green";
            else if (vLower === "amber") val = "Amber";
            else if (vLower === "purple") val = "Purple";
            else if (vLower === "slate blue" || vLower === "slate_blue") val = "Slate Blue";
          } else if (cleanKey === "status") {
            const vLower = String(val).toLowerCase().trim();
            if (vLower === "active") val = "Active";
            else if (vLower === "inactive") val = "Inactive";
          }
        }

        // Case/Option normalization for External_Stakeholders table choice values
        if (tableName.toLowerCase().includes("stakeholder") || tableName === TABLES.STAKEHOLDERS) {
          if (cleanKey === "type") {
            const vLower = String(val).toLowerCase().trim();
            if (vLower === "advisor") val = "Advisor";
            else if (vLower === "lawyer") val = "Lawyer";
            else if (vLower === "broker") val = "Broker";
            else if (vLower === "consultant") val = "Consultant";
            else if (vLower === "investor") val = "Investor";
            else if (vLower === "portfolio contact" || vLower === "portfolio_contact") val = "Portfolio Contact";
          } else if (cleanKey === "status") {
            const vLower = String(val).toLowerCase().trim();
            if (vLower === "active") val = "Active";
            else if (vLower === "inactive") val = "Inactive";
          }
        }
      }

      // Convert values based on matchingField.type to accommodate attachments vs URLs
      if (matchingField.type === "multipleAttachments") {
        if (typeof val === "string" && val.trim() !== "") {
          val = [{ url: val, filename: fields.Document_Name || fields.Name || "document" }];
        } else if (!Array.isArray(val)) {
          val = [];
        }
      } else if (matchingField.type === "url" || matchingField.type === "singleLineText" || matchingField.type === "multilineText") {
        if (Array.isArray(val)) {
          const firstItem = val[0];
          val = firstItem && typeof firstItem === "object" ? (firstItem.url || "") : "";
        }
      }

      filtered[matchingField.name] = val;
    } else {
      console.warn(`Field '${key}' not found in schema for table '${tableName}', omitting.`);
    }
  });

  return filtered;
}

export async function airtableCreate(table: string, fields: Record<string, any>) {
  if (!apiKey || !baseId) {
    throw new Error("Missing Airtable environment configuration.");
  }

  const filteredFields = await filterFieldsBySchema(table, fields);

  const url = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(table)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields: filteredFields })
  });

  return handleResponse(response, table);
}

export async function airtableUpdate(table: string, id: string, fields: Record<string, any>) {
  if (!apiKey || !baseId) {
    throw new Error("Missing Airtable environment configuration.");
  }

  const filteredFields = await filterFieldsBySchema(table, fields);

  const url = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(table)}/${id}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields: filteredFields })
  });

  return handleResponse(response, table);
}

export async function airtableDelete(table: string, id: string) {
  if (!apiKey || !baseId) {
    throw new Error("Missing Airtable environment configuration.");
  }

  const url = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(table)}/${id}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  return handleResponse(response, table);
}

let cachedSchema: any = null;
export async function getTableSchema(tableName: string): Promise<any> {
  if (cachedSchema) {
    return cachedSchema.tables?.find((t: any) => t.name.toLowerCase() === tableName.toLowerCase());
  }

  if (!apiKey || !baseId) {
    return null;
  }

  try {
    const response = await fetch(`${AIRTABLE_API_ROOT}/meta/bases/${baseId}/tables`, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (response.ok) {
      cachedSchema = await response.json();
      return cachedSchema.tables?.find((t: any) => t.name.toLowerCase() === tableName.toLowerCase());
    }
  } catch (err) {
    console.warn("Airtable Metadata API not available:", err);
  }
  return null;
}

const LENDER_FIELD_MAPPING: Record<string, string> = {
  lenderid: "Lender_ID",
  companyname: "Company_Name",
  contactname: "Contact_Name",
  email: "Email",
  phone: "Phone",
  phonenumber: "Phone",
  portalslug: "Portal_Slug",
  portalpassword: "Portal_Password",
  status: "Status",
  createdat: "Created_At",
  nda: "NDA_Approved",
  ndaapproved: "NDA_Approved",
  criteriapills: "Criteria_Pills",
  lastcontactdate: "Last_Contact_Date",
  passcodeplain: "Passcode_Plain"
};

export function normalizeLenderFields(fields: Record<string, any>): Record<string, any> {
  if (!fields) return {};
  const normalized: Record<string, any> = {};
  
  // Set defaults for expected keys
  normalized.Lender_ID = "";
  normalized.Company_Name = "";
  normalized.Contact_Name = "";
  normalized.Email = "";
  normalized.Phone = "";
  normalized.Portal_Slug = "";
  normalized.Portal_Password = "";
  normalized.Status = "Active";
  normalized.Created_At = "";
  normalized.NDA_Approved = "No";
  normalized.Criteria_Pills = "";
  normalized.Last_Contact_Date = "";
  normalized.Passcode_Plain = "";

  Object.keys(fields).forEach(key => {
    const cleanKey = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const targetKey = LENDER_FIELD_MAPPING[cleanKey];
    if (targetKey) {
      normalized[targetKey] = fields[key];
    } else {
      normalized[key] = fields[key];
    }
  });

  return normalized;
}

const ASSIGNMENT_FIELD_MAPPING: Record<string, string> = {
  assignmentid: "Assignment_ID",
  lenderid: "Lender_ID",
  lendersid: "Lender_ID",
  dealref: "Deal_Ref",
  dealrefs: "Deal_Ref",
  assignedat: "Assigned_At",
  assignedby: "Assigned_By",
  status: "Status",
  nda: "NDA_Approved",
  ndaapproved: "NDA_Approved"
};

export function normalizeAssignmentFields(fields: Record<string, any>): Record<string, any> {
  if (!fields) return {};
  const normalized: Record<string, any> = {};
  
  normalized.Assignment_ID = "";
  normalized.Lender_ID = "";
  normalized.Deal_Ref = "";
  normalized.Assigned_At = "";
  normalized.Assigned_By = "";
  normalized.Status = "Active";
  normalized.NDA_Approved = "No";

  Object.keys(fields).forEach(key => {
    const cleanKey = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const targetKey = ASSIGNMENT_FIELD_MAPPING[cleanKey];
    if (targetKey) {
      normalized[targetKey] = fields[key];
    } else if (cleanKey === "nda" || cleanKey === "ndaapproved") {
      normalized.NDA_Approved = fields[key];
    } else {
      normalized[key] = fields[key];
    }
  });

  return normalized;
}

export async function getAssignmentFields(): Promise<{ 
  lenderIdCol: string; 
  lenderIdLookupCol: string | null;
  dealRefCol: string; 
  statusCol: string | null 
}> {
  const schema = await getTableSchema(TABLES.ASSIGNMENTS);
  if (!schema || !schema.fields) {
    return { lenderIdCol: "Lender_ID", lenderIdLookupCol: null, dealRefCol: "Deal_Ref", statusCol: "Status" };
  }

  const lendersSchema = await getTableSchema(TABLES.LENDERS);
  const pipelineSchema = await getTableSchema(TABLES.PIPELINE);

  const lendersTableId = lendersSchema?.id;
  const pipelineTableId = pipelineSchema?.id;

  const lenderIdField = schema.fields.find((f: any) => {
    if (f.type === "multipleRecordLinks" && lendersTableId && f.options?.linkedTableId === lendersTableId) {
      return true;
    }
    const clean = f.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    return clean === "lenderid" || clean === "lendersid";
  });

  // Find lookup field for Lender ID
  let lenderIdLookupField = null;
  if (lenderIdField) {
    lenderIdLookupField = schema.fields.find((f: any) => {
      return f.type === "multipleLookupValues" && f.options?.recordLinkFieldId === lenderIdField.id;
    });
  }

  // Fallback lookup detection if not matched by ID
  if (!lenderIdLookupField) {
    lenderIdLookupField = schema.fields.find((f: any) => {
      const clean = f.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      return clean.includes("lenderid") && clean.includes("from");
    });
  }

  const dealRefField = schema.fields.find((f: any) => {
    if (f.type === "multipleRecordLinks" && pipelineTableId && f.options?.linkedTableId === pipelineTableId) {
      return true;
    }
    const clean = f.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    return clean === "dealref" || clean === "dealrefs" || clean === "dealreference";
  });

  const statusField = schema.fields.find((f: any) => f.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() === "status");

  return {
    lenderIdCol: lenderIdField ? lenderIdField.name : "Lender_ID",
    lenderIdLookupCol: lenderIdLookupField ? lenderIdLookupField.name : null,
    dealRefCol: dealRefField ? dealRefField.name : "Deal_Ref",
    statusCol: statusField ? statusField.name : null
  };
}

const TEAM_FIELD_MAPPING: Record<string, string> = {
  name: "Name",
  role: "Role",
  accesslevel: "Access_Level",
  initials: "Initials",
  avatartheme: "Avatar_Theme",
  avatarbg: "Avatar_Theme",
  order: "Order"
};

const HIRING_FIELD_MAPPING: Record<string, string> = {
  role: "Role",
  company: "Company",
  status: "Status_Text",
  statustext: "Status_Text",
  accentcolor: "Accent_Color"
};

const STAKEHOLDER_FIELD_MAPPING: Record<string, string> = {
  name: "Name",
  association: "Association",
  description: "Description",
  accentcolor: "Accent_Color"
};

export function normalizeTeamFields(fields: Record<string, any>): Record<string, any> {
  if (!fields) return {};
  const normalized: Record<string, any> = {};
  
  normalized.Name = "";
  normalized.Role = "";
  normalized.Access_Level = "READ ACCESS";
  normalized.Initials = "";
  normalized.Avatar_Theme = "blue";
  normalized.Order = 99;

  Object.keys(fields).forEach(key => {
    const cleanKey = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const targetKey = TEAM_FIELD_MAPPING[cleanKey];
    if (targetKey) {
      normalized[targetKey] = fields[key];
    } else {
      normalized[key] = fields[key];
    }
  });

  return normalized;
}

export function normalizeHiringFields(fields: Record<string, any>): Record<string, any> {
  if (!fields) return {};
  const normalized: Record<string, any> = {};
  
  normalized.Role = "";
  normalized.Company = "";
  normalized.Status_Text = "";
  normalized.Accent_Color = "amber";

  Object.keys(fields).forEach(key => {
    const cleanKey = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const targetKey = HIRING_FIELD_MAPPING[cleanKey];
    if (targetKey) {
      normalized[targetKey] = fields[key];
    } else {
      normalized[key] = fields[key];
    }
  });

  return normalized;
}

export function normalizeStakeholderFields(fields: Record<string, any>): Record<string, any> {
  if (!fields) return {};
  const normalized: Record<string, any> = {};
  
  normalized.Name = "";
  normalized.Association = "";
  normalized.Description = "";
  normalized.Accent_Color = "blue";

  Object.keys(fields).forEach(key => {
    const cleanKey = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const targetKey = STAKEHOLDER_FIELD_MAPPING[cleanKey];
    if (targetKey) {
      normalized[targetKey] = fields[key];
    } else {
      normalized[key] = fields[key];
    }
  });

  return normalized;
}


