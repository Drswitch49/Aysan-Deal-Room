/**
 * ETL reset — TRUNCATE all migrated tables + the id-map, so the ETL can reload
 * from a clean slate. Uses SUPABASE_DB_URL (same as the migration runner).
 *
 * Run: node --env-file=.env --import tsx scripts/etl/reset.ts
 */
import { Client } from "pg";

const TABLES = [
  "etl_id_map",
  "audit_logs",
  "portfolio_health", "portfolio_alerts", "portfolio_metrics", "portfolio_companies",
  "postcall_briefs", "precall_briefs", "transcript_analyses",
  "deal_notes", "chat_messages", "deal_stage_history",
  "shareholder_deal_assignments", "lender_deal_assignments",
  "submission_log", "im_review_documents", "documents",
  "deals",
  "hiring_briefs", "external_stakeholders", "shareholders", "lenders", "acp_team", "profiles",
];

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL required.");
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(`truncate table ${TABLES.join(", ")} restart identity cascade;`);
    console.log(`Truncated ${TABLES.length} tables. Clean slate ready.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("reset failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
