/**
 * GET /api/cron/portal — nightly capital partner housekeeping.
 *
 * The Build Pack schedules this with pg_cron. pg_cron is not enabled on this
 * project, so the work lives in `portal_nightly()` — still one transaction in
 * Postgres, still the same statements — and this route is what wakes it.
 *
 * It expires certifications at twelve months, recalculates staleness flags,
 * expires unused invites, and ends the ninety-day read-only window after a
 * buyback. The last of those also needs the auth account banned, which only the
 * service role can do, so that half runs here.
 *
 * Auth matches the job worker: cron secret, else the Vercel cron header when no
 * secret is set, else an admin session.
 */
import { adminClient } from "../../lib/data/supabase/client.js";
import { getUserContext, ALL_ADMINS } from "../_lib/authz.js";
import { drainEmailQueue } from "../../lib/email/send.js";
import { logger } from "../../lib/core/logger.js";

export default async function handler(req: any, res: any) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers?.authorization ?? "";
  const isCron = cronSecret ? auth === `Bearer ${cronSecret}` : Boolean(req.headers?.["x-vercel-cron"]);

  if (!isCron) {
    const user = await getUserContext(req);
    if (!user || !ALL_ADMINS.includes(user.role)) {
      return res.status(401).json({
        error: { code: "unauthorized", message: "Portal cron requires the cron secret or an admin session" },
      });
    }
  }

  try {
    const db = adminClient();
    const { data: stats, error } = await db.rpc("portal_nightly");
    if (error) throw new Error(error.message);

    // Revoking in the database stops reads immediately (resolveInvestorScope
    // re-reads login_mode every request); banning stops the refresh too.
    const { data: lapsed } = await db
      .from("investor_auth_map")
      .select("investor_id, auth_uid")
      .eq("login_mode", "revoked")
      .not("auth_uid", "is", null)
      .lt("read_only_until", new Date().toISOString().slice(0, 10));

    let banned = 0;
    for (const row of lapsed ?? []) {
      const { error: banErr } = await db.auth.admin.updateUserById(row.auth_uid, {
        ban_duration: "876000h",
      });
      if (banErr) logger.error({ err: banErr, investorId: row.investor_id }, "read-only expiry ban failed");
      else banned++;
    }

    const mail = await drainEmailQueue(100);
    return res.status(200).json({ data: { ...(stats as object), accounts_banned: banned, mail } });
  } catch (err) {
    logger.error({ err }, "portal nightly failed");
    return res.status(500).json({
      error: { code: "portal_cron_error", message: err instanceof Error ? err.message : "portal cron failed" },
    });
  }
}
