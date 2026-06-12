import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";

export default function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.INNGEST_SIGNING_KEY;
  
  if (!key) {
    return res.status(200).json({
      configured: false,
      message: "INNGEST_SIGNING_KEY is not set"
    });
  }

  // Calculate SHA-256 hash of the key
  const sha256Hash = crypto.createHash("sha256").update(key).digest("hex");

  return res.status(200).json({
    configured: true,
    length: key.length,
    prefix: key.substring(0, 15),
    suffix: key.slice(-15),
    sha256: sha256Hash,
    environment: process.env.VERCEL_ENV || "unknown"
  });
}
