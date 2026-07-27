/**
 * ETL step 1 — enumerate the authoritative Airtable schema.
 *
 * Calls the Airtable Meta API for the definitive list of tables + fields + types,
 * prints a readable summary, and writes a JSON snapshot to
 * scripts/etl/airtable-schema.json. That snapshot is the source of truth for
 * designing the Supabase schema (it reveals real field names and any tables the
 * app code never referenced).
 *
 * Run:  node --env-file=.env --import tsx scripts/etl/list-tables.ts
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchBaseSchema } from "./_client.js";

async function main() {
  const tables = await fetchBaseSchema();

  console.log(`\nAirtable base has ${tables.length} tables:\n`);
  for (const t of tables) {
    console.log(`■ ${t.name}  (${t.fields.length} fields)`);
    for (const f of t.fields) {
      console.log(`    - ${f.name}  ::  ${f.type}`);
    }
    console.log("");
  }

  const outPath = join(dirname(fileURLToPath(import.meta.url)), "airtable-schema.json");
  const snapshot = tables.map((t) => ({
    name: t.name,
    fields: t.fields.map((f) => ({ name: f.name, type: f.type })),
  }));
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`Wrote authoritative schema snapshot → ${outPath}`);
  console.log(`Tables: ${tables.map((t) => t.name).join(", ")}\n`);
}

main().catch((err) => {
  console.error("list-tables failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
