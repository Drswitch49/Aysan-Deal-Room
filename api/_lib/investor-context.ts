/**
 * Capital partner session context — the single place a partner's identity is
 * resolved, and therefore the single place rules R2 and R3 are enforced.
 *
 * In the Build Pack this is `current_investor_id()` in Postgres, filtering
 * every whitelist view. This app reaches the database with the service-role key
 * (api/_lib/handler.ts), so that function could never resolve; the same job is
 * done here instead. The rules it carries over exactly:
 *
 *   · the investor id comes from the verified session's app_metadata, never
 *     from a query parameter, body field or path segment;
 *   · a partner whose login_mode is not full or read_only resolves to nothing,
 *     so revocation bites on the next request rather than when the access token
 *     finally expires (acceptance Test 15);
 *   · a passed or ended investor resolves to nothing;
 *   · staff may inspect a named partner, and only staff.
 *
 * Every portal read then filters on `investorId` from here. Nothing else in the
 * portal may take an investor id from the request.
 */
import type { UserContext } from "./authz.js";
import { ALL_STAFF } from "./authz.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/core/errors.js";
import { adminClient } from "../../lib/data/supabase/client.js";

export interface InvestorScope {
  investorId: string;
  name: string;
  email: string;
  status: string;
  loginMode: string;
  /** True only while certification is valid AND signed within 12 months. */
  certifiedNow: boolean;
  certificationStatus: string;
  certificationDate: string | null;
  /** read_only partners keep their history but lose every action. */
  readOnly: boolean;
  readOnlyUntil: string | null;
  termsVersion: number | null;
  termsAcceptedAt: string | null;
  /** True when staff are inspecting this partner rather than the partner. */
  viewedByStaff: boolean;
}

const ACTIVE_LOGIN_MODES = new Set(["full", "read_only"]);
const DEAD_STATUSES = new Set(["passed", "ended"]);

/**
 * Resolve the partner this request may read. Throws rather than returning null
 * so a forgotten check can never fall through to an unscoped query.
 */
export async function resolveInvestorScope(
  user: UserContext | null,
  requestedInvestorId?: string,
): Promise<InvestorScope> {
  if (!user) throw new UnauthorizedError();

  let investorId: string | null = null;
  let viewedByStaff = false;

  if (user.role === "investor") {
    investorId = user.investorId ?? null;
  } else if (ALL_STAFF.includes(user.role)) {
    investorId = requestedInvestorId ?? null;
    viewedByStaff = true;
  }
  if (!investorId) throw new ForbiddenError("No capital partner scope available for this session");

  const { data, error } = await adminClient()
    .from("investors")
    .select(
      "id, name, email, status, certification_status, certification_date, investor_auth_map(login_mode, read_only_until, terms_version, terms_accepted_at)",
    )
    .eq("id", investorId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new ForbiddenError("Capital partner record unavailable");
  if (!data) throw new ForbiddenError("Capital partner record not found");

  // Supabase returns an embedded one-to-one as an object or a one-element array
  // depending on how it infers the relationship; normalise both.
  const rawMap = (data as any).investor_auth_map;
  const map = Array.isArray(rawMap) ? rawMap[0] : rawMap;
  const loginMode = String(map?.login_mode ?? "none");

  // A partner must clear both gates. Staff inspecting a revoked partner is a
  // legitimate admin view, so the gate only refuses the partner themselves.
  if (!viewedByStaff) {
    if (DEAD_STATUSES.has(String(data.status))) throw new ForbiddenError("Portal access has ended");
    if (!ACTIVE_LOGIN_MODES.has(loginMode)) throw new ForbiddenError("Portal access is not active");
  }

  return {
    investorId: data.id,
    name: data.name,
    email: data.email,
    status: String(data.status),
    loginMode,
    certifiedNow: isCertifiedNow(data.certification_status, data.certification_date),
    certificationStatus: String(data.certification_status),
    certificationDate: data.certification_date ?? null,
    readOnly: loginMode === "read_only",
    readOnlyUntil: map?.read_only_until ?? null,
    termsVersion: map?.terms_version ?? null,
    termsAcceptedAt: map?.terms_accepted_at ?? null,
    viewedByStaff,
  };
}

/**
 * Certification valid and signed within the last 12 months (rule R6).
 *
 * Mirrors is_certified_now() in the migration deliberately: the database is the
 * enforcement point for writes, this is the read-path answer for screens, and
 * the two must agree. Checked live on every read, not cached at issue time —
 * a certification that lapses while the partner is on the page closes the door
 * on their next request (acceptance Test 12).
 */
export function isCertifiedNow(status: unknown, date: unknown): boolean {
  if (String(status ?? "") !== "valid") return false;
  if (!date) return false;
  const signed = new Date(String(date));
  if (Number.isNaN(signed.getTime())) return false;
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  return signed > twelveMonthsAgo;
}

/** Record a portal access event. Best effort: never fails the request. */
export async function logAccess(
  event: "login" | "mfa_verified" | "mfa_failed" | "doc_open" | "offer_view" | "signout",
  opts: { investorId?: string | null; authUid?: string | null; documentId?: string | null; req?: any },
): Promise<void> {
  const headers = opts.req?.headers ?? {};
  const pick = (v: unknown) => (Array.isArray(v) ? v[0] : typeof v === "string" ? v : undefined);
  const forwarded = pick(headers["x-forwarded-for"]);
  await adminClient()
    .from("access_log")
    .insert({
      investor_id: opts.investorId ?? null,
      auth_uid: opts.authUid ?? null,
      event,
      document_id: opts.documentId ?? null,
      ip: forwarded ? forwarded.split(",")[0].trim() : null,
      user_agent: pick(headers["user-agent"]) ?? null,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}
