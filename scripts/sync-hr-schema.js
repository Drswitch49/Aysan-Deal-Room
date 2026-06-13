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

const SEED_TEAM = [
  { Name: "Ayo Oyesanya", Role: "Managing Partner - ACP GP / VDR", Initials: "AO", Access_Level: "FULL ACCESS", Avatar_Theme: "blue", Order: 1 },
  { Name: "Prince Molo", Role: "Deal Sourcing - BDM", Initials: "PM", Access_Level: "READ ACCESS", Avatar_Theme: "green", Order: 2 },
  { Name: "David Chilton", Role: "Finance - Underwriting", Initials: "DC", Access_Level: "FINANCE ACCESS", Avatar_Theme: "amber", Order: 3 },
  { Name: "Claude", Role: "Deal Ops - Ref: Clear", Initials: "C", Access_Level: "OPS ACCESS", Avatar_Theme: "purple", Order: 4 },
  { Name: "Deliveree", Role: "Ops & Data", Initials: "D", Access_Level: "ASSISTANT", Avatar_Theme: "slate", Order: 5 }
];

const SEED_HIRES = [
  { Role: "CEO", Company: "Clear Water Cleaning Services", Status_Text: "Status: candidates search · First post clear · Target 60 days", Accent_Color: "amber" },
  { Role: "Operations Manager", Company: "MGL (contingent on close)", Status_Text: "Status: scoping · Depends on deal outcome", Accent_Color: "blue" }
];

const SEED_STAKEHOLDERS = [
  { Name: "Lee Coutanche", Association: "Moorfields Commercial Finance", Description: "Lender · active relationship · on: 4 deals active", Accent_Color: "blue" },
  { Name: "Gillie Edwards", Association: "KBS Group broker", Description: "Broker · Deal teaser · 3 referrals active", Accent_Color: "green" },
  { Name: "Navi", Association: "Marketing contractor", Description: "Marketing · Website revamp · Current", Accent_Color: "green" },
  { Name: "Torsten Edwards", Association: "Tech contractor", Description: "Developer · Portal development · on: all projects", Accent_Color: "amber" }
];

async function syncSchema() {
  try {
    console.log(`[Sync] Fetching tables to locate HR tables...`);
    const tablesResponse = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, { headers });
    
    if (!tablesResponse.ok) {
      const errText = await tablesResponse.text();
      throw new Error(`Failed to fetch tables: ${tablesResponse.statusText} (${errText})`);
    }

    const { tables = [] } = await tablesResponse.json();
    const existingTables = new Map(tables.map((t) => [t.name, t]));

    // ─── Table 1: ACP_Team ──────────────────────────────────────────────────
    let teamTable = existingTables.get("ACP_Team");
    if (!teamTable) {
      console.log(`[Sync] Creating table 'ACP_Team'...`);
      const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "ACP_Team",
          description: "Internal team members and access credentials link mapping",
          fields: [
            { name: "Name", type: "singleLineText" },
            { name: "Role", type: "singleLineText" },
            { name: "Initials", type: "singleLineText" },
            {
              name: "Access_Level",
              type: "singleSelect",
              options: {
                choices: [
                  { name: "FULL ACCESS" },
                  { name: "READ ACCESS" },
                  { name: "FINANCE ACCESS" },
                  { name: "OPS ACCESS" },
                  { name: "ASSISTANT" }
                ]
              }
            },
            {
              name: "Avatar_Theme",
              type: "singleSelect",
              options: {
                choices: [
                  { name: "blue" },
                  { name: "green" },
                  { name: "amber" },
                  { name: "purple" },
                  { name: "slate" }
                ]
              }
            },
            { name: "Order", type: "number", options: { precision: 0 } }
          ]
        })
      });

      if (!res.ok) {
        throw new Error(`Failed to create 'ACP_Team' table: ${await res.text()}`);
      }
      teamTable = await res.json();
      console.log(`[Sync] Table 'ACP_Team' created. Seeding initial records...`);
      for (const t of SEED_TEAM) {
        await fetch(`https://api.airtable.com/v0/${baseId}/ACP_Team`, {
          method: "POST",
          headers,
          body: JSON.stringify({ fields: t })
        });
      }
      console.log(`[Sync] Team seeded successfully.`);
    } else {
      console.log(`[Sync] Table 'ACP_Team' already exists.`);
    }

    // ─── Table 2: Hiring_Briefs ─────────────────────────────────────────────
    let hiringTable = existingTables.get("Hiring_Briefs");
    if (!hiringTable) {
      console.log(`[Sync] Creating table 'Hiring_Briefs'...`);
      const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Hiring_Briefs",
          description: "Open hiring positions for CEO and portfolio companies",
          fields: [
            { name: "Role", type: "singleLineText" },
            { name: "Company", type: "singleLineText" },
            { name: "Status_Text", type: "singleLineText" },
            {
              name: "Accent_Color",
              type: "singleSelect",
              options: {
                choices: [
                  { name: "amber" },
                  { name: "blue" },
                  { name: "green" }
                ]
              }
            }
          ]
        })
      });

      if (!res.ok) {
        throw new Error(`Failed to create 'Hiring_Briefs' table: ${await res.text()}`);
      }
      hiringTable = await res.json();
      console.log(`[Sync] Table 'Hiring_Briefs' created. Seeding initial records...`);
      for (const h of SEED_HIRES) {
        await fetch(`https://api.airtable.com/v0/${baseId}/Hiring_Briefs`, {
          method: "POST",
          headers,
          body: JSON.stringify({ fields: h })
        });
      }
      console.log(`[Sync] Hires seeded successfully.`);
    } else {
      console.log(`[Sync] Table 'Hiring_Briefs' already exists.`);
    }

    // ─── Table 3: External_Stakeholders ─────────────────────────────────────
    let stakeholderTable = existingTables.get("External_Stakeholders");
    if (!stakeholderTable) {
      console.log(`[Sync] Creating table 'External_Stakeholders'...`);
      const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "External_Stakeholders",
          description: "External partners, lenders, brokers, and contractors",
          fields: [
            { name: "Name", type: "singleLineText" },
            { name: "Association", type: "singleLineText" },
            { name: "Description", type: "multilineText" },
            {
              name: "Accent_Color",
              type: "singleSelect",
              options: {
                choices: [
                  { name: "amber" },
                  { name: "blue" },
                  { name: "green" }
                ]
              }
            }
          ]
        })
      });

      if (!res.ok) {
        throw new Error(`Failed to create 'External_Stakeholders' table: ${await res.text()}`);
      }
      stakeholderTable = await res.json();
      console.log(`[Sync] Table 'External_Stakeholders' created. Seeding initial records...`);
      for (const s of SEED_STAKEHOLDERS) {
        await fetch(`https://api.airtable.com/v0/${baseId}/External_Stakeholders`, {
          method: "POST",
          headers,
          body: JSON.stringify({ fields: s })
        });
      }
      console.log(`[Sync] Stakeholders seeded successfully.`);
    } else {
      console.log(`[Sync] Table 'External_Stakeholders' already exists.`);
    }

    // ─── Table 4: Audit_Logs ───────────────────────────────────────────────
    let auditTable = existingTables.get("Audit_Logs");
    if (!auditTable) {
      console.log(`[Sync] Creating table 'Audit_Logs'...`);
      const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Audit_Logs",
          description: "Immutable administrative and operation action audit logs",
          fields: [
            { name: "Action", type: "singleLineText" },
            { name: "Operator", type: "singleLineText" },
            { name: "Operator_Role", type: "singleLineText" },
            { name: "Target", type: "singleLineText" },
            { name: "Details", type: "multilineText" },
            { name: "Timestamp", type: "singleLineText" }
          ]
        })
      });

      if (!res.ok) {
        throw new Error(`Failed to create 'Audit_Logs' table: ${await res.text()}`);
      }
      console.log(`[Sync] Table 'Audit_Logs' created successfully.`);
    } else {
      console.log(`[Sync] Table 'Audit_Logs' already exists.`);
    }

    console.log("[Sync] HR, Stakeholders, and Audit Logs schemas synchronization completed!");
  } catch (err) {
    console.error("[Sync] Schema synchronization failed:", err);
  }
}

syncSchema();
