import { getSessionToken, verifyJWT } from "../_utils/jwt.js";

export default async function handler(req: any, res: any) {
  try {
    const token = getSessionToken(req);
    if (!token) {
      return res.status(200).json({ authenticated: false });
    }

    const decoded = await verifyJWT(token);
    if (!decoded) {
      return res.status(200).json({ authenticated: false });
    }

    return res.status(200).json({
      authenticated: true,
      user: {
        email: decoded.email,
        role: decoded.role,
        permissions: decoded.permissions
      }
    });
  } catch (err) {
    return res.status(200).json({ authenticated: false });
  }
}
