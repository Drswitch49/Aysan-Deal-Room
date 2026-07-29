/**
 * /api/chats — deal chat messages.
 * GET  ?deal_id=…                    list messages for a deal (oldest first)
 * POST { deal_id, message, … }       send a message
 * Replaces the legacy get-chat / send-chat / get-recent-messages action cases.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { displayName, type UserContext } from "../_lib/authz.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

const createSchema = z.object({
  deal_id: z.string().uuid(),
  lender_id: z.string().uuid().optional(),
  message: z.string().min(1),
  sender: z.string().optional(),
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

export default createHandler({
  methods: ["GET", "POST"],
  requireAuth: true,
  handle: async ({ req, body, query, user }) => {
    if (req.method === "GET") {
      return repositories.chatMessages.list({
        ...(query as Record<string, unknown>),
        orderBy: "created_at",
        ascending: true,
      });
    }
    const input = createSchema.parse(body);
    return repositories.chatMessages.create({
      ...input,
      sender: input.sender ?? senderLabel(user),
    });
  },
});
