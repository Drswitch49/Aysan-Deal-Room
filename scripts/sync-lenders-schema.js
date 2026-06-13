import fs from "fs";
import path from "path";

// Load local environment variables
function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const val = trimmed.slice(index + 1).trim();
      process.env[key] = val;
    }
  }
}

loadEnv();

const apiKey = process.env.AIRTABLE_API_KEY || process.env.VITE_AIRTABLE_API_KEY;
const baseId = process.env.AIRTABLE_BASE_ID || process.env.VITE_AIRTABLE_BASE_ID;

if (!apiKey || !baseId) {
  console.error("Error: Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID environment variables.");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
};

async function syncLendersSchema() {
  try {
    console.log(`[Sync] Fetching tables to locate Lenders table...`);
    const tablesResponse = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, { headers });
    
    if (!tablesResponse.ok) {
      const errText = await tablesResponse.text();
      throw new Error(`Failed to fetch tables: ${tablesResponse.statusText} (${errText})`);
    }

    const { tables = [] } = await tablesResponse.json();
    const lendersTable = tables.find((t) => t.name === "Lenders");

    if (!lendersTable) {
      console.error("[Sync] Error: 'Lenders' table not found in base schema.");
      process.exit(1);
    }

    console.log(`[Sync] Found 'Lenders' table (ID: ${lendersTable.id}). Inspecting fields...`);
    const existingFields = new Set(lendersTable.fields.map((f) => f.name));

    // Define target fields to add
    const targetFields = [
      {
        name: "Criteria_Pills",
        type: "singleLineText",
        description: "Target investment ticket sizes and appetite tags",
      },
      {
        name: "Last_Contact_Date",
        type: "date",
        options: {
          dateFormat: {
            name: "iso",
            format: "YYYY-MM-DD",
          },
        },
        description: "Date of the last communication or log",
      },
      {
        name: "Passcode_Plain",
        type: "singleLineText",
        description: "Plaintext passcode value for administrator lookups",
      },
    ];

    for (const field of targetFields) {
      if (existingFields.has(field.name)) {
        console.log(`[Sync] Field '${field.name}' already exists in Lenders table.`);
      } else {
        console.log(`[Sync] Creating field '${field.name}' in Lenders table...`);
        const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables/${lendersTable.id}/fields`, {
          method: "POST",
          headers,
          body: JSON.stringify(field),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`[Sync] Failed to create field '${field.name}': ${errText}`);
        } else {
          console.log(`[Sync] Field '${field.name}' created successfully.`);
        }
      }
    }

    console.log("[Sync] Lenders schema sync completed!");
  } catch (err) {
    console.error("[Sync] Schema synchronization failed:", err);
  }
}

syncLendersSchema();
