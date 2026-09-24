/**
 * Partner email queue and sender (Build Pack Section 18.2).
 *
 * Every partner message is queued as a row first — so a provider outage shows
 * up as a failed row an admin can see and retry, not as a message that quietly
 * never arrived. Most rows are drained by the worker; messages someone is
 * waiting on (credentials, password resets) are sent from the queue straight
 * away via queueAndSend. Verification is the queue table and the Resend logs,
 * never a green badge in the UI.
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

/**
 * Queue a partner email. Never throws into the caller's write path. Returns
 * the queue row id, or null when the insert failed.
 */
export async function queueEmail(opts: QueueOptions): Promise<number | null> {
  const { data, error } = await adminClient()
    .from("email_queue")
    .insert({
      investor_id: opts.investorId ?? null,
      template: opts.template,
      intended_to: opts.to,
      payload: opts.payload ?? {},
    })
    .select("id")
    .single();
  if (error) {
    // A failed queue insert must not roll back the thing that caused it (an
    // issued invite, a settled call). Log loudly and carry on.
    logger.error({ err: error, template: opts.template }, "email queue insert failed");
    return null;
  }
  return Number(data.id);
}

/**
 * Retire unsent messages of one template for one partner. Issuing new
 * credentials makes an older queued password wrong, and it must not go out
 * after the new one does.
 */
export async function supersedeQueued(investorId: string, template: TemplateName): Promise<void> {
  const { error } = await adminClient()
    .from("email_queue")
    .update({ status: "failed", error: "Superseded by newer credentials before it was sent." })
    .eq("investor_id", investorId)
    .eq("template", template)
    .eq("status", "queued");
  if (error) logger.error({ err: error, investorId, template }, "could not supersede queued email");
}

/** What happened to one message, in terms an admin can act on. */
export interface Delivery {
  status: "sent" | "failed" | "not_sent";
  /** The address it actually went to (the admin address under notify_only). */
  sentTo?: string;
  notifyOnly: boolean;
  /** Why it failed or was held. */
  reason?: string;
}

/**
 * Queue a message and try to send it straight away, rather than waiting for
 * the worker's next tick. Used where a person is waiting on the email (portal
 * credentials, a password reset). A row that cannot go now stays queued with
 * the reason recorded, and the worker retries it once mail is configured.
 */
export async function queueAndSend(opts: QueueOptions): Promise<Delivery> {
  const id = await queueEmail(opts);
  if (id === null) {
    return { status: "failed", notifyOnly: await readNotifyOnly(), reason: "The email could not be queued." };
  }
  const { data: row } = await adminClient().from("email_queue").select("*").eq("id", id).maybeSingle();
  if (!row) return { status: "failed", notifyOnly: await readNotifyOnly(), reason: "The queued email vanished." };
  return sendRow(row, await readNotifyOnly());
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

/** Why a message cannot be sent right now, or null when it can. */
function holdReason(notifyOnly: boolean): string | null {
  const env = getServerEnv();
  if (!mailerConfigured()) {
    return "Email is not configured on the server: RESEND_API_KEY and MAIL_FROM must both be set.";
  }
  if (notifyOnly && !env.NOTIFY_ONLY_ADMIN_EMAIL) {
    return "The portal is in notify-only mode but NOTIFY_ONLY_ADMIN_EMAIL is not set, so there is nowhere safe to send.";
  }
  return null;
}

async function readNotifyOnly(): Promise<boolean> {
  const { data: settings } = await adminClient()
    .from("portal_settings")
    .select("notify_only")
    .eq("id", true)
    .maybeSingle();
  return settings?.notify_only !== false;
}

/** The email_queue columns sendRow reads. */
interface QueueRow {
  id: number;
  template: TemplateName;
  intended_to: string;
  payload: Record<string, unknown> | null;
  attempts: number | null;
  error: string | null;
}

/** Send one queued row and record the outcome on it. */
async function sendRow(row: QueueRow, notifyOnly: boolean): Promise<Delivery> {
  const db = adminClient();
  const env = getServerEnv();

  // Held rows stay queued so they go out once the configuration is fixed, but
  // the reason is written down — a row that silently never moves is how this
  // went unnoticed before.
  const held = holdReason(notifyOnly);
  if (held) {
    if (row.error !== held) await db.from("email_queue").update({ error: held }).eq("id", row.id);
    return { status: "not_sent", notifyOnly, reason: held };
  }

  // Claim the row before sending: bump attempts only if nobody else has since.
  // The immediate send and the worker's drain can reach the same row together,
  // and exactly one of them may put it on the wire.
  const attempts = (row.attempts ?? 0) + 1;
  const { data: claimed } = await db
    .from("email_queue")
    .update({ attempts })
    .eq("id", row.id)
    .eq("status", "queued")
    .eq("attempts", row.attempts ?? 0)
    .select("id");
  if (!claimed?.length) {
    return { status: "not_sent", notifyOnly, reason: "Already being sent by another worker." };
  }

  const recipient = notifyOnly ? env.NOTIFY_ONLY_ADMIN_EMAIL! : row.intended_to;
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
      .update({
        status: "sent",
        sent_to: recipient,
        sent_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", row.id);
    return { status: "sent", sentTo: recipient, notifyOnly };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db
      .from("email_queue")
      .update({ status: "failed", error: reason })
      .eq("id", row.id);
    logger.error({ err, id: row.id, template: row.template }, "partner email send failed");
    return { status: "failed", notifyOnly, reason };
  }
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
 * because sendRow claims each row before sending it.
 */
export async function drainEmailQueue(limit = 25): Promise<SendResult> {
  const db = adminClient();
  const out: SendResult = { sent: 0, failed: 0, skipped: 0 };
  const notifyOnly = await readNotifyOnly();

  const { data: rows, error } = await db
    .from("email_queue")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`email queue read failed: ${error.message}`);
  if (!rows?.length) return out;

  for (const row of rows) {
    const result = await sendRow(row, notifyOnly);
    if (result.status === "sent") out.sent++;
    else if (result.status === "failed") out.failed++;
    else out.skipped++;
  }

  return out;
}
