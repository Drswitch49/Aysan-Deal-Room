/**
 * /api/chats — deal chat messages.
 * GET  ?deal_id=…                    list messages for a deal (oldest first)
 * POST { deal_id, message, … }       send a message
 * Replaces the legacy get-chat / send-chat / get-recent-messages action cases.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { displayName, type UserContext } from "../_lib/authz.js";
import { ValidationError } from "../../lib/core/errors.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

const createSchema = z.object({
  deal_id: z.string().uuid(),
  lender_id: z.string().uuid().optional(),
  message: z.string().min(1),
});

/**
 * The whole chat UI identifies the ACP side of a thread by the literal sender
 * "Admin" — that is what decides which bubbles render as "You" and which
 * messages count towards the unread badge. Stamping the operator's email here
 * (the previous behaviour) made staff's own replies read back as incoming
 * lender mail, so they showed on the wrong side and left a permanent unread
 * marker. Portal accounts keep their own name; everyone else is "Admin".
 */
function senderLabel(user: UserContext | null): string {
  if (user?.lenderId || user?.shareholderId) return displayName(user);
  return "Admin";
}

/**
 * Which lender's thread this request belongs to.
 *
 * A message is only ever findable through its lender_id: the admin inbox groups
 * every conversation by it and the lender's own RLS policy matches on it. The
 * portal never sent one, so lender mail landed with lender_id NULL — stored,
 * but in nobody's thread, which is why it never reached the admin page. A
 * portal session is therefore always stamped with its own lender id (the
 * server's claim, never the browser's), and staff must name the thread they
 * are writing into.
 */
function threadLenderId(user: UserContext | null, requested?: string): string {
  if (user?.lenderId) return user.lenderId;
  if (requested) return requested;
  throw new ValidationError("lender_id is required to post into a deal chat");
}

export default createHandler({
  methods: ["GET", "POST"],
  requireAuth: true,
  handle: async ({ req, body, query, user }) => {
    if (req.method === "GET") {
      return repositories.chatMessages.list({
        ...(query as Record<string, unknown>),
        // A lender reads its own thread and nothing else, whatever it asks for.
        ...(user?.lenderId ? { lender_id: user.lenderId } : {}),
        orderBy: "created_at",
        ascending: true,
      });
    }
    const input = createSchema.parse(body);
    return repositories.chatMessages.create({
      ...input,
      lender_id: threadLenderId(user, input.lender_id),
      sender: senderLabel(user),
    });
  },
});
