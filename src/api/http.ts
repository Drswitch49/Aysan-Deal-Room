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

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

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

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};

/** Standard paginated list shape returned by the new collection endpoints. */
export interface Paginated<T> {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
}
