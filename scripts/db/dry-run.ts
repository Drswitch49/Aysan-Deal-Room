/**
 * Migration dry run — apply a migration inside a transaction, report, roll back.
 *
 * The Build Pack expects every migration to land on a Supabase branch before
 * production. Branching is not enabled on this project, so this is the next
 * best thing and the one that actually catches the failures that matter: the
 * SQL runs against the real schema, with the real data present, and nothing is
 * kept. A syntax error, a missing column, a constraint that fires on existing
 * rows — all surface here instead of half way through a production apply.
 *
 * It also exercises the partner portal's database gates (rules R4 to R7) with
 * savepoints, so "the rule is enforced in Postgres" is demonstrated rather than
 * asserted. Those checks no-op harmlessly for migrations that do not define them.
 *
 * Run:  npm run db:dry-run -- supabase/migrations/0019_partner_portal.sql
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Pass a migration path, e.g. supabase/migrations/0019_partner_portal.sql");

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL is required.");

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  /** Run `sql`, report whether it was refused, and undo it either way. */
  const expectRefusal = async (label: string, sql: string, params: unknown[] = []) => {
    await client.query("savepoint dry");
    try {
      await client.query(sql, params as never[]);
      console.log(`  ✗ ${label}: ALLOWED — this rule is not being enforced`);
    } catch (err) {
      const first = String(err instanceof Error ? err.message : err).split("\n")[0];
      console.log(`  ✓ ${label}: refused (${first})`);
    } finally {
      await client.query("rollback to savepoint dry");
    }
  };

  try {
    await client.query("begin");
    console.log(`\nApplying ${file} …`);
    await client.query(readFileSync(file, "utf8"));
    console.log("  ✓ applied without error\n");

    // ── Shape ──
    const counts: Array<[string, string]> = [
      [
        "partner tables",
        `select count(*)::int as n from information_schema.tables
          where table_schema='public' and table_name in
            ('investors','investor_auth_map','portal_invites','commitments',
             'capital_transactions','holdco_shareholdings','deal_partner_profiles',
             'deal_reports','dscr_status_history','investor_documents',
             'activity_log','access_log','email_queue','portal_settings')`,
      ],
      [
        "partner views",
        `select count(*)::int as n from information_schema.views
          where table_schema='public' and table_name like 'partner\\_%'`,
      ],
      [
        "projection columns (must be 0 — Test 6)",
        `select count(*)::int as n from information_schema.columns
          where table_name like 'partner\\_%'
            and column_name ~* '(irr|moic|multiple|yield|hold|projec|target|forecast|return)'`,
      ],
    ];
    for (const [label, sql] of counts) {
      const { rows } = await client.query(sql);
      console.log(`  ${label}: ${rows[0].n}`);
    }
    console.log("");

    // ── Gates ──
    const deal = await client.query("select id from deals where deleted_at is null limit 1");
    if (deal.rows.length) {
      const dealId = deal.rows[0].id;
      console.log("  R4 — coverage status has one author:");
      for (const role of ["admin", "owner", "partner", "team", "hr"]) {
        await expectRefusal(
          `    ${role} setting coverage`,
          "select set_dscr_status($1,'above_floor','note',$2,'t@acp')",
          [dealId, role],
        );
      }
      await client.query("savepoint cfo");
      try {
        await client.query("select set_dscr_status($1,'above_floor','Q2 cert CC-2026-Q2','cfo','dami@acp')", [dealId]);
        const h = await client.query("select count(*)::int as n from dscr_status_history where deal_id=$1", [dealId]);
        console.log(`  ✓     cfo setting coverage: allowed, ${h.rows[0].n} history row(s) written`);
      } catch (err) {
        console.log(`  ✗     cfo setting coverage: REFUSED — ${err instanceof Error ? err.message : err}`);
      } finally {
        await client.query("rollback to savepoint cfo");
      }
      await expectRefusal("    direct UPDATE bypassing the function", "update deals set dscr_status='breach' where id=$1", [
        dealId,
      ]);
      console.log("");
    }

    // R6 / R5 need a partner to hang off.
    const inv = await client.query(
      `insert into investors (name, email, type, status)
       values ('Dry run', 'dry-run@example.invalid', 'prospective', 'prospective')
       returning id`,
    );
    const investorId = inv.rows[0].id;

    console.log("  R6 — no invite without live certification:");
    await expectRefusal("    invite for an uncertified partner", "select issue_portal_invite($1,'admin','a@acp',24)", [
      investorId,
    ]);
    await client.query(
      `update investors set certification_status='valid', certification_kind='hnw',
              certification_date = current_date - interval '13 months',
              certification_evidence_link='https://example.invalid/cert'
       where id=$1`,
      [investorId],
    );
    await expectRefusal(
      "    invite on a 13-month-old certification",
      "select issue_portal_invite($1,'admin','a@acp',24)",
      [investorId],
    );
    await expectRefusal(
      "    invite issued by a role that may not",
      "select issue_portal_invite($1,'analyst','a@acp',24)",
      [investorId],
    );
    console.log("");

    console.log("  R5 — no distribution without a CFO sanction reference:");
    if (deal.rows.length) {
      const c = await client.query(
        `insert into commitments (investor_id, deal_id, committed_pence) values ($1,$2,100) returning id`,
        [investorId, deal.rows[0].id],
      );
      await expectRefusal(
        "    distribution with no sanction ref",
        `insert into capital_transactions (commitment_id, type, amount_pence, txn_date)
         values ($1,'distribution',100,current_date)`,
        [c.rows[0].id],
      );
      await expectRefusal(
        "    settled row with no evidence link",
        `insert into capital_transactions (commitment_id, type, amount_pence, txn_date, settled, cfo_sanction_ref)
         values ($1,'distribution',100,current_date,true,'SR-1')`,
        [c.rows[0].id],
      );
    }
    console.log("");

    console.log("  R7 — the record cannot be rewritten:");
    await expectRefusal(
      "    UPDATE on audit_logs",
      "update audit_logs set details='tampered' where id = (select id from audit_logs limit 1)",
    );
    // A row must exist first: these are row-level triggers, so a statement that
    // matches nothing is accepted without ever reaching the rule, which would
    // report a pass that means nothing.
    await client.query(
      "insert into activity_log (investor_id, event_type, payload) values ($1,'dry_run','{}')",
      [investorId],
    );
    await expectRefusal("    UPDATE on activity_log", "update activity_log set event_type='x' where investor_id=$1", [
      investorId,
    ]);
    await expectRefusal("    DELETE from activity_log", "delete from activity_log where investor_id=$1", [investorId]);
    console.log("");

    // R2/R3 — a partner view must not be readable by an ordinary signed-in
    // user. These views are not self-filtering, so a stray grant would hand one
    // partner every other partner's holdings.
    console.log("  R2/R3 — partner views are not readable by anon or authenticated:");
    for (const role of ["anon", "authenticated"]) {
      for (const view of ["partner_deal_view", "partner_capital_transactions", "partner_documents", "partner_reports"]) {
        await client.query("savepoint viewcheck");
        try {
          await client.query(`set local role ${role}`);
          await client.query(`select 1 from ${view} limit 1`);
          console.log(`  ✗     ${role} → ${view}: READABLE`);
        } catch (err) {
          const first = String(err instanceof Error ? err.message : err).split("\n")[0];
          console.log(`  ✓     ${role} → ${view}: refused (${first})`);
        } finally {
          // Rollback first: once the statement has errored the transaction is
          // aborted and every later command, `reset role` included, is ignored.
          await client.query("rollback to savepoint viewcheck");
          await client.query("reset role");
        }
      }
    }

    // The counterpart, and the one that breaks the portal silently if it fails:
    // the role the API connects as must still be able to read the views.
    console.log("\n  service_role can still read the views:");
    for (const view of ["partner_deal_view", "partner_capital_transactions", "partner_documents", "partner_reports"]) {
      await client.query("savepoint svc");
      try {
        await client.query("set local role service_role");
        await client.query(`select 1 from ${view} limit 1`);
        console.log(`  ✓     service_role → ${view}: readable`);
      } catch (err) {
        const first = String(err instanceof Error ? err.message : err).split("\n")[0];
        console.log(`  ✗     service_role → ${view}: REFUSED (${first}) — the portal would show nothing`);
      } finally {
        await client.query("rollback to savepoint svc");
        await client.query("reset role");
      }
    }

    console.log("\nDry run complete. Rolling back — nothing was persisted.\n");
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

main().catch((err) => {
  console.error("\ndry run FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
