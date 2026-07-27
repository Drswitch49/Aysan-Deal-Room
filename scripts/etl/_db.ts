/**
 * ETL Postgres writer — uses a connection Pool (SUPABASE_DB_URL) instead of a
 * single long-lived Client, so pooler-side connection drops are handled
 * transparently (a fresh connection is acquired per query) rather than crashing.
 * Each write also retries a couple of times on transient connection errors.
 */
import { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("ETL requires SUPABASE_DB_URL.");
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });
  // Never let an idle-client error crash the process.
  pool.on("error", (err) => {
    console.warn(`   ~ pool idle-client error (ignored): ${err.message}`);
  });
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

const isTransient = (msg: string) =>
  /terminated unexpectedly|ECONNRESET|ETIMEDOUT|EAI_AGAIN|Connection terminated|socket hang up|server closed|timeout/i.test(
    msg,
  );

async function run<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await getPool().query<T>(sql, params);
      return res.rows;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isTransient(msg)) throw err;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

function build(row: Record<string, unknown>): { cols: string[]; params: unknown[]; placeholders: string[] } {
  const cols = Object.keys(row);
  const params = cols.map((c) => row[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  return { cols, params, placeholders };
}

/** INSERT one row, return its uuid. */
export async function insertRow(table: string, row: Record<string, unknown>): Promise<string> {
  const { cols, params, placeholders } = build(row);
  const sql = `insert into ${table} (${cols.map((c) => `"${c}"`).join(", ")}) values (${placeholders.join(", ")}) returning id`;
  const rows = await run<{ id: string }>(sql, params);
  return rows[0].id;
}

/** UPSERT one row on conflict columns, return its uuid. */
export async function upsertRow(
  table: string,
  row: Record<string, unknown>,
  conflictCols: string[],
): Promise<string> {
  const { cols, params, placeholders } = build(row);
  const updates = cols
    .filter((c) => !conflictCols.includes(c))
    .map((c) => `"${c}" = excluded."${c}"`)
    .join(", ");
  const sql =
    `insert into ${table} (${cols.map((c) => `"${c}"`).join(", ")}) values (${placeholders.join(", ")}) ` +
    `on conflict (${conflictCols.map((c) => `"${c}"`).join(", ")}) do update set ${updates} returning id`;
  const rows = await run<{ id: string }>(sql, params);
  return rows[0].id;
}

/** UPDATE a row by id. */
export async function updateRow(table: string, id: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  if (cols.length === 0) return;
  const sets = cols.map((c, i) => `"${c}" = $${i + 1}`);
  const sql = `update ${table} set ${sets.join(", ")} where id = $${cols.length + 1}`;
  await run(sql, [...cols.map((c) => row[c]), id]);
}

export async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return run<T>(sql, params);
}
