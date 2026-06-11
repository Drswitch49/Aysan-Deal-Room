import { getSessionToken, verifyJWT } from "../_utils/jwt.js";
import { airtableFetchRecord, TABLES, normalizeLenderFields } from "../_utils/airtable.js";

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

    let lenderFields: any = null;
    if (decoded.role === "lender" && decoded.id) {
      try {
        const lenderRecord = await airtableFetchRecord(TABLES.LENDERS, decoded.id as string);
        if (lenderRecord && lenderRecord.fields) {
          lenderFields = normalizeLenderFields(lenderRecord.fields);
          delete lenderFields.Portal_Password;
        }
      } catch (err) {
        console.warn("Failed to fetch lender profile in session check:", err);
      }
    }

    return res.status(200).json({
      authenticated: true,
      user: {
        email: decoded.email,
        role: decoded.role,
        permissions: decoded.permissions,
        ...(lenderFields || {})
      }
    });
  } catch (err) {
    return res.status(200).json({ authenticated: false });
  }
}
