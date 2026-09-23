/**
 * Capital partner portal formatting (Build Pack Section 9.3).
 *
 * Money is stored as bigint pence and percentages as integer basis points, so
 * nothing in the money path is ever a float. These are the only functions that
 * turn either into text: a figure formatted anywhere else will drift from the
 * house style, and in this portal the style is part of the promise (en-GB,
 * "12 Aug 2026", "£250,000", pence shown only when non-zero).
 */

/**
 * Pence in, "£250,000" out. Renders "£0" rather than a blank.
 *
 * Pence are shown only when there are any, and then always as two digits.
 * A single minimumFractionDigits of 0 with a maximum of 2 renders 150050 as
 * "£1,500.5", which is not how money reads, so the choice is made per value.
 */
export const gbp = (pence: number | bigint | null | undefined): string => {
  const whole = Number(pence ?? 0);
  const digits = whole % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(whole / 100);
};

/** ISO or Date in, "12 Aug 2026" out. Empty string for nothing usable. */
export const formatDate = (value: string | Date | null | undefined): string => {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);
};

/** Basis points in, "12.5%" out. 6100 → "61%". */
export const pct = (bp: number | null | undefined): string => {
  if (bp === null || bp === undefined) return "";
  return `${(bp / 100).toFixed(1).replace(/\.0$/, "")}%`;
};

// ─── Coverage ──────────────────────────────────────────────────────────────

export type CoverageStatus = "above_floor" | "watch" | "breach" | "not_yet_reported";

/**
 * Coverage is a word, never a number. The ratio stays in the covenant
 * certificate, which is the only place it is certified — showing it here would
 * put an uncertified figure in front of a partner.
 */
export const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  above_floor: "Above floor",
  watch: "Watch",
  breach: "Breach",
  not_yet_reported: "Not yet reported",
};

export const COVERAGE_EXPLAINER: Record<CoverageStatus, string> = {
  above_floor: "Above floor: debt service coverage cleared the covenant floor at the last certified test.",
  watch:
    "Watch: coverage cleared the floor with limited headroom. Distributions are unlikely until headroom recovers.",
  breach:
    "Breach: coverage fell below the covenant floor. No distributions are permitted. The quarterly report explains the position and the actions under way.",
  not_yet_reported:
    "Not yet reported: the first certified coverage test follows the first full quarter after completion.",
};

export const COVERAGE_TONE: Record<CoverageStatus, string> = {
  above_floor: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  watch: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  breach: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  not_yet_reported: "border-white/10 bg-white/5 text-slate-400",
};

// ─── Provenance ────────────────────────────────────────────────────────────

export type Provenance = "verified" | "verified_ledger" | "cfo_certified" | "filed" | "pending";

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  verified: "Verified",
  verified_ledger: "Verified, ledger",
  cfo_certified: "CFO certified",
  filed: "Filed",
  pending: "Pending",
};

export const PROVENANCE_TOOLTIP: Record<Provenance, string> = {
  verified: "Verified: reconciled to bank or executed documents.",
  verified_ledger: "Verified, ledger: reconciled to the business's sales ledger and contract book.",
  cfo_certified: "CFO certified: signed off by the Group CFO.",
  filed: "Filed: taken from documents filed with Companies House or the lender.",
  pending: "Pending: not yet reported for this period.",
};

// ─── Amortisation ──────────────────────────────────────────────────────────

export const AMORT_LABEL: Record<string, string> = {
  not_started: "Not started",
  on_schedule: "On schedule",
  ahead: "Ahead",
  behind: "Behind",
};

// ─── Activity feed ─────────────────────────────────────────────────────────

/**
 * Render one activity line (Build Pack Section 18.1). An unknown event type
 * renders nothing rather than a raw key — the feed is partner-facing, and a
 * line nobody wrote on purpose does not belong in it.
 */
export function activityLine(eventType: string, payload: Record<string, any> = {}): string | null {
  const deal = payload.deal ? ` · ${payload.deal}` : "";
  switch (eventType) {
    case "call_settled":
      return `Capital call settled · ${gbp(payload.amount_pence)}${deal}`;
    case "distribution":
      return `Distribution declared · ${gbp(payload.amount_pence)}${deal}`;
    case "document_added":
      return `Document added · ${payload.title ?? "Document"}`;
    case "report_published":
      return `Quarterly report published · ${payload.period_label ?? ""}${deal}`.trim();
    case "completed":
      return `Acquisition completed${deal}`;
    case "converted":
      return `Holding converted to holdco shares${deal}`;
    case "bought_back":
      return `Holding bought back${deal}`;
    case "access_activated":
      return "Portal access activated";
    case "access_issued":
      return "Portal access issued";
    case "access_restored":
      return "Portal access restored";
    case "access_revoked":
      return "Portal access withdrawn";
    default:
      return null;
  }
}

// ─── Copy deck (Build Pack Appendix A) ─────────────────────────────────────

export const COPY = {
  footerRisk: "Private and confidential. Capital at risk. Figures are actuals; ACP publishes no forecasts.",
  loginNote: "Access is by invitation only. Private and confidential.",
  loginError: "Email or password not recognised.",
  loginRateLimit: "Too many attempts. Try again in 15 minutes.",
  sessionExpired: "Your session has ended. Please sign in again.",
  resetSent: "If that email has portal access, a reset link is on its way.",
  dashEmpty:
    "Your portfolio will appear here once your first acquisition completes. Commitments, capital calls, distributions and quarterly reports are recorded as they happen.",
  chartEmpty:
    "Distributions appear here when declared. Dividends are permitted with coverage headroom, never promised.",
  dealActuals: "Actuals only. Coverage numbers are in the quarterly report. Long-term ownership, no fund clock.",
  docsNote: "Documents open in a secure viewer. Each access is logged.",
  accountUpdate: "To update your details, email partnerships@aysancapital.com.",
  contact: "partnerships@aysancapital.com",
} as const;
