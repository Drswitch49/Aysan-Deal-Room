import fs from "fs";
import path from "path";

// 1. Simple dotenv parser
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

async function syncSchema() {
  try {
    console.log(`[Sync] Fetching tables for base: ${baseId}...`);
    const tablesResponse = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, { headers });
    
    if (!tablesResponse.ok) {
      const errText = await tablesResponse.text();
      throw new Error(`Failed to fetch tables: ${tablesResponse.statusText} (${errText})`);
    }

    const { tables = [] } = await tablesResponse.json();
    console.log(`[Sync] Found ${tables.length} existing tables.`);

    const existingNames = new Set(tables.map((t) => t.name));

    // ─── Table 1: Portfolio_Metrics ──────────────────────────────────────────
    if (!existingNames.has("Portfolio_Metrics")) {
      console.log("[Sync] Creating table 'Portfolio_Metrics'...");
      const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Portfolio_Metrics",
          description: "Historical monthly financial and operational parameters for PortCos",
          fields: [
            { name: "Company_Id", type: "singleLineText" },
            { name: "Company_Name", type: "singleLineText" },
            { name: "Reporting_Period", type: "singleLineText" },
            { name: "Revenue", type: "number", options: { precision: 2, format: "decimal" } },
            { name: "EBITDA", type: "number", options: { precision: 2, format: "decimal" } },
            { name: "DSCR", type: "number", options: { precision: 2, format: "decimal" } },
            { name: "Leverage", type: "number", options: { precision: 2, format: "decimal" } },
            { name: "Headcount", type: "number", options: { precision: 0, format: "integer" } },
            { name: "Churn_Rate", type: "number", options: { precision: 2, format: "decimal" } },
            { name: "Recurring_Revenue", type: "number", options: { precision: 2, format: "decimal" } },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[Sync] Error creating Portfolio_Metrics: ${errText}`);
      } else {
        console.log("[Sync] Successfully created 'Portfolio_Metrics' table.");
      }
    } else {
      console.log("[Sync] Table 'Portfolio_Metrics' already exists.");
    }

    // ─── Table 2: Portfolio_Alerts ───────────────────────────────────────────
    if (!existingNames.has("Portfolio_Alerts")) {
      console.log("[Sync] Creating table 'Portfolio_Alerts'...");
      const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Portfolio_Alerts",
          description: "Triggered alerts and covenant breaches for PortCos",
          fields: [
            { name: "Company_Id", type: "singleLineText" },
            { name: "Company_Name", type: "singleLineText" },
            { name: "Alert_Type", type: "singleLineText" },
            { name: "Severity", type: "singleLineText" },
            { name: "Explanation", type: "multilineText" },
            { name: "Triggered_At", type: "singleLineText" },
            { name: "Resolved_At", type: "singleLineText" },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[Sync] Error creating Portfolio_Alerts: ${errText}`);
      } else {
        console.log("[Sync] Successfully created 'Portfolio_Alerts' table.");
      }
    } else {
      console.log("[Sync] Table 'Portfolio_Alerts' already exists.");
    }

    // ─── Table 3: Portfolio_Health ───────────────────────────────────────────
    if (!existingNames.has("Portfolio_Health")) {
      console.log("[Sync] Creating table 'Portfolio_Health'...");
      const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Portfolio_Health",
          description: "Calculated health scores and summaries for portfolio companies",
          fields: [
            { name: "Company_Id", type: "singleLineText" },
            { name: "Company_Name", type: "singleLineText" },
            { name: "Portfolio_Score", type: "number", options: { precision: 0, format: "integer" } },
            { name: "Risk_Level", type: "singleLineText" },
            { name: "Active_Alerts", type: "number", options: { precision: 0, format: "integer" } },
            { name: "Trend_Summary", type: "multilineText" },
            { name: "Updated_At", type: "singleLineText" },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[Sync] Error creating Portfolio_Health: ${errText}`);
      } else {
        console.log("[Sync] Successfully created 'Portfolio_Health' table.");
      }
    } else {
      console.log("[Sync] Table 'Portfolio_Health' already exists.");
    }

    console.log("[Sync] Schema check and creation completed successfully!");
  } catch (err) {
    console.error("[Sync] Schema synchronization failed:", err);
  }
}

syncSchema();
