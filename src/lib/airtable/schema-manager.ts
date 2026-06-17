import { withRetry } from "./retry.js";

const AIRTABLE_API_ROOT = "https://api.airtable.com/v0";
const METADATA_API_ROOT = "https://api.airtable.com/v1";

interface AirtableFieldConfig {
  name: string;
  type: string;
  options?: Record<string, any>;
}

interface AirtableTableConfig {
  name: string;
  fields: AirtableFieldConfig[];
}

const getCredentials = () => {
  const apiKey = process.env.AIRTABLE_API_KEY || process.env.VITE_AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID || process.env.VITE_AIRTABLE_BASE_ID;
  
  if (!apiKey || !baseId) {
    throw new Error("Missing Airtable environment configuration.");
  }
  return { apiKey, baseId };
};

/**
 * Get all tables in a base
 */
async function listTables(): Promise<any[]> {
  return withRetry(async () => {
    const { apiKey, baseId } = getCredentials();
    const url = `${METADATA_API_ROOT}/bases/${baseId}/tables`;
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to list tables: ${response.statusText}`);
    }

    const data = await response.json();
    return data.tables || [];
  });
}

/**
 * Get table schema (fields)
 */
async function getTableSchema(tableName: string): Promise<any> {
  return withRetry(async () => {
    const { apiKey, baseId } = getCredentials();
    const url = `${METADATA_API_ROOT}/bases/${baseId}/tables`;
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get table schema: ${response.statusText}`);
    }

    const data = await response.json();
    const table = data.tables.find((t: any) => t.name === tableName);
    return table;
  });
}

/**
 * Create a new table in Airtable
 */
async function createTable(tableName: string): Promise<any> {
  return withRetry(async () => {
    const { apiKey, baseId } = getCredentials();
    const url = `${METADATA_API_ROOT}/bases/${baseId}/tables`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: tableName,
        fields: [
          {
            name: "Name",
            type: "singleLineText"
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create table: ${errorText}`);
    }

    return response.json();
  });
}

/**
 * Create a field in a table
 */
async function createField(
  tableName: string,
  fieldName: string,
  fieldType: string,
  options?: Record<string, any>
): Promise<any> {
  return withRetry(async () => {
    const { apiKey, baseId } = getCredentials();
    const tables = await listTables();
    const table = tables.find((t: any) => t.name === tableName);
    
    if (!table) {
      throw new Error(`Table ${tableName} not found`);
    }

    const url = `${METADATA_API_ROOT}/bases/${baseId}/tables/${table.id}/fields`;
    
    const payload: any = {
      name: fieldName,
      type: fieldType
    };

    if (options) {
      payload.options = options;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create field: ${errorText}`);
    }

    return response.json();
  });
}

/**
 * Check if a table exists and create it if it doesn't
 */
export async function ensureTable(tableName: string): Promise<void> {
  try {
    const tables = await listTables();
    const exists = tables.some((t: any) => t.name === tableName);
    
    if (!exists) {
      await createTable(tableName);
      console.log(`[Schema] Created table: ${tableName}`);
    }
  } catch (error) {
    console.error(`[Schema] Error ensuring table ${tableName}:`, error);
    throw error;
  }
}

/**
 * Check if a field exists in a table and create it if it doesn't
 */
export async function ensureField(
  tableName: string,
  fieldName: string,
  fieldType: string,
  options?: Record<string, any>
): Promise<void> {
  try {
    const schema = await getTableSchema(tableName);
    
    if (!schema) {
      throw new Error(`Table ${tableName} not found`);
    }

    const fieldExists = schema.fields.some((f: any) => f.name === fieldName);
    
    if (!fieldExists) {
      await createField(tableName, fieldName, fieldType, options);
      console.log(`[Schema] Created field: ${tableName}.${fieldName} (${fieldType})`);
    }
  } catch (error) {
    console.error(`[Schema] Error ensuring field ${tableName}.${fieldName}:`, error);
    throw error;
  }
}

/**
 * Ensure all required tables and fields exist
 */
export async function ensureSchema(): Promise<void> {
  try {
    // Core tables
    await ensureTable("Deals");
    await ensureTable("Portfolio_Companies");
    await ensureTable("ACP_Team");
    await ensureTable("External_Stakeholders");
    await ensureTable("Deal_Stage_History");
    await ensureTable("Audit_Logs");
    await ensureTable("IM_Review_Documents");

    // Deals table fields
    await ensureField("Deals", "Deal_Ref", "singleLineText");
    await ensureField("Deals", "Company_Name", "singleLineText");
    await ensureField("Deals", "Project_Name", "singleLineText");
    await ensureField("Deals", "Industry", "singleLineText");
    await ensureField("Deals", "Website", "url");
    await ensureField("Deals", "Location", "singleLineText");
    await ensureField("Deals", "Owner", "singleLineText");
    await ensureField("Deals", "Analyst", "singleLineText");
    await ensureField("Deals", "Source", "singleLineText");
    await ensureField("Deals", "Revenue", "number");
    await ensureField("Deals", "EBITDA", "number");
    await ensureField("Deals", "Enterprise_Value", "number");
    await ensureField("Deals", "Asking_Price", "number");
    await ensureField("Deals", "Stage", "singleSelect", {
      choices: [
        { name: "Inbound" },
        { name: "Seller Call" },
        { name: "IM Review" },
        { name: "Due Diligence" },
        { name: "LOI" },
        { name: "Under Offer" },
        { name: "Closed" },
        { name: "Archived" }
      ]
    });
    await ensureField("Deals", "Next_Action", "singleLineText");
    await ensureField("Deals", "Due_Date", "date");
    await ensureField("Deals", "Internal_Notes", "multilineText");
    await ensureField("Deals", "IM_Review_Documents", "multipleRecordLinks");
    await ensureField("Deals", "Created_At", "createdTime");
    await ensureField("Deals", "Updated_At", "lastModifiedTime");

    // Portfolio_Companies table fields
    await ensureField("Portfolio_Companies", "Company_Name", "singleLineText");
    await ensureField("Portfolio_Companies", "Industry", "singleLineText");
    await ensureField("Portfolio_Companies", "Revenue", "number");
    await ensureField("Portfolio_Companies", "EBITDA", "number");
    await ensureField("Portfolio_Companies", "Debt", "number");
    await ensureField("Portfolio_Companies", "Headcount", "number");
    await ensureField("Portfolio_Companies", "Status", "singleSelect", {
      choices: [
        { name: "Active" },
        { name: "In Transition" },
        { name: "Exited" },
        { name: "Archived" }
      ]
    });
    await ensureField("Portfolio_Companies", "Location", "singleLineText");
    await ensureField("Portfolio_Companies", "Notes", "multilineText");
    await ensureField("Portfolio_Companies", "Created_At", "createdTime");
    await ensureField("Portfolio_Companies", "Updated_At", "lastModifiedTime");

    // ACP_Team table fields
    await ensureField("ACP_Team", "Name", "singleLineText");
    await ensureField("ACP_Team", "Email", "email");
    await ensureField("ACP_Team", "Phone", "phoneNumber");
    await ensureField("ACP_Team", "Role", "singleSelect", {
      choices: [
        { name: "Managing Partner" },
        { name: "Partner" },
        { name: "Analyst" },
        { name: "Admin" },
        { name: "Read Only" }
      ]
    });
    await ensureField("ACP_Team", "Status", "singleSelect", {
      choices: [
        { name: "Active" },
        { name: "Inactive" }
      ]
    });
    await ensureField("ACP_Team", "Created_At", "createdTime");
    await ensureField("ACP_Team", "Updated_At", "lastModifiedTime");

    // External_Stakeholders table fields
    await ensureField("External_Stakeholders", "Name", "singleLineText");
    await ensureField("External_Stakeholders", "Type", "singleSelect", {
      choices: [
        { name: "Advisor" },
        { name: "Lawyer" },
        { name: "Broker" },
        { name: "Consultant" },
        { name: "Investor" },
        { name: "Portfolio Contact" }
      ]
    });
    await ensureField("External_Stakeholders", "Email", "email");
    await ensureField("External_Stakeholders", "Phone", "phoneNumber");
    await ensureField("External_Stakeholders", "Organization", "singleLineText");
    await ensureField("External_Stakeholders", "Notes", "multilineText");
    await ensureField("External_Stakeholders", "Status", "singleSelect", {
      choices: [
        { name: "Active" },
        { name: "Archived" }
      ]
    });
    await ensureField("External_Stakeholders", "Created_At", "createdTime");
    await ensureField("External_Stakeholders", "Updated_At", "lastModifiedTime");

    // Deal_Stage_History table fields
    await ensureField("Deal_Stage_History", "Deal_Ref", "singleLineText");
    await ensureField("Deal_Stage_History", "From_Stage", "singleLineText");
    await ensureField("Deal_Stage_History", "To_Stage", "singleLineText");
    await ensureField("Deal_Stage_History", "Changed_By", "singleLineText");
    await ensureField("Deal_Stage_History", "Changed_At", "createdTime");
    await ensureField("Deal_Stage_History", "Notes", "multilineText");

    // Audit_Logs table fields
    await ensureField("Audit_Logs", "Event_Type", "singleLineText");
    await ensureField("Audit_Logs", "Entity_Type", "singleLineText");
    await ensureField("Audit_Logs", "Entity_Id", "singleLineText");
    await ensureField("Audit_Logs", "User_Id", "singleLineText");
    await ensureField("Audit_Logs", "Action", "singleLineText");
    await ensureField("Audit_Logs", "Changes", "multilineText");
    await ensureField("Audit_Logs", "Timestamp", "createdTime");
    await ensureField("Audit_Logs", "IP_Address", "singleLineText");

    // IM_Review_Documents table fields
    await ensureField("IM_Review_Documents", "Document_Name", "singleLineText");
    await ensureField("IM_Review_Documents", "File_Type", "singleLineText");
    await ensureField("IM_Review_Documents", "File_Url", "url");
    await ensureField("IM_Review_Documents", "Deal_Ref", "singleLineText");
    await ensureField("IM_Review_Documents", "Uploaded_By", "singleLineText");
    await ensureField("IM_Review_Documents", "Uploaded_At", "createdTime");
    await ensureField("IM_Review_Documents", "File_Size", "number");

    console.log("[Schema] Schema validation complete");
  } catch (error) {
    console.error("[Schema] Error ensuring schema:", error);
    throw error;
  }
}
