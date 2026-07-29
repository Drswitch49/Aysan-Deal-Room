/**
 * Read-state for lender chat threads (browser-local).
 *
 * Three components render an "unread" count off the same data — the sidebar
 * badge, the dashboard banner and the Messages inbox — and each used to inline
 * its own copy of the localStorage key lookup. They drifted, so a thread could
 * read as unread in one place and read in another, and nothing ever cleared the
 * badge unless you drilled all the way into a specific lender+deal thread.
 *
 * Read state is now the max of three watermarks:
 *   1. the per-thread marker  (admin_last_read_<lender>_<deal>)
 *   2. the legacy per-lender marker (admin_last_read_<lender>)
 *   3. a global "inbox read" watermark, set when the Messages page is opened
 *
 * (3) is what stops a message you have already looked at from resurfacing on
 * every sign-in, while still letting anything that arrives afterwards count as
 * new.
 */

const GLOBAL_KEY = "admin_messages_read_at";
const READ_EVENT = "acp:messages-read";

export type ReadableMessage = {
  lenderId?: string;
  dealId?: string;
  sender?: string;
  timestamp?: string;
};

function readTime(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const t = new Date(raw).getTime();
    return Number.isNaN(t) ? 0 : t;
  } catch {
    return 0; // private mode / storage disabled
  }
}

function writeTime(key: string): void {
  try {
    localStorage.setItem(key, new Date().toISOString());
  } catch {
    /* storage unavailable — unread state degrades to "always unread" */
  }
}

/** Messages the admin sent are never "unread" for the admin. */
export function isIncoming(msg: ReadableMessage): boolean {
  return (msg.sender ?? "").trim().toLowerCase() !== "admin";
}

/** Newest read watermark that applies to one lender+deal thread. */
export function lastReadAt(lenderId: string, dealId: string): number {
  return Math.max(
    readTime(`admin_last_read_${lenderId}_${dealId}`),
    readTime(`admin_last_read_${lenderId}`),
    readTime(GLOBAL_KEY),
  );
}

export function isUnread(msg: ReadableMessage): boolean {
  if (!isIncoming(msg)) return false;
  const at = new Date(msg.timestamp ?? "").getTime();
  if (Number.isNaN(at)) return false;
  return at > lastReadAt(msg.lenderId ?? "", msg.dealId ?? "");
}

/** Mark one lender+deal thread read (called when a thread is opened). */
export function markThreadRead(lenderId: string, dealId?: string): void {
  if (!lenderId) return;
  writeTime(`admin_last_read_${lenderId}`);
  if (dealId) writeTime(`admin_last_read_${lenderId}_${dealId}`);
  notifyRead();
}

/** Mark the whole inbox read — everything received up to now. */
export function markAllRead(): void {
  writeTime(GLOBAL_KEY);
  notifyRead();
}

/** Unread message count for one lender, across all of its deal threads. */
export function unreadForLender(lenderId: string, messages: ReadableMessage[]): number {
  return messages.filter((m) => m.lenderId === lenderId && isUnread(m)).length;
}

/** How many lenders have at least one unread message — the sidebar badge. */
export function countLendersWithUnread(
  lenders: Array<{ id: string }>,
  messages: ReadableMessage[],
): number {
  return lenders.filter((l) => messages.some((m) => m.lenderId === l.id && isUnread(m))).length;
}

/** Let other mounted components recompute immediately after a read. */
function notifyRead(): void {
  try {
    window.dispatchEvent(new Event(READ_EVENT));
  } catch {
    /* non-browser context */
  }
}

export function onMessagesRead(handler: () => void): () => void {
  window.addEventListener(READ_EVENT, handler);
  return () => window.removeEventListener(READ_EVENT, handler);
}
