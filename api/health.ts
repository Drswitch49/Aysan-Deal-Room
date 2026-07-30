/**
 * GET /api/health — service health (public). Verifies Supabase connectivity and
 * reports which optional integrations are configured in this deployment.
 *
 * The integrations block is booleans only — never a key, a prefix or a length.
 * It exists because "is COMPANIES_HOUSE_API_KEY actually set in Production?"
 * was previously unanswerable without a Vercel session, and a missing key is
 * silent: the OSINT scan just reports the source as unavailable and moves on.
 */
import { adminClient } from "../lib/data/supabase/client.js";

const configured = (name: string): boolean => Boolean(process.env[name]?.trim());

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const integrations = {
    ai: configured("ANTHROPIC_API_KEY"),
    companiesHouse: configured("COMPANIES_HOUSE_API_KEY"),
    notionSops: configured("NOTION_API_KEY"),
    notionSopPagesPinned: configured("NOTION_SOP_PAGE_IDS"),
    news: configured("NEWS_API_KEY"),
    cloudinary: configured("CLOUDINARY_API_KEY"),
    cronSecret: configured("CRON_SECRET"),
  };

  try {
    const { count, error } = await adminClient()
      .from("deals")
      .select("*", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: { connection: "successful", deals: count ?? 0 },
      integrations,
    });
  } catch (err: any) {
    return res.status(500).json({
      status: "error",
      timestamp: new Date().toISOString(),
      database: { connection: "failed", error: err?.message ?? String(err) },
      integrations,
    });
  }
}
