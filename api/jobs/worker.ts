/**
 * POST/GET /api/jobs/worker — the job worker, driven by Vercel Cron
 * (schedule in vercel.json; maxDuration 300). Claims due jobs atomically and
 * runs their handlers. Also invoked directly by the app right after enqueueing
 * an AI job, so interactive work starts immediately instead of waiting for the
 * next cron tick.
 *
 * Auth, in order:
 *   1. Authorization: Bearer ${CRON_SECRET} — what Vercel Cron sends when the
 *      env var is set. Set it; this is the only authenticated cron path.
 *   2. The x-vercel-cron header, accepted ONLY when CRON_SECRET is unset.
 *      Without this fallback a deployment with no CRON_SECRET rejects its own
 *      cron with a 401 and every queued job sits queued forever — which is
 *      exactly what happened here.
 *   3. An admin session (the in-app kick, and manual drains).
 */
import { runDueJobs } from "../../lib/jobs/queue.js";
import "../../lib/jobs/handlers.js"; // registers all handlers
import { getUserContext, ALL_ADMINS } from "../_lib/authz.js";

export default async function handler(req: any, res: any) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers?.authorization ?? "";
  const isCron = cronSecret
    ? auth === `Bearer ${cronSecret}`
    : Boolean(req.headers?.["x-vercel-cron"]);

  if (!isCron) {
    const user = await getUserContext(req);
    if (!user || !ALL_ADMINS.includes(user.role)) {
      return res.status(401).json({ error: { code: "unauthorized", message: "Worker requires cron secret or admin session" } });
    }
  }

  try {
    const stats = await runDueJobs();
    return res.status(200).json({ data: stats });
  } catch (err) {
    return res.status(500).json({ error: { code: "worker_error", message: err instanceof Error ? err.message : "worker failed" } });
  }
}
