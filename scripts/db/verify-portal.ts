/**
 * Verify the Capital Partner Portal schema on the live database.
 *
 * Read-only. Confirms the shape landed and, more importantly, that the rules
 * are actually being enforced where they are supposed to be — the gates are
 * probed inside a transaction that is always rolled back, so this is safe to
 * run against production at any time.
 *
 * Run:  npm run db:verify-portal
 */
import { Client } from "pg";

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL is required.");

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  let failures = 0;
  const ok = (label: string, pass: boolean, detail = "") => {
    if (!pass) failures++;
    console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  };

  try {
    console.log("\nShape");
    const tables = await client.query(
      `select count(*)::int as n from information_schema.tables
        where table_schema='public' and table_name in
        ('investors','investor_auth_map','portal_invites','commitments','capital_transactions',
         'holdco_shareholdings','deal_partner_profiles','deal_reports','dscr_status_history',
         'investor_documents','activity_log','access_log','email_queue','portal_settings')`,
    );
    ok("14 partner tables", tables.rows[0].n === 14, `found ${tables.rows[0].n}`);

    const views = await client.query(
      `select table_name from information_schema.views
        where table_schema='public' and table_name like 'partner\\_%' order by 1`,
    );
    ok("4 partner views", views.rows.length === 4, views.rows.map((r) => r.table_name).join(", "));

    const cols = await client.query(
      `select count(*)::int as n from information_schema.columns
        where table_name='deals' and column_name in
        ('partner_display_name','dscr_status','contracted_bp_verified','amort_status','next_report_date')`,
    );
    ok("5 partner columns on deals", cols.rows[0].n === 5, `found ${cols.rows[0].n}`);

    // R1 / acceptance Test 6.
    const projections = await client.query(
      `select column_name from information_schema.columns
        where table_name like 'partner\\_%'
          and column_name ~* '(irr|moic|multiple|yield|hold|projec|target|forecast|return)'`,
    );
    ok("no projection columns anywhere in a partner view", projections.rows.length === 0,
       projections.rows.map((r) => r.column_name).join(", ") || "none");

    console.log("\nSettings");
    const settings = await client.query("select offers_enabled, notify_only, terms_version from portal_settings");
    const s = settings.rows[0];
    ok("portal_settings singleton exists", Boolean(s));
    if (s) {
      ok("offers are OFF (needs the Crown Law letter)", s.offers_enabled === false, `offers_enabled=${s.offers_enabled}`);
      ok("notify-only is ON", s.notify_only === true, `notify_only=${s.notify_only}`);
    }

    console.log("\nAccess to the partner views");
    for (const role of ["anon", "authenticated"]) {
      const g = await client.query(
        `select count(*)::int as n from information_schema.role_table_grants
          where grantee=$1 and table_name like 'partner\\_%'`,
        [role],
      );
      ok(`${role} holds no grant on any partner view`, g.rows[0].n === 0, `${g.rows[0].n} grant(s)`);
    }
    const invoker = await client.query(
      `select c.relname from pg_class c
        where c.relkind='v' and c.relname like 'partner\\_%'
          and not coalesce((select option_value::boolean from pg_options_to_table(c.reloptions)
                            where option_name='security_invoker'), false)`,
    );
    ok("every partner view is security_invoker", invoker.rows.length === 0,
       invoker.rows.map((r) => r.relname).join(", ") || "all set");

    console.log("\nGates (probed in a transaction, always rolled back)");
    await client.query("begin");
    const deal = await client.query("select id from deals where deleted_at is null limit 1");
    if (deal.rows.length) {
      const id = deal.rows[0].id;
      let refused = true;
      try {
        await client.query("savepoint g");
        await client.query("select set_dscr_status($1,'watch','probe','admin','probe@acp')", [id]);
        refused = false;
      } catch {
        /* expected */
      } finally {
        await client.query("rollback to savepoint g");
      }
      ok("R4 coverage status refuses a non-CFO role", refused);

      let directRefused = true;
      try {
        await client.query("savepoint g2");
        await client.query("update deals set dscr_status='watch' where id=$1", [id]);
        directRefused = false;
      } catch {
        /* expected */
      } finally {
        await client.query("rollback to savepoint g2");
      }
      ok("R4 a direct UPDATE cannot bypass the function", directRefused);
    }

    let auditRefused = true;
    try {
      await client.query("savepoint g3");
      await client.query("update audit_logs set details='probe' where id=(select id from audit_logs limit 1)");
      auditRefused = false;
    } catch {
      /* expected */
    } finally {
      await client.query("rollback to savepoint g3");
    }
    ok("R7 audit_logs is append only", auditRefused);
    await client.query("rollback");

    console.log(
      failures === 0
        ? "\nAll checks passed.\n"
        : `\n${failures} check(s) FAILED — the portal is not safe to use yet.\n`,
    );
    if (failures > 0) process.exitCode = 1;
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

main().catch((err) => {
  console.error("\nverify failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
