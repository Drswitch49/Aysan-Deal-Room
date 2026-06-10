import { clearSessionCookie } from "../_utils/jwt.js";

export default async function handler(req: any, res: any) {
  clearSessionCookie(res);
  return res.status(200).json({ success: true, message: "Logged out successfully" });
}
