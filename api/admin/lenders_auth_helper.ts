import { getSessionToken, verifyJWT } from "../_utils/jwt.js";

export async function authenticateAdmin(req: any) {
  const token = getSessionToken(req);
  if (!token) {
    throw new Error("Unauthorized: No session token found");
  }

  const decoded = await verifyJWT(token);
  if (!decoded) {
    throw new Error("Unauthorized: Invalid session token");
  }

  if (decoded.role !== "admin" && decoded.role !== "analyst") {
    throw new Error("Unauthorized: Invalid role permissions");
  }

  // Attach user information to request for downstream handlers
  req.user = decoded;
}
