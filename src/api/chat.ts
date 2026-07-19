/**
 * Chat client (Phase 6 — Supabase-backed /api/chats).
 * Admin and lender both use the same authenticated endpoint now; the lender's
 * session (Supabase cookie) scopes what they can see.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { api, type Paginated } from "./http";
import { supabase, ensureRealtimeAuth } from "../lib/supabase";
import { mapChatMessage } from "./mappers";
import type { ChatMessage } from "../types/deal";

type Row = Record<string, any>;

async function resolveDealId(refOrId: string): Promise<string | null> {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(refOrId)) return refOrId;
  const page = await api.get<Paginated<Row>>(`/api/deals?ref=${encodeURIComponent(refOrId)}`);
  return page.rows[0]?.id ?? null;
}

async function listChat(dealId: string, lenderId?: string): Promise<ChatMessage[]> {
  const id = await resolveDealId(dealId);
  if (!id) return [];
  const params = new URLSearchParams({ deal_id: id, limit: "200" });
  if (lenderId) params.set("lender_id", lenderId);
  const page = await api.get<Paginated<Row>>(`/api/chats?${params.toString()}`);
  return page.rows.map(mapChatMessage);
}

async function sendChat(dealId: string, message: string, lenderId?: string): Promise<ChatMessage> {
  const id = await resolveDealId(dealId);
  if (!id) throw new Error(`Deal not found: ${dealId}`);
  const row = await api.post<Row>("/api/chats", { deal_id: id, message, lender_id: lenderId });
  return mapChatMessage(row);
}

// ─── Lender portal ──────────────────────────────────────────────────────────

export async function fetchLenderChat(_portalSlug: string, dealId: string): Promise<ChatMessage[]> {
  return listChat(dealId);
}

export async function sendLenderChatMessage(_portalSlug: string, dealId: string, message: string): Promise<ChatMessage> {
  return sendChat(dealId, message);
}

export async function fetchRecentLenderChat(_portalSlug: string): Promise<ChatMessage[]> {
  const page = await api.get<Paginated<Row>>("/api/chats?limit=100");
  return page.rows.map(mapChatMessage);
}

// ─── Admin panel ────────────────────────────────────────────────────────────

export async function fetchAdminChat(dealId: string, lenderRecordId: string): Promise<ChatMessage[]> {
  return listChat(dealId, lenderRecordId || undefined);
}

export async function sendAdminChatMessage(dealId: string, lenderRecordId: string, message: string): Promise<ChatMessage> {
  return sendChat(dealId, message, lenderRecordId || undefined);
}

export async function fetchRecentAdminChat(): Promise<ChatMessage[]> {
  const page = await api.get<Paginated<Row>>("/api/chats?limit=100");
  return page.rows.map(mapChatMessage);
}

// ─── Realtime (replaces polling) ──────────────────────────────────────────────

/**
 * Subscribe to new messages for one deal. Returns an unsubscribe function.
 * RLS scopes delivery server-side (staff see all; a lender sees only its thread);
 * `lenderId` narrows an admin's view to the currently-open lender thread.
 */
export function subscribeDealChat(
  dealId: string,
  opts: { lenderId?: string; onInsert: (message: ChatMessage) => void },
): () => void {
  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  (async () => {
    await ensureRealtimeAuth();
    const id = await resolveDealId(dealId);
    if (!id || cancelled) return;

    channel = supabase
      .channel(`deal-chat:${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `deal_id=eq.${id}` },
        (payload) => {
          const row = payload.new as Row;
          if (opts.lenderId && row.lender_id !== opts.lenderId) return;
          opts.onInsert(mapChatMessage(row));
        },
      )
      .subscribe();
  })();

  return () => {
    cancelled = true;
    if (channel) supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to every new message the current user is allowed to see (RLS-scoped).
 * Used by the global notification watcher. Returns an unsubscribe function.
 */
export function subscribeAllChat(onInsert: (message: ChatMessage) => void): () => void {
  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  (async () => {
    await ensureRealtimeAuth();
    if (cancelled) return;

    channel = supabase
      .channel("chat-all")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => onInsert(mapChatMessage(payload.new as Row)),
      )
      .subscribe();
  })();

  return () => {
    cancelled = true;
    if (channel) supabase.removeChannel(channel);
  };
}
