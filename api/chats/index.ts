/**
 * /api/chats — deal chat messages.
 * GET  ?deal_id=…                    list messages for a deal (oldest first)
 * POST { deal_id, message, … }       send a message
 * Replaces the legacy get-chat / send-chat / get-recent-messages action cases.
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { repositories } from "../../lib/data/supabase/repositories.js";

const createSchema = z.object({
  deal_id: z.string().uuid(),
  lender_id: z.string().uuid().optional(),
  message: z.string().min(1),
  sender: z.string().optional(),
});

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
      sender: input.sender ?? user?.email ?? "unknown",
    });
  },
});
