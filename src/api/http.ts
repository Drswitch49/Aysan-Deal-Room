/**
 * Typed HTTP wrapper for the rebuilt REST API (Phase 6).
 *
 * The new handlers wrap success payloads as { data } and errors as
 * { error: { code, message } } — this unwraps both and throws readable errors.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Session re-validation, de-duplicated across concurrent callers.
 *
 * /api/auth/session verifies the access cookie and, when it has expired,
 * transparently rotates the session off the refresh cookie and re-issues both.
 * Hitting it is therefore the cheapest way to turn a 401 into a working
 * session without bouncing the user back to the login screen.
 */
let sessionCheck: Promise<boolean> | null = null;

function revalidateSession(): Promise<boolean> {
  if (!sessionCheck) {
    const pending = fetch("/api/auth/session", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => Boolean(data?.authenticated))
      .catch(() => false);
    sessionCheck = pending;
    void pending.finally(() => {
      if (sessionCheck === pending) sessionCheck = null;
    });
  }
  return sessionCheck;
}

async function request<T>(method: string, url: string, body?: unknown, allowRetry = true): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // Never let a heuristically-cached response stand in for a live read — an
    // API GET carries no cache headers, so browsers are free to reuse one.
    cache: "no-store",
  });

  // A 401 immediately after sign-in means this request raced the session (or
  // the access token just aged out). Re-validate once and replay rather than
  // surfacing "Failed to load …" and making the user reload the page.
  if (res.status === 401 && allowRetry) {
    if (await revalidateSession()) return request<T>(method, url, body, false);
  }

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (!res.ok) {
    const err = payload?.error;
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? payload?.error ?? `Request failed (${res.status})`);
  }
  // New handlers wrap in { data }; legacy/flat endpoints (auth) don't.
  return (payload && typeof payload === "object" && "data" in payload ? payload.data : payload) as T;
}

/**
 * GET response cache — makes navigation snappy without a data-layer rewrite.
 *
 * Two mechanisms:
 *  1. In-flight de-duplication: concurrent GETs for the same URL share one
 *     request. This alone collapses the redundant getDealByRef() fan-out that
 *     a single deal-detail view triggers (deal + documents + submissions).
 *  2. Short TTL cache: a repeat GET within TTL is served from memory, so
 *     switching between pages and back is instant.
 *
 * Any mutation (POST/PATCH/DELETE) clears the whole cache, so edits/creates/
 * deletes are reflected immediately. Pass { noCache: true } to force a fresh
 * read (used by explicit "refresh" actions). Polling loops use raw fetch(),
 * so they are unaffected.
 */
const GET_TTL_MS = 15_000;
const getCache = new Map<string, { at: number; value: unknown }>();
const getInflight = new Map<string, Promise<unknown>>();

export function clearApiCache(): void {
  getCache.clear();
  getInflight.clear();
}

function cachedGet<T>(url: string, opts?: { noCache?: boolean }): Promise<T> {
  if (!opts?.noCache) {
    const hit = getCache.get(url);
    if (hit && Date.now() - hit.at < GET_TTL_MS) return Promise.resolve(hit.value as T);
    const pending = getInflight.get(url);
    if (pending) return pending as Promise<T>;
  }

  const p = request<T>("GET", url)
    .then((value) => {
      getCache.set(url, { at: Date.now(), value });
      getInflight.delete(url);
      return value;
    })
    .catch((err) => {
      getInflight.delete(url);
      throw err;
    });

  if (!opts?.noCache) getInflight.set(url, p);
  return p;
}

function mutate<T>(method: string, url: string, body?: unknown): Promise<T> {
  return request<T>(method, url, body).then((r) => {
    clearApiCache(); // invalidate reads so writes are seen immediately
    return r;
  });
}

export const api = {
  get: <T>(url: string, opts?: { noCache?: boolean }) => cachedGet<T>(url, opts),
  post: <T>(url: string, body?: unknown) => mutate<T>("POST", url, body),
  patch: <T>(url: string, body?: unknown) => mutate<T>("PATCH", url, body),
  del: <T>(url: string) => mutate<T>("DELETE", url),
};

/** Standard paginated list shape returned by the new collection endpoints. */
export interface Paginated<T> {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
}
