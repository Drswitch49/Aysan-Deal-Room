import { SignJWT, jwtVerify } from "jose";
import { serialize, parse } from "cookie";

const JWT_SECRET = process.env.JWT_SECRET || "acp-deal-os-jwt-secret-key-2026-super-secure-hash";
const secretKey = new TextEncoder().encode(JWT_SECRET);

export async function signJWT(payload: any, expiry: string = "7d") {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(secretKey);
}

export async function verifyJWT(token: string) {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    return payload;
  } catch (err) {
    return null;
  }
}

export function setSessionCookie(res: any, token: string) {
  const cookieStr = serialize("acp_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7 // 7 days
  });
  res.setHeader("Set-Cookie", cookieStr);
}

export function clearSessionCookie(res: any) {
  const cookieStr = serialize("acp_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: -1 // clear cookie
  });
  res.setHeader("Set-Cookie", cookieStr);
}

export function getSessionToken(req: any) {
  const cookies = parse(req.headers.cookie || "");
  return cookies.acp_session || null;
}
