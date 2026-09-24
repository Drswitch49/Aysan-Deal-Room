/**
 * /api/deal-reports — the quarterly reporting record behind a partner's
 * Reporting and Covenants tabs.
 *
 * The trading summary is a line ACP writes, never a computed figure, and the
 * coverage number itself stays in the report and the covenant certificate. The
 * portal shows the status word only, which is why coverage_at_period is an
 * enum here and not a ratio.
 *
 * Publishing is the event partners see: the document row flips from
 * "Publishes 15 Oct" to available, the feed gets a line, and an email goes out
 * carrying no figures.
 */
import { z } from "zod";
import { createHandler } from "./_lib/handler.js";
import { INVESTOR_ROLES, PARTNER_MANAGERS } from "./_lib/authz.js";
import { ForbiddenError, InternalError, NotFoundError } from "../lib/core/errors.js";
import { adminClient } from "../lib/data/supabase/client.js";
import { queueEmail } from "../lib/email/send.js";
import { logActivity, recordAudit } from "./_lib/investor-access.js";

const createSchema = z.object({
  deal_id: z.string().uuid(),
  period_label: z.string().min(1, "A period label is required, e.g. Q3 2026"),
  publishes_on: z.string(),
  trading_summary: z.string().nullable().optional(),
  coverage_at_period: z.enum(["not_yet_reported", "above_floor", "watch", "breach"]).nullable().optional(),
  report_link: z.string().nullable().optional(),
  covenant_cert_link: z.string().nullable().optional(),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  trading_summary: z.string().nullable().optional(),
  coverage_at_period: z.enum(["not_yet_reported", "above_floor", "watch", "breach"]).nullable().optional(),
  report_link: z.string().nullable().optional(),
  covenant_cert_link: z.string().nullable().optional(),
  publishes_on: z.string().optional(),
  publish: z.boolean().optional(),
  /** Moves the deal's next_report_date forward when publishing. */
  next_report_date: z.string().nullable().optional(),
});

export default createHandler({
  methods: ["GET", "POST", "PATCH"],
  requireAuth: true,
  roles: INVESTOR_ROLES,
  handle: async ({ req, body, query, user }) => {
    const db = adminClient();

    if (req.method === "GET") {
      const dealId = (query as any)?.deal_id as string | undefined;
      let q = db.from("deal_reports").select("*").order("publishes_on", { ascending: false });
      if (dealId) q = q.eq("deal_id", dealId);
      const { data, error } = await q;
      if (error) throw new InternalError(`deal_reports: ${error.message}`);
      return { rows: data ?? [], total: data?.length ?? 0 };
    }

    if (!user || !PARTNER_MANAGERS.includes(user.role)) {
      throw new ForbiddenError("Managing reports requires an admin or CFO role");
    }

    if (req.method === "POST") {
      const input = createSchema.parse(body ?? {});
      const { data: created, error } = await db.from("deal_reports").insert(input).select("*").single();
      if (error) {
        if (/duplicate key/i.test(error.message)) {
          throw new InternalError(`A report already exists for ${input.period_label} on this deal.`);
        }
        throw new InternalError(`deal_reports: ${error.message}`);
      }
      await recordAudit({
        action: "CREATE_DEAL_REPORT",
        entityId: created.id,
        entityType: "deal_reports",
        actor: user,
        details: `Scheduled ${created.period_label}`,
        newValue: created,
      });
      return created;
    }

    // PATCH
    const input = patchSchema.parse(body ?? {});
    const { id, publish, next_report_date, ...rest } = input;

    const { data: before } = await db.from("deal_reports").select("*").eq("id", id).maybeSingle();
    if (!before) throw new NotFoundError("Report not found");

    const patch: Record<string, unknown> = { ...rest };
    if (publish && !before.published_at) patch.published_at = new Date().toISOString();

    const { data: updated, error } = await db
      .from("deal_reports")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new InternalError(`deal_reports: ${error.message}`);

    if (next_report_date !== undefined) {
      await db.from("deals").update({ next_report_date }).eq("id", updated.deal_id);
    }

    if (patch.published_at) await announcePublication(updated);

    await recordAudit({
      action: publish ? "PUBLISH_DEAL_REPORT" : "UPDATE_DEAL_REPORT",
      entityId: id,
      entityType: "deal_reports",
      actor: user,
      details: publish ? `Published ${updated.period_label}` : `Updated ${updated.period_label}`,
      oldValue: before,
      newValue: updated,
    });
    return updated;
  },
});

/** One feed line and one email per partner holding in the deal. No figures. */
async function announcePublication(report: any): Promise<void> {
  const db = adminClient();
  const { data } = await db
    .from("commitments")
    .select("investor_id, investors(name, email)")
    .eq("deal_id", report.deal_id)
    .in("status", ["completed", "converted", "bought_back"]);

  const seen = new Set<string>();
  for (const row of data ?? []) {
    if (seen.has(row.investor_id)) continue;
    seen.add(row.investor_id);

    await logActivity(row.investor_id, report.deal_id, "report_published", {
      period_label: report.period_label,
    });

    const investor = (row as any).investors;
    if (investor?.email) {
      await queueEmail({
        investorId: row.investor_id,
        template: "report_published",
        to: investor.email,
        payload: { name: investor.name, period_label: report.period_label },
      });
    }
  }
}
