import { withRetry } from "./retry.js";

const AIRTABLE_API_ROOT = "https://api.airtable.com/v0";

// Ensure environment variables are loaded (works in Node serverless functions)
const getCredentials = () => {
  const apiKey = process.env.AIRTABLE_API_KEY || process.env.VITE_AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID || process.env.VITE_AIRTABLE_BASE_ID;
  
  if (!apiKey || !baseId) {
    throw new Error("Missing Airtable environment configuration. Please set AIRTABLE_API_KEY and AIRTABLE_BASE_ID.");
  }
  return { apiKey, baseId };
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

export type QueryParams = {
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  fields?: string[];
  maxRecords?: number;
};

async function handleResponse(response: Response, tableName: string) {
  if (!response.ok) {
    const errorText = await response.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(errorText);
    } catch {}

    const errorCode = parsed.error?.type || parsed.error || "";
    
    if (
      response.status === 404 ||
      errorCode === "TABLE_NOT_FOUND" ||
      errorCode.includes("table_not_found") ||
      errorText.toLowerCase().includes("could not find table") ||
      errorText.toLowerCase().includes("model was not found")
    ) {
      throw new AirtableError(
        404,
        `Table '${tableName}' not found in your Airtable base.`,
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

/**
 * Fetch a single page of records from Airtable
 */
async function fetchAirtablePage(
  tableName: string,
  params: QueryParams = {},
  offset?: string
): Promise<any> {
  const { apiKey, baseId } = getCredentials();
  const url = new URL(`${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(tableName)}`);

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

  if (params.maxRecords !== undefined) {
    url.searchParams.set("maxRecords", String(params.maxRecords));
  }

  if (offset) {
    url.searchParams.set("offset", offset);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });

  return handleResponse(response, tableName);
}

/**
 * Central server-side wrapper to fetch and auto-paginate Airtable records
 */
export async function airtableFetchAll(
  tableName: string,
  params: QueryParams = {}
): Promise<{ records: any[] }> {
  return withRetry(async () => {
    const allRecords: any[] = [];
    let offset: string | undefined;

    do {
      const page = await fetchAirtablePage(tableName, params, offset);
      allRecords.push(...page.records);
      offset = page.offset;
      
      // Stop paginating if we reached the maxRecords constraint
      if (params.maxRecords && allRecords.length >= params.maxRecords) {
        break;
      }
    } while (offset);

    // If maxRecords was specified, truncate excess elements from final batch
    const records = params.maxRecords ? allRecords.slice(0, params.maxRecords) : allRecords;
    return { records };
  });
}

/**
 * Fetch a single record by ID
 */
export async function airtableFetchRecord(tableName: string, recordId: string): Promise<any> {
  return withRetry(async () => {
    const { apiKey, baseId } = getCredentials();
    const url = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(tableName)}/${recordId}`;
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    return handleResponse(response, tableName);
  });
}

/**
 * Create a new record in Airtable
 */
export async function airtableCreate(tableName: string, fields: Record<string, any>): Promise<any> {
  return withRetry(async () => {
    const { apiKey, baseId } = getCredentials();
    const url = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(tableName)}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields })
    });

    return handleResponse(response, tableName);
  });
}

/**
 * Update an existing record in Airtable
 */
export async function airtableUpdate(
  tableName: string,
  recordId: string,
  fields: Record<string, any>
): Promise<any> {
  return withRetry(async () => {
    const { apiKey, baseId } = getCredentials();
    const url = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(tableName)}/${recordId}`;
    
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields })
    });

    return handleResponse(response, tableName);
  });
}

/**
 * Delete a record in Airtable
 */
export async function airtableDelete(tableName: string, recordId: string): Promise<any> {
  return withRetry(async () => {
    const { apiKey, baseId } = getCredentials();
    const url = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(tableName)}/${recordId}`;
    
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    return handleResponse(response, tableName);
  });
}

// In-memory schema cache
let cachedSchema: any = null;

/**
 * Retrieves base schema metadata
 */
export async function getBaseSchema(): Promise<any> {
  if (cachedSchema) return cachedSchema;
  
  return withRetry(async () => {
    const { apiKey, baseId } = getCredentials();
    const response = await fetch(`${AIRTABLE_API_ROOT}/meta/bases/${baseId}/tables`, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch schema metadata: ${response.statusText}`);
    }

    cachedSchema = await response.json();
    return cachedSchema;
  });
}

/**
 * Fetch field names that exist on a table in Airtable (utilizing schema or fallback check)
 */
export async function getExistFields(tableName: string, safeFields: string[]): Promise<string[]> {
  try {
    const schema = await getBaseSchema();
    const table = schema.tables?.find(
      (t: any) => t.name.toLowerCase() === tableName.toLowerCase()
    );
    if (table) {
      const existingFieldNames = table.fields.map((f: any) => f.name);
      return safeFields.filter((f) => existingFieldNames.includes(f));
    }
  } catch (metaError) {
    console.warn("[Airtable Schema] Metadata API call failed, falling back to field scanning", metaError);
  }

  // Fallback scan
  try {
    const response = await fetchAirtablePage(tableName, { maxRecords: 10 });
    if (!response.records || response.records.length === 0) {
      return [];
    }
    const allKeys = new Set<string>();
    for (const record of response.records) {
      for (const key of Object.keys(record.fields)) {
        allKeys.add(key);
      }
    }
    return safeFields.filter((f) => allKeys.has(f));
  } catch {
    return safeFields; // Fallback to safeFields list if scanning fails
  }
}
