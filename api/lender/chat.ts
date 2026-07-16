/**
 * LEGACY URL ALIAS — /api/lender/chat now serves the new Supabase-backed chats
 * handler. Remove in Phase 6 when the lender portal calls /api/chats directly.
 */
import chatsHandler from "../chats/index.js";

export default chatsHandler;
