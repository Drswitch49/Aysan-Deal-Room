/**
 * Phase 4a — import legacy users into Supabase Auth.
 *
 * - Staff (profiles): creates an auth user per profile, importing the legacy
 *   bcrypt hash (password_hash) so EXISTING PASSWORDS KEEP WORKING. Role goes
 *   into app_metadata (server-controlled → usable for RBAC).
 * - Lenders: same, using their portal password hash; app_metadata carries
 *   role: "lender" + lender_id for scoping. Lenders without a valid bcrypt
 *   hash or email are skipped (they get invited in Phase 4c).
 *
 * Idempotent: skips rows that already have auth_user_id, and reconciles with
 * existing auth users by email.
 *
 * Run: node --env-file=.env --import tsx scripts/etl/import-auth-users.ts
 */
import { getSupabase } from "./_supabase.js";

const sb = getSupabase();

const isBcrypt = (h: unknown): h is string => typeof h === "string" && /^\$2[aby]\$/.test(h);

async function findAuthUserByEmail(email: string): Promise<string | null> {
  // listUsers paginates; small user counts here so one page suffices.
  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  return hit?.id ?? null;
}

async function importStaff(): Promise<void> {
  const { data: profiles, error } = await sb
    .from("profiles")
    .select("id, email, full_name, role, status, legacy_password_hash, auth_user_id")
    .is("deleted_at", null);
  if (error) throw new Error(`profiles: ${error.message}`);

  let created = 0, linked = 0, skipped = 0;
  for (const p of profiles ?? []) {
    if (p.auth_user_id) { skipped++; continue; }
    if (!p.email || p.email.endsWith("@placeholder.local")) { skipped++; continue; }

    let authId = await findAuthUserByEmail(p.email);
    if (!authId) {
      const { data: createdUser, error: cErr } = await sb.auth.admin.createUser({
        email: p.email,
        email_confirm: true,
        ...(isBcrypt(p.legacy_password_hash) ? { password_hash: p.legacy_password_hash } : {}),
        app_metadata: { role: p.role, profile_id: p.id },
        user_metadata: { full_name: p.full_name },
      });
      if (cErr) { console.warn(`  ⚠ staff ${p.email}: ${cErr.message}`); continue; }
      authId = createdUser.user.id;
      created++;
    } else {
      linked++;
    }
    const { error: uErr } = await sb.from("profiles").update({ auth_user_id: authId }).eq("id", p.id);
    if (uErr) console.warn(`  ⚠ link profile ${p.email}: ${uErr.message}`);
  }
  console.log(`  staff: ${created} created, ${linked} linked-existing, ${skipped} skipped`);
}

async function importLenders(): Promise<void> {
  const { data: lenders, error } = await sb
    .from("lenders")
    .select("id, email, company_name, contact_name, legacy_password_hash, auth_user_id")
    .is("deleted_at", null);
  if (error) throw new Error(`lenders: ${error.message}`);

  let created = 0, linked = 0, skipped = 0;
  for (const l of lenders ?? []) {
    if (l.auth_user_id || !l.email) { skipped++; continue; }

    let authId = await findAuthUserByEmail(l.email);
    if (!authId) {
      const { data: createdUser, error: cErr } = await sb.auth.admin.createUser({
        email: l.email,
        email_confirm: true,
        ...(isBcrypt(l.legacy_password_hash) ? { password_hash: l.legacy_password_hash } : {}),
        app_metadata: { role: "lender", lender_id: l.id },
        user_metadata: { company_name: l.company_name, contact_name: l.contact_name },
      });
      if (cErr) { console.warn(`  ⚠ lender ${l.email}: ${cErr.message}`); continue; }
      authId = createdUser.user.id;
      created++;
    } else {
      linked++;
    }
    const { error: uErr } = await sb.from("lenders").update({ auth_user_id: authId }).eq("id", l.id);
    if (uErr) console.warn(`  ⚠ link lender ${l.email}: ${uErr.message}`);
  }
  console.log(`  lenders: ${created} created, ${linked} linked-existing, ${skipped} skipped`);
}

async function main() {
  console.log("Importing users into Supabase Auth...");
  await importStaff();
  await importLenders();

  const { data: check } = await sb.from("profiles").select("email, role, auth_user_id").is("deleted_at", null);
  const unlinked = (check ?? []).filter((p) => !p.auth_user_id);
  console.log(`\n  profiles linked: ${(check ?? []).length - unlinked.length}/${(check ?? []).length}`);
  if (unlinked.length) console.log(`  unlinked: ${unlinked.map((p) => p.email).join(", ")}`);
  console.log("Done.");
}

main().catch((err) => {
  console.error("import-auth-users failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
