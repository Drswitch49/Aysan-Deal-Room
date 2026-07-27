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
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loud in dev; realtime chat simply won't connect without these.
  console.error(
    "[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — realtime chat is disabled.",
  );
}

export const supabase = createClient(url ?? "", anonKey ?? "", {
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

// De-dupe concurrent hydration attempts (many chat components can mount at once).
let hydrating: Promise<void> | null = null;

/**
 * Ensure the browser Supabase client has a session so Realtime can authorize.
 * Idempotent and safe to call before every subscribe.
 */
export async function ensureRealtimeAuth(): Promise<void> {
  if (!url || !anonKey) return;

  const { data } = await supabase.auth.getSession();
  if (data.session) return;

  if (!hydrating) {
    hydrating = (async () => {
      try {
        const res = await fetch("/api/auth/realtime-session");
        if (!res.ok) return;
        const tokens = await res.json();
        if (tokens?.access_token && tokens?.refresh_token) {
          await supabase.auth.setSession({
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
  if (!url || !anonKey) return;
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.error("[supabase] signOut failed:", err);
  }
}
