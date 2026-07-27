/**
 * Migration runner — applies supabase/migrations/*.sql in filename order against
 * the Postgres database, tracking applied files in a `schema_migrations` table so
 * it is idempotent (already-applied files are skipped).
 *
 * Requires SUPABASE_DB_URL — the Postgres connection string from
 * Supabase → Project Settings → Database → Connection string (URI).
 * Use the "Session"/direct or pooler URI; it includes the DB password.
 *
 * Run:  node --env-file=.env --import tsx scripts/db/migrate.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "supabase",
  "migrations",
);

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error(
      "SUPABASE_DB_URL is required (Supabase → Project Settings → Database → Connection string / URI).",
    );
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const applied = new Set(
      (await client.query<{ filename: string }>("select filename from schema_migrations")).rows.map(
        (r) => r.filename,
      ),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`· skip   ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`▶ apply  ${file} ...`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations(filename) values ($1)", [file]);
        await client.query("commit");
        ran++;
        console.log(`✓ done   ${file}`);
      } catch (err) {
        await client.query("rollback");
        throw new Error(
          `Migration ${file} failed (rolled back): ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    console.log(`\n${ran} migration(s) applied, ${files.length - ran} already up to date.\n`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("migrate failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
