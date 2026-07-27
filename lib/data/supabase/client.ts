/**
 * Supabase clients (server-only).
 *
 *  - adminClient(): service-role key, bypasses RLS. Use for trusted server work
 *    where authorization is enforced by our own guard (api/_lib/authz).
 *  - userClient(accessToken): request-scoped, runs AS the signed-in user so RLS
 *    policies apply. Use for lender/shareholder-scoped reads once Phase 4 lands.
 *
 * Never import this in the browser bundle — it can hold the service-role key.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "../../core/env.js";

let admin: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (admin) return admin;
  const env = getServerEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export function userClient(accessToken: string): SupabaseClient {
  const env = getServerEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required.");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
