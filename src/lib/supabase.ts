/**
 * Browser Supabase client — used ONLY for Realtime (deal chat).
 *
 * All data reads/writes still go through the authenticated REST API. This client
 * exists so the frontend can subscribe to Postgres changes over a websocket
 * instead of polling. It authenticates with the anon key (public, safe to ship)
 * plus the signed-in user's JWT, which RLS uses to scope what rows are delivered.
 *
 * Session handling (per product decision): the Supabase session is persisted in
 * localStorage and cleared on logout via `clearRealtimeAuth()`. The access token
 * itself is minted server-side (login sets httpOnly cookies); we hydrate the
 * browser session from those cookies via /api/auth/realtime-session.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;
let warned = false;

/**
 * The browser client, or null when the realtime env vars aren't configured.
 *
 * Built lazily and never at module scope: createClient() throws on an empty URL,
 * and this module is imported by AppLayout, so constructing it eagerly puts that
 * throw in the entry chunk — one missing build-time variable would white-screen
 * the whole CRM (login included) over what is only a chat feature. Callers treat
 * null as "realtime unavailable" and everything else keeps working.
 */
export function getSupabase(): SupabaseClient | null {
  if (!url || !anonKey) {
    if (!warned) {
      warned = true;
      console.error(
        "[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — realtime chat is disabled.",
      );
    }
    return null;
  }

  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "acp_sb_auth",
      },
      realtime: {
        // Keep the socket calm; chat is low-frequency.
        params: { eventsPerSecond: 5 },
      },
    });
  }
  return client;
}

// De-dupe concurrent hydration attempts (many chat components can mount at once).
let hydrating: Promise<void> | null = null;

/**
 * Ensure the browser Supabase client has a session so Realtime can authorize.
 * Idempotent and safe to call before every subscribe.
 */
export async function ensureRealtimeAuth(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  const { data } = await sb.auth.getSession();
  if (data.session) return;

  if (!hydrating) {
    hydrating = (async () => {
      try {
        const res = await fetch("/api/auth/realtime-session");
        if (!res.ok) return;
        const tokens = await res.json();
        if (tokens?.access_token && tokens?.refresh_token) {
          await sb.auth.setSession({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
          });
        }
      } catch (err) {
        console.error("[supabase] realtime session hydration failed:", err);
      } finally {
        hydrating = null;
      }
    })();
  }
  await hydrating;
}

/** Clear the persisted Supabase session (call on logout). */
export async function clearRealtimeAuth(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.auth.signOut();
  } catch (err) {
    console.error("[supabase] signOut failed:", err);
  }
}
