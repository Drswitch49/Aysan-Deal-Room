/**
 * /api/deal-reports — the quarterly reporting record behind a partner's
 * Reporting and Covenants tabs.
 *
 * The trading summary is a line ACP writes, never a computed figure, and the
 * coverage number itself stays in the report and the covenant certificate. The
 * portal shows the status word only, which is why coverage_at_period is an
 * enum here and not a ratio.
 *
 * Files: the report PDF and covenant certificate are uploaded by the browser
 * straight to Cloudinary and arrive here as their asset details. Each becomes
 * an investor_documents row for the whole deal, tied to the report
 * (deal_report_id), so partners open it through the signed, logged document
 * route like any other document.
 *
 * Publishing is the event partners see: the report and its files flip from
 * "Publishes 15 Oct" to available, the feed gets a line, and an email goes out
 * carrying no figures. Until then the view withholds the summary and coverage.
 */
import { z } from "zod";
import { createHandler } from "./_lib/handler.js";
import { INVESTOR_ROLES, PARTNER_MANAGERS } from "./_lib/authz.js";
import { ConflictError, ForbiddenError, InternalError, NotFoundError } from "../lib/core/errors.js";
import { adminClient } from "../lib/data/supabase/client.js";
import { queueAndSend } from "../lib/email/send.js";
import { deleteAsset } from "../lib/core/cloudinary.js";
import { logActivity, recordAudit } from "./_lib/investor-access.js";

const coverage = z.enum(["not_yet_reported", "above_floor", "watch", "breach"]);

/** An asset the browser has already uploaded to Cloudinary. */
const fileSchema = z.object({
  public_id: z.string().min(1),
  resource_type: z.enum(["image", "raw", "video"]),
  format: z.string().nullable().optional(),
  name: z.string().min(1),
  bytes: z.number().int().nonnegative().nullable().optional(),
});
type UploadedFile = z.infer<typeof fileSchema>;

const createSchema = z.object({
  deal_id: z.string().uuid(),
  period_label: z.string().min(1, "A period label is required, e.g. Q3 2026"),
  publishes_on: z.string(),
  trading_summary: z.string().nullable().optional(),
  coverage_at_period: coverage.nullable().optional(),
  report_link: z.string().nullable().optional(),
  covenant_cert_link: z.string().nullable().optional(),
  report_file: fileSchema.nullable().optional(),
  certificate_file: fileSchema.nullable().optional(),
  /** Publish immediately: partners see it and are emailed now. */
  publish: z.boolean().optional(),
  next_report_date: z.string().nullable().optional(),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  trading_summary: z.string().nullable().optional(),
  coverage_at_period: coverage.nullable().optional(),
  report_link: z.string().nullable().optional(),
  covenant_cert_link: z.string().nullable().optional(),
  publishes_on: z.string().optional(),
  publish: z.boolean().optional(),
  report_file: fileSchema.nullable().optional(),
  certificate_file: fileSchema.nullable().optional(),
  /** Moves the deal's next_report_date forward when publishing. */
  next_report_date: z.string().nullable().optional(),
});

const REPORT_SELECT =
  "*, deals(id, acp_ref_no, deal_name, company_name, partner_display_name), " +
  "investor_documents(id, doc_type, title, file_name, file_bytes, revoked_at, published_at)";

export default createHandler({
  methods: ["GET", "POST", "PATCH", "DELETE"],
  requireAuth: true,
  roles: INVESTOR_ROLES,
  handle: async ({ req, body, query, user }) => {
    const db = adminClient();

    if (req.method === "GET") {
      const dealId = (query as any)?.deal_id as string | undefined;
      let q = db.from("deal_reports").select(REPORT_SELECT).order("publishes_on", { ascending: false });
      if (dealId) q = q.eq("deal_id", dealId);
      const { data, error } = await q;
      if (error) throw new InternalError(`deal_reports: ${error.message}`);
      return { rows: data ?? [], total: data?.length ?? 0 };
    }

    if (!user || !PARTNER_MANAGERS.includes(user.role)) {
      throw new ForbiddenError("Managing reports requires an admin or CFO role");
    }

    if (req.method === "POST") {
      const { report_file, certificate_file, publish, next_report_date, ...input } = createSchema.parse(body ?? {});
      const row: Record<string, unknown> = { ...input };
      if (publish) row.published_at = new Date().toISOString();

      const { data: created, error } = await db.from("deal_reports").insert(row).select("*").single();
      if (error) {
        if (/duplicate key/i.test(error.message)) {
          throw new ConflictError(`A report already exists for ${input.period_label} on this deal.`);
        }
        throw new InternalError(`deal_reports: ${error.message}`);
      }

      await attachFiles(created, { report_file, certificate_file }, user.id);
      if (next_report_date !== undefined) {
        await db.from("deals").update({ next_report_date }).eq("id", created.deal_id);
      }
      const sent = created.published_at ? await announcePublication(created) : null;

      await recordAudit({
        action: publish ? "PUBLISH_DEAL_REPORT" : "CREATE_DEAL_REPORT",
        entityId: created.id,
        entityType: "deal_reports",
        actor: user,
        details: sent ? `Published ${created.period_label} to ${sent.partners} partner(s), ${sent.emailed} emailed` : `Scheduled ${created.period_label}`,
        newValue: created,
      });
      return { ...created, notified: sent };
    }

    if (req.method === "DELETE") {
      const id = z.string().uuid().parse((query as any)?.id ?? (body as any)?.id);
      const { data: report } = await db
        .from("deal_reports")
        .select("*, investor_documents(cloudinary_public_id, cloudinary_resource_type)")
        .eq("id", id)
        .maybeSingle();
      if (!report) throw new NotFoundError("Report not found");
      // Partners have been emailed about a published report; removing it would
      // leave them a notice pointing at nothing. Revoke its documents instead.
      if (report.published_at) {
        throw new ConflictError("A published report cannot be deleted. Revoke its documents to withdraw them.");
      }

      const { error } = await db.from("deal_reports").delete().eq("id", id);
      if (error) throw new InternalError(`deal_reports: ${error.message}`);
      for (const doc of (report as any).investor_documents ?? []) {
        if (doc.cloudinary_public_id) {
          await deleteAsset(doc.cloudinary_public_id, doc.cloudinary_resource_type ?? "image").catch(() => undefined);
        }
      }
      await recordAudit({
        action: "DELETE_DEAL_REPORT",
        entityId: id,
        entityType: "deal_reports",
        actor: user,
        details: `Deleted scheduled ${report.period_label}`,
        oldValue: report,
      });
      return { deleted: true, id };
    }

    // PATCH
    const input = patchSchema.parse(body ?? {});
    const { id, publish, next_report_date, report_file, certificate_file, ...rest } = input;

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

    await attachFiles(updated, { report_file, certificate_file }, user.id);

    if (next_report_date !== undefined) {
      await db.from("deals").update({ next_report_date }).eq("id", updated.deal_id);
    }

    // A rescheduled draft moves its documents' "Publishes" date with it.
    if (rest.publishes_on && !updated.published_at) {
      await db.from("investor_documents").update({ publishes_on: rest.publishes_on }).eq("deal_report_id", id);
    }

    let sent: Awaited<ReturnType<typeof announcePublication>> | null = null;
    if (patch.published_at) {
      await db
        .from("investor_documents")
        .update({ published_at: patch.published_at })
        .eq("deal_report_id", id)
        .is("published_at", null);
      sent = await announcePublication(updated);
    }

    await recordAudit({
      action: publish ? "PUBLISH_DEAL_REPORT" : "UPDATE_DEAL_REPORT",
      entityId: id,
      entityType: "deal_reports",
      actor: user,
      details: sent ? `Published ${updated.period_label} to ${sent.partners} partner(s), ${sent.emailed} emailed` : `Updated ${updated.period_label}`,
      oldValue: before,
      newValue: updated,
    });
    return { ...updated, notified: sent };
  },
});

/**
 * Store the report's uploaded files as deal-wide partner documents. A new file
 * of the same kind replaces the old one's access (the old row is revoked, not
 * deleted, so the audit trail keeps what was sent).
 */
async function attachFiles(
  report: any,
  files: { report_file?: UploadedFile | null; certificate_file?: UploadedFile | null },
  uploadedBy: string | null,
): Promise<void> {
  const db = adminClient();
  const kinds: Array<[UploadedFile | null | undefined, string, string]> = [
    [files.report_file, "quarterly_report", `${report.period_label} quarterly report`],
    [files.certificate_file, "covenant_certificate", `${report.period_label} covenant certificate`],
  ];

  for (const [file, docType, title] of kinds) {
    if (!file) continue;
    await db
      .from("investor_documents")
      .update({ revoked_at: new Date().toISOString() })
      .eq("deal_report_id", report.id)
      .eq("doc_type", docType)
      .is("revoked_at", null);

    const { error } = await db.from("investor_documents").insert({
      deal_id: report.deal_id,
      investor_id: null,
      deal_report_id: report.id,
      doc_type: docType,
      title,
      cloudinary_public_id: file.public_id,
      cloudinary_resource_type: file.resource_type,
      file_format: file.format ?? (file.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? null),
      file_name: file.name,
      file_bytes: file.bytes ?? null,
      publishes_on: report.publishes_on,
      published_at: report.published_at ?? null,
      uploaded_by: uploadedBy,
    });
    if (error) throw new InternalError(`Could not attach ${title}: ${error.message}`);
  }
}

/**
 * One feed line and one email per partner holding in the deal. No figures.
 *
 * Sent now rather than left for the worker, whose cron has not been reliably
 * firing: someone has just pressed "Publish & send" and should see the result.
 * An email that cannot go stays queued with its reason, as with credentials.
 */
async function announcePublication(report: any): Promise<{ partners: number; emailed: number; failed: string[] }> {
  const db = adminClient();
  const { data } = await db
    .from("commitments")
    .select("investor_id, investors(name, email)")
    .eq("deal_id", report.deal_id)
    .in("status", ["completed", "converted", "bought_back"]);

  const seen = new Set<string>();
  let emailed = 0;
  const failed: string[] = [];
  for (const row of data ?? []) {
    if (seen.has(row.investor_id)) continue;
    seen.add(row.investor_id);

    await logActivity(row.investor_id, report.deal_id, "report_published", {
      period_label: report.period_label,
    });

    const investor = (row as any).investors;
    if (investor?.email) {
      const delivery = await queueAndSend({
        investorId: row.investor_id,
        template: "report_published",
        to: investor.email,
        payload: { name: investor.name, period_label: report.period_label },
      });
      if (delivery.status === "sent") emailed += 1;
      else failed.push(`${investor.name}: ${delivery.reason ?? delivery.status}`);
    }
  }
  return { partners: seen.size, emailed, failed };
}
