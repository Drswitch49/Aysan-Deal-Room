/**
 * Exercises the guards in migration 0026 inside one transaction, then rolls
 * back. Nothing is persisted.
 *
 *   node --env-file=.env --import tsx scripts/db/check-0026.ts
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const results: string[] = [];
  const expectFail = async (label: string, sql: string, params: unknown[] = []) => {
    await client.query("savepoint s");
    try {
      await client.query(sql, params);
      results.push(`✗ ${label}: was ALLOWED`);
    } catch (e: any) {
      results.push(`✓ ${label}: refused (${e.message})`);
    }
    await client.query("rollback to savepoint s");
  };
  const expectOk = async (label: string, sql: string, params: unknown[] = []) => {
    await client.query("savepoint s");
    try {
      await client.query(sql, params);
      results.push(`✓ ${label}: allowed`);
      await client.query("release savepoint s");
    } catch (e: any) {
      results.push(`✗ ${label}: refused (${e.message})`);
      await client.query("rollback to savepoint s");
    }
  };

  try {
    await client.query("begin");
    await client.query(readFileSync("supabase/migrations/0026_investor_agreements.sql", "utf8"));
    const inv = await client.query("select id from investors limit 1");
    if (!inv.rows.length) throw new Error("No investor to test against");
    const investorId = inv.rows[0].id;
    const sig = await client.query(
      `insert into investor_agreement_signatures
         (investor_id, version, agreement_date, body, text_sha256, signed_name, signer_address, pledge_pence)
       values ($1, 999, current_date, 'text', repeat('a', 64), 'Test Signer', '1 High St', 100) returning id`,
      [investorId],
    );
    const id = sig.rows[0].id;

    await expectFail("change the signed text", "update investor_agreement_signatures set body = 'other' where id = $1", [id]);
    await expectFail("change the pledge", "update investor_agreement_signatures set pledge_pence = 5 where id = $1", [id]);
    await expectFail("delete a signature", "delete from investor_agreement_signatures where id = $1", [id]);
    await expectFail("bad hash", "update investor_agreement_signatures set text_sha256 = 'x' where id = $1", [id]);
    await expectOk(
      "countersign once",
      "update investor_agreement_signatures set countersigned_name = 'Ayo', countersigned_by_email = 'a@b', countersigned_at = now() where id = $1",
      [id],
    );
    await expectFail(
      "countersign twice",
      "update investor_agreement_signatures set countersigned_name = 'Someone else', countersigned_at = now() where id = $1",
      [id],
    );

    const rec = await client.query(
      `insert into memorandum_receipts (investor_id, doc_title, respond_by) values ($1, 'Memo', current_date + 14) returning id`,
      [investorId],
    );
    const rid = rec.rows[0].id;
    await expectFail("move the response deadline", "update memorandum_receipts set respond_by = current_date + 60 where id = $1", [rid]);
    await expectFail("election without a time", "update memorandum_receipts set election = 'exercise' where id = $1", [rid]);
    await expectOk("elect once", "update memorandum_receipts set election = 'waive', elected_at = now() where id = $1", [rid]);
    await expectFail("change the election", "update memorandum_receipts set election = 'exercise' where id = $1", [rid]);

    await expectFail("anon reads signatures", "set local role anon; select * from investor_agreement_signatures");
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
  console.log(results.join("\n"));
  console.log("Rolled back — nothing was persisted.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
