const AIRTABLE_API_ROOT = "https://api.airtable.com/v0";

const apiKey = process.env.VITE_AIRTABLE_API_KEY || process.env.AIRTABLE_API_KEY;
const baseId = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID;

export const TABLES = {
  LENDERS: "Lenders",
  PIPELINE: process.env.VITE_AIRTABLE_PIPELINE_TABLE || "Active_Pipeline",
  DOCUMENTS: process.env.VITE_AIRTABLE_DOCUMENTS_TABLE || "Documents",
  SUBMISSIONS: process.env.VITE_AIRTABLE_SUBMISSION_TABLE || "Submission_Log",
  ASSIGNMENTS: "Lender_Deal_Assignments"
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

export function escapeFormulaString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "\\'");
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
      response.status === 404 ||
      errorCode === "TABLE_NOT_FOUND" ||
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
      if (Array.isArray(params[key])) {
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
      return cleanFieldName === cleanKey;
    });

    if (matchingField) {
      filtered[matchingField.name] = fields[key];
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
