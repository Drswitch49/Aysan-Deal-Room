/**
 * GET /api/auth/realtime-session — hand the browser its Supabase tokens.
 *
 * The REST API stays cookie-based (httpOnly, XSS-safe). Supabase Realtime, on
 * the other hand, runs in the browser and needs a JWT to authorize the socket
 * and satisfy RLS on chat_messages. This endpoint returns the current session's
 * access + refresh tokens (read from the httpOnly cookies) so the browser
 * Supabase client can hydrate a session and auto-refresh it. The tokens live in
 * the Supabase client's localStorage and are cleared on logout (auth.signOut()).
 *
 * Only the already-authenticated browser (valid session cookies) can call this;
 * no new trust boundary is crossed — the same principal already holds the cookies.
 */
import {
  getTokens,
  verifyAccessToken,
  refreshSession,
  setSessionCookies,
} from "../_lib/session.js";

export default async function handler(req: any, res: any) {
  try {
    const { access, refresh } = getTokens(req);

    if (access && refresh) {
      const user = await verifyAccessToken(access);
      if (user) {
        return res.status(200).json({ access_token: access, refresh_token: refresh });
      }
    }

    // Access expired but refresh is still good → rotate and return fresh tokens.
    if (refresh) {
      const rotated = await refreshSession(refresh);
      if (rotated) {
        setSessionCookies(res, rotated.tokens);
        return res.status(200).json({
          access_token: rotated.tokens.access_token,
          refresh_token: rotated.tokens.refresh_token,
        });
      }
    }

    return res.status(401).json({ error: "Not authenticated" });
  } catch {
    return res.status(401).json({ error: "Not authenticated" });
  }
}
