/**
 * POST/GET /api/jobs/worker — the job worker, driven by Vercel Cron
 * (schedule in vercel.json; maxDuration 300). Claims due jobs atomically and
 * runs their handlers. Also invocable manually by admins for immediate drain.
 *
 * Auth: Vercel Cron sends Authorization: Bearer ${CRON_SECRET} when the env
 * var is set; admin users may also trigger it with their session.
 */
import { runDueJobs } from "../../lib/jobs/queue.js";
import "../../lib/jobs/handlers.js"; // registers all handlers
import { getUserContext, ALL_ADMINS } from "../_lib/authz.js";

export default async function handler(req: any, res: any) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers?.authorization ?? "";
  const isCron = Boolean(cronSecret) && auth === `Bearer ${cronSecret}`;

  if (!isCron) {
    const user = await getUserContext(req);
    if (!user || !ALL_ADMINS.includes(user.role)) {
      return res.status(401).json({ error: { code: "unauthorized", message: "Worker requires cron secret or admin session" } });
    }
  }

  try {
    const stats = await runDueJobs({ batch: 3 });
    return res.status(200).json({ data: stats });
  } catch (err) {
    return res.status(500).json({ error: { code: "worker_error", message: err instanceof Error ? err.message : "worker failed" } });
  }
}
