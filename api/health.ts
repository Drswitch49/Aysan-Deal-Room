/**
 * GET /api/health — service health (public). Verifies Supabase connectivity.
 */
import { adminClient } from "../lib/data/supabase/client.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { count, error } = await adminClient()
      .from("deals")
      .select("*", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: { connection: "successful", deals: count ?? 0 },
    });
  } catch (err: any) {
    return res.status(500).json({
      status: "error",
      timestamp: new Date().toISOString(),
      database: { connection: "failed", error: err?.message ?? String(err) },
    });
  }
}
