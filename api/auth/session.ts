/**
 * GET /api/auth/session — current session user (Phase 4, Supabase-backed).
 *
 * Verifies the access cookie; if expired but a refresh cookie exists, rotates
 * the session transparently and sets fresh cookies. Keeps the legacy FLAT
 * response contract: { authenticated, user? }. Revocation is live: a deleted/
 * banned auth user fails verification immediately.
 */
import { getTokens, verifyAccessToken, refreshSession, setSessionCookies, type SessionUser } from "../_lib/session.js";

function shape(user: SessionUser) {
  return {
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.fullName ?? user.email,
      lenderId: user.lenderId,
      shareholderId: user.shareholderId,
    },
  };
}

export default async function handler(req: any, res: any) {
  try {
    const { access, refresh } = getTokens(req);

    if (access) {
      const user = await verifyAccessToken(access);
      if (user) return res.status(200).json(shape(user));
    }
    if (refresh) {
      const rotated = await refreshSession(refresh);
      if (rotated) {
        setSessionCookies(res, rotated.tokens);
        return res.status(200).json(shape(rotated.user));
      }
    }
    return res.status(200).json({ authenticated: false });
  } catch {
    return res.status(200).json({ authenticated: false });
  }
}
