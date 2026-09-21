/**
 * POST /api/webhooks/send-email — hands a composed LOI or post-meeting email to
 * the Make.com scenario that delivers it.
 *
 * Server-side rather than posting from the browser: a Make hook returns no CORS
 * headers, so a direct fetch() from the page is blocked (and a `no-cors` send
 * would silently discard the response, leaving "sent" unverifiable). Routing it
 * here also keeps the hook URL out of the client bundle and lets every send
 * leave an audit-log entry.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { WRITERS } from "../_lib/authz.js";
import { BadRequestError, ForbiddenError, InternalError } from "../../lib/core/errors.js";
import { repositories } from "../../lib/data/supabase/repositories.js";
import { getDealControls } from "../../lib/postcall/playbook.js";
import { containsFiguresOrStructure } from "../../lib/postcall/scorecard.js";

const MAKE_WEBHOOK_URL =
  process.env.MAKE_WEBHOOK_URL || "https://hook.eu2.make.com/6ib81dgibwtyf9t1moa8ixwd7eai5wxx";

/** The exact shape the Make scenario is mapped against — do not rename keys. */
const bodySchema = z.object({
  email: z.string().email("A valid recipient email address is required"),
  subject: z.string().trim().min(1, "A subject is required"),
  content: z.string().trim().min(1, "The email content is required"),
  type: z.enum(["LOI", "Post_meeting_email"]),
  /** Context for the audit entry; never forwarded. */
  deal_id: z.string().optional(),
  /** Which engine drafted the email; never forwarded. */
  generated_by: z.string().optional(),
});

/** Drafts from the post-call scorecard go to the broker: before Dami's DSCR
 *  sanction they may not carry £, percentages or structure (spec: "No figures out"). */
const POSTCALL_SCORECARD_ENGINE = "postcall_scorecard";

export default createHandler<z.infer<typeof bodySchema>, unknown>({
  methods: ["POST"],
  requireAuth: true,
  bodySchema,
  handle: async ({ body, user }) => {
    if (!user || !WRITERS.includes(user.role)) throw new ForbiddenError("Sending requires a writer role");

    const { deal_id, generated_by, ...payload } = body;

    if (generated_by === POSTCALL_SCORECARD_ENGINE) {
      if (!deal_id) throw new BadRequestError("A post-call scorecard email must name its deal");
      const { dscr_sanctioned_at } = await getDealControls(deal_id);
      if (!dscr_sanctioned_at && containsFiguresOrStructure(`${payload.subject}\n${payload.content}`)) {
        throw new BadRequestError(
          "This broker email carries £, percentages or deal structure. Remove them, or record the DSCR sanction first.",
        );
      }
    }

    let res: Response;
    try {
      res = await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        // Make replies as soon as it queues the scenario; if it hangs, fail
        // loudly instead of holding the request open until the platform kills it.
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new InternalError(
        `Could not reach the delivery webhook: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const responseText = (await res.text().catch(() => "")).slice(0, 500);
    if (!res.ok) {
      throw new InternalError(`Delivery webhook rejected the send (${res.status}): ${responseText}`);
    }

    await repositories.auditLogs
      .create({
        action: payload.type === "LOI" ? "SEND_LOI" : "SEND_POST_MEETING_EMAIL",
        event_type: "email.send",
        entity_type: "deal",
        entity_id: deal_id ?? null,
        operator: user.email,
        operator_role: user.role,
        details: `Sent ${payload.type} to ${payload.email} — "${payload.subject}"`,
        occurred_at: new Date().toISOString(),
      })
      // The email is already away; a failed audit write must not report it as failed.
      .catch(() => undefined);

    return { delivered: true, type: payload.type, email: payload.email, response: responseText };
  },
});
