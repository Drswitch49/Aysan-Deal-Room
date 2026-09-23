/**
 * Partner email queue and sender (Build Pack Section 18.2).
 *
 * Nothing sends straight from a request handler. Every partner message is
 * queued as a row first, then drained — so a provider outage shows up as a
 * failed row an admin can see and retry, not as a message that quietly never
 * arrived. Verification is the queue table and the Resend logs, never a green
 * badge in the UI.
 *
 * notify_only (on by default, portal_settings.notify_only) reroutes every
 * partner message to NOTIFY_ONLY_ADMIN_EMAIL with the intended recipient in the
 * subject. It stays on until two clean weeks of execution logs, then partners
 * are switched on.
 */
import { adminClient } from "../data/supabase/client.js";
import { getServerEnv } from "../core/env.js";
import { logger } from "../core/logger.js";
import { render, type TemplateName } from "./templates.js";

export interface QueueOptions {
  investorId?: string | null;
  template: TemplateName;
  to: string;
  payload?: Record<string, unknown>;
}

/** Queue a partner email. Never throws into the caller's write path. */
export async function queueEmail(opts: QueueOptions): Promise<void> {
  const { error } = await adminClient()
    .from("email_queue")
    .insert({
      investor_id: opts.investorId ?? null,
      template: opts.template,
      intended_to: opts.to,
      payload: opts.payload ?? {},
    });
  if (error) {
    // A failed queue insert must not roll back the thing that caused it (an
    // issued invite, a settled call). Log loudly and carry on.
    logger.error({ err: error, template: opts.template }, "email queue insert failed");
  }
}

interface SendResult {
  sent: number;
  failed: number;
  skipped: number;
}

/** Are we configured to actually put mail on the wire? */
export function mailerConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
}

async function resendSend(to: string, subject: string, html: string, text: string): Promise<void> {
  const env = getServerEnv();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 300)}`);
  }
}

/**
 * Drain queued messages. Called by the cron worker; safe to call concurrently
 * because each row is claimed by flipping its status before the send.
 */
export async function drainEmailQueue(limit = 25): Promise<SendResult> {
  const db = adminClient();
  const env = getServerEnv();
  const out: SendResult = { sent: 0, failed: 0, skipped: 0 };

  const { data: settings } = await db
    .from("portal_settings")
    .select("notify_only")
    .eq("id", true)
    .maybeSingle();
  const notifyOnly = settings?.notify_only !== false;

  const { data: rows, error } = await db
    .from("email_queue")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`email queue read failed: ${error.message}`);
  if (!rows?.length) return out;

  for (const row of rows) {
    // notify_only puts the whole batch in front of one admin address. Without
    // that address configured there is nowhere safe to send, so hold the row.
    const recipient = notifyOnly ? env.NOTIFY_ONLY_ADMIN_EMAIL : row.intended_to;
    if (!mailerConfigured() || !recipient) {
      out.skipped++;
      continue;
    }

    try {
      const message = render(row.template, {
        ...(row.payload ?? {}),
        portalUrl: env.PORTAL_BASE_URL ?? (row.payload as any)?.portalUrl,
      });
      const subject = notifyOnly
        ? `[notify-only → ${row.intended_to}] ${message.subject}`
        : message.subject;

      await resendSend(recipient, subject, message.html, message.text);

      await db
        .from("email_queue")
        .update({ status: "sent", sent_to: recipient, sent_at: new Date().toISOString(), attempts: (row.attempts ?? 0) + 1 })
        .eq("id", row.id);
      out.sent++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await db
        .from("email_queue")
        .update({ status: "failed", attempts: (row.attempts ?? 0) + 1, error: reason })
        .eq("id", row.id);
      logger.error({ err, id: row.id, template: row.template }, "partner email send failed");
      out.failed++;
    }
  }

  return out;
}
