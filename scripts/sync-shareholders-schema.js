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
      const val = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
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

async function syncSchema() {
  try {
    console.log(`[Sync] Fetching tables to locate Shareholder tables...`);
    const tablesResponse = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, { headers });
    
    if (!tablesResponse.ok) {
      const errText = await tablesResponse.text();
      throw new Error(`Failed to fetch tables: ${tablesResponse.statusText} (${errText})`);
    }

    const { tables = [] } = await tablesResponse.json();
    const existingTables = new Map(tables.map((t) => [t.name, t]));

    // ─── Table: Shareholders ──────────────────────────────────────────────────
    if (!existingTables.get("Shareholders")) {
      console.log(`[Sync] Creating table 'Shareholders'...`);
      const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Shareholders",
          fields: [
            { name: "Name", type: "singleLineText" },
            { name: "Email", type: "email" },
            { name: "Phone", type: "phoneNumber" },
            { name: "Status", type: "singleSelect", options: { choices: [{ name: "Active" }, { name: "Inactive" }] } },
            { name: "Notes", type: "multilineText" },
            { name: "Login_Link", type: "url" },
            { name: "Last_Login", type: "dateTime", options: { timeZone: "utc", dateFormat: { name: "iso" }, timeFormat: { name: "24hour" } } }
          ]
        })
      });

      if (!res.ok) {
        throw new Error(`Failed to create 'Shareholders' table: ${await res.text()}`);
      }
      console.log(`[Sync] Table 'Shareholders' created successfully.`);
    } else {
      console.log(`[Sync] Table 'Shareholders' already exists.`);
    }

    // ─── Table: Shareholder_Deal_Assignments ──────────────────────────────────────────────────
    if (!existingTables.get("Shareholder_Deal_Assignments")) {
      console.log(`[Sync] Creating table 'Shareholder_Deal_Assignments'...`);
      const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Shareholder_Deal_Assignments",
          fields: [
            { name: "Shareholder_ID", type: "singleLineText" },
            { name: "Deal_Ref", type: "singleLineText" },
            { name: "Assigned_At", type: "dateTime", options: { timeZone: "utc", dateFormat: { name: "iso" }, timeFormat: { name: "24hour" } } }
          ]
        })
      });

      if (!res.ok) {
        throw new Error(`Failed to create 'Shareholder_Deal_Assignments' table: ${await res.text()}`);
      }
      console.log(`[Sync] Table 'Shareholder_Deal_Assignments' created successfully.`);
    } else {
      console.log(`[Sync] Table 'Shareholder_Deal_Assignments' already exists.`);
    }

    console.log(`[Sync] Shareholders schema synchronization completed!`);
  } catch (err) {
    console.error(`[Sync] Error:`, err.message);
    process.exit(1);
  }
}

syncSchema();
