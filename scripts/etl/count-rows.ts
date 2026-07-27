/**
 * ETL helper — count records per Airtable table, to gauge data volume before
 * designing/loading. Run: node --env-file=.env --import tsx scripts/etl/count-rows.ts
 */

import { fetchBaseSchema, fetchAllRecords } from "./_client.js";

async function main() {
  const tables = await fetchBaseSchema();
  console.log(`\nRow counts (${tables.length} tables):\n`);
  const results: Array<{ table: string; rows: number }> = [];
  for (const t of tables) {
    try {
      const rows = await fetchAllRecords(t.name);
      results.push({ table: t.name, rows: rows.length });
      console.log(`  ${String(rows.length).padStart(5)}  ${t.name}`);
    } catch (err) {
      console.log(`   ERR   ${t.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  const total = results.reduce((s, r) => s + r.rows, 0);
  console.log(`\n  Total records: ${total}\n`);
}

main().catch((err) => {
  console.error("count-rows failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
