/**
 * Investor Portal Document Standard v1.1 — the 11 documents, the 7 categories
 * and the capital gates that release them.
 *
 * Shared by the API (which enforces the gates on every partner read) and the
 * deal room (which shows staff NOT READY with the blocker named). The database
 * holds the same vocabulary as CHECK constraints
 * (supabase/migrations/0024_investor_document_standard.sql).
 *
 * Gates are capital gates. They are not waived for friends, family or keen
 * partners: if a gate is not met the document does not reach the partner, and
 * nobody drafts around it.
 */

// ─── Categories ────────────────────────────────────────────────────────────

export const DOC_CATEGORIES = [
  "certification",
  "offer",
  "legal",
  "ownership",
  "reporting",
  "distributions",
  "notices",
] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];

export const CATEGORY_INFO: Record<DocCategory, { n: number; label: string; question: string; download: boolean }> = {
  certification: { n: 1, label: "Certification", question: "Am I allowed to receive this?", download: true },
  offer: { n: 2, label: "Offer", question: "What was I shown before I decided?", download: false },
  legal: { n: 3, label: "Legal", question: "What have I signed?", download: true },
  ownership: { n: 4, label: "Ownership", question: "What do I own, and can I prove it?", download: true },
  reporting: { n: 5, label: "Reporting", question: "How is the business actually doing?", download: true },
  distributions: { n: 6, label: "Distributions", question: "Have I been paid, and why was it safe to pay?", download: true },
  notices: { n: 7, label: "Notices", question: "Has anything happened I must know about?", download: true },
};

// ─── Sign-offs (the written parts of a gate) ───────────────────────────────

export type SignoffOwner = "cfo" | "legal_counsel";

export const SIGNOFFS = {
  legal_counsel_approval: { label: "Legal counsel approval of this exact version", owner: "legal_counsel" },
  buyback_formula_sanction: { label: "CFO's written buyback formula sanction", owner: "cfo" },
  term_sheet_accepted: { label: "Term sheet accepted", owner: "legal_counsel" },
  agreements_executed: { label: "Agreements executed", owner: "legal_counsel" },
  shares_allotted: { label: "Shares allotted", owner: "cfo" },
  figures_certified: { label: "CFO certifies every figure", owner: "cfo" },
  board_resolution: { label: "Board resolution", owner: "cfo" },
  coverage_clears_floor: { label: "Coverage clears every ACP floor after payment", owner: "cfo" },
  no_lender_restriction: { label: "No lender restriction engaged", owner: "cfo" },
} as const satisfies Record<string, { label: string; owner: SignoffOwner }>;
export type SignoffKey = keyof typeof SIGNOFFS;

export const SIGNOFF_OWNER_LABEL: Record<SignoffOwner, string> = {
  cfo: "CFO",
  legal_counsel: "legal counsel",
};

export interface SignoffRecord {
  by: string;
  role: string;
  at: string;
  reference: string;
}

// ─── The 11 documents ──────────────────────────────────────────────────────

export const DOC_TYPES = [
  "onboarding_pack",
  "brief",
  "diligence_pack",
  "term_sheet",
  "legal_pack",
  "completion_statement",
  "share_certificate",
  "quarterly_report",
  "annual_statement",
  "distribution_notice",
  "partner_notice",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** "partner" = one partner's copy; "acquisition" = every partner in the deal. */
export type DocScope = "partner" | "acquisition" | "either";

export const DOC_TYPE_INFO: Record<
  DocType,
  { code: string; label: string; category: DocCategory; scope: DocScope; signoffs: SignoffKey[]; gateOwner: string }
> = {
  onboarding_pack: {
    code: "C1", label: "Onboarding and Certification Pack", category: "certification", scope: "partner",
    signoffs: [], gateOwner: "Managing Partner",
  },
  brief: {
    code: "O1", label: "Capital Partner Brief", category: "offer", scope: "partner",
    signoffs: ["legal_counsel_approval"], gateOwner: "CFO, legal counsel",
  },
  diligence_pack: {
    code: "O2", label: "Acquisition Memorandum and Diligence Pack", category: "offer", scope: "acquisition",
    signoffs: ["legal_counsel_approval"], gateOwner: "CFO, legal counsel",
  },
  term_sheet: {
    code: "O3", label: "Term Sheet", category: "offer", scope: "partner",
    signoffs: ["legal_counsel_approval", "buyback_formula_sanction"], gateOwner: "CFO, legal counsel",
  },
  legal_pack: {
    code: "L1", label: "Legal Pack and Partner Terms Summary", category: "legal", scope: "acquisition",
    signoffs: ["term_sheet_accepted", "agreements_executed"], gateOwner: "Legal counsel",
  },
  completion_statement: {
    code: "OW1", label: "Completion and Ownership Statement", category: "ownership", scope: "partner",
    signoffs: ["shares_allotted"], gateOwner: "CFO",
  },
  share_certificate: {
    code: "OW2", label: "Share Certificate", category: "ownership", scope: "partner",
    signoffs: ["shares_allotted"], gateOwner: "CFO",
  },
  quarterly_report: {
    code: "R1", label: "Quarterly Report", category: "reporting", scope: "acquisition",
    signoffs: ["figures_certified"], gateOwner: "Managing Partner, CFO",
  },
  annual_statement: {
    code: "R2", label: "Annual Statement", category: "reporting", scope: "partner",
    signoffs: ["figures_certified"], gateOwner: "Managing Partner, CFO",
  },
  distribution_notice: {
    code: "D1", label: "Distribution Notice and Voucher", category: "distributions", scope: "partner",
    signoffs: ["board_resolution", "coverage_clears_floor", "no_lender_restriction"], gateOwner: "CFO",
  },
  partner_notice: {
    code: "N1", label: "Partner Notice", category: "notices", scope: "either",
    signoffs: [], gateOwner: "Managing Partner",
  },
};

export const DOC_TYPES_BY_CATEGORY: Record<DocCategory, DocType[]> = Object.fromEntries(
  DOC_CATEGORIES.map((cat) => [cat, DOC_TYPES.filter((t) => DOC_TYPE_INFO[t].category === cat)]),
) as Record<DocCategory, DocType[]>;

export const NOTICE_TYPES = [
  "material_event",
  "deal_killed",
  "buyback_exercise",
  "buyback_outcome",
  "conversion",
  "recertification_due",
] as const;
export type NoticeType = (typeof NOTICE_TYPES)[number];

export const NOTICE_TYPE_LABEL: Record<NoticeType, string> = {
  material_event: "Material event",
  deal_killed: "Deal killed",
  buyback_exercise: "Buyback exercise",
  buyback_outcome: "Buyback outcome",
  conversion: "Conversion",
  recertification_due: "Recertification due",
};

export const LANE_LABEL: Record<1 | 2, string> = {
  1: "Lane 1 · Statutory compliance services",
  2: "Lane 2 · Regulated clinical services",
};

export const isDocType = (t: unknown): t is DocType => typeof t === "string" && (DOC_TYPES as readonly string[]).includes(t);

export function docTypeLabel(t: string, noticeType?: string | null): string {
  if (!isDocType(t)) return t.replace(/_/g, " ");
  const base = DOC_TYPE_INFO[t].label;
  return t === "partner_notice" && noticeType && noticeType in NOTICE_TYPE_LABEL
    ? `${base}: ${NOTICE_TYPE_LABEL[noticeType as NoticeType]}`
    : base;
}

/** "Acquisition 01" — the only name a document may carry for the deal. */
export const acquisitionLabel = (no: number | null | undefined): string | null =>
  no ? `Acquisition ${String(no).padStart(2, "0")}` : null;

/** Naming rule: Acquisition nn · Document name · YYYY-MM-DD · vn */
export function standardTitle(opts: {
  acquisitionNo: number | null | undefined;
  docType: DocType;
  noticeType?: string | null;
  date: Date;
  version: number;
}): string {
  const day = opts.date.toISOString().slice(0, 10);
  return [acquisitionLabel(opts.acquisitionNo) ?? "Acquisition", docTypeLabel(opts.docType, opts.noticeType), day, `v${opts.version}`].join(" · ");
}

// ─── Gates ─────────────────────────────────────────────────────────────────

export interface GateDoc {
  doc_type: string;
  notice_type?: string | null;
  event_date?: string | null;
  signoffs?: Record<string, SignoffRecord | undefined> | null;
  file_format?: string | null;
  cloudinary_public_id?: string | null;
  file_link?: string | null;
  published_at?: string | null;
}

export interface GateCommitment {
  investor_id: string;
  status: string;
  committed_pence: number;
  /** Settled capital paid in against this subscription, in pence. */
  paid_pence: number;
  is_test: boolean;
}

export interface GateDeal {
  dscr_status: string | null;
  commitments: GateCommitment[];
}

export interface GateResult {
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

const HELD = new Set(["completed", "converted", "bought_back"]);

/** Working days from a to b (a excluded, b included), Monday to Friday. */
export function workingDaysBetween(a: Date, b: Date): number {
  let days = 0;
  const d = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
  const end = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  while (d.getTime() < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days++;
  }
  return days;
}

/**
 * The deal-level gate for one document version: everything that does not
 * depend on which partner is reading. `includeTest` counts test subscriptions
 * too, and is only set when evaluating for a test partner.
 */
export function evaluateDealGate(doc: GateDoc, deal: GateDeal, opts: { includeTest?: boolean; now?: Date } = {}): GateResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!isDocType(doc.doc_type)) {
    return { ready: false, blockers: ["Not filed under one of the 7 categories"], warnings };
  }
  const info = DOC_TYPE_INFO[doc.doc_type];
  const commitments = deal.commitments.filter((c) => opts.includeTest || !c.is_test);

  if (!doc.cloudinary_public_id && !doc.file_link) blockers.push("No file attached");

  if (info.category === "offer") {
    if (doc.file_link && !doc.cloudinary_public_id) {
      blockers.push("Offer documents must be uploaded as a PDF, not linked, so each copy can be watermarked");
    } else if (doc.cloudinary_public_id && String(doc.file_format ?? "").toLowerCase() !== "pdf") {
      blockers.push("Offer documents must be a PDF so each copy can be watermarked");
    }
    if (deal.dscr_status === "breach") {
      blockers.push("Coverage is in breach, so there is no DSCR sanction to rely on (CFO)");
    } else if (deal.dscr_status !== "above_floor" && deal.dscr_status !== "watch") {
      blockers.push("CFO's written DSCR sanction has not been recorded (CFO)");
    }
  }

  if (info.category === "ownership") {
    if (commitments.length === 0) {
      blockers.push("No subscribing partners in this acquisition");
    } else {
      const unpaid = commitments.filter((c) => c.paid_pence < c.committed_pence).length;
      if (unpaid) {
        blockers.push(`Funds not yet received from ${unpaid} subscribing partner${unpaid === 1 ? "" : "s"} (CFO)`);
      }
    }
  }

  if (info.category === "reporting" && !commitments.some((c) => HELD.has(c.status))) {
    blockers.push("The acquisition has not completed");
  }

  if (doc.doc_type === "partner_notice") {
    if (!doc.notice_type) blockers.push("Choose the notice type");
    if (!doc.event_date) {
      blockers.push("Record the date of the triggering event");
    } else {
      const issued = doc.published_at ? new Date(doc.published_at) : (opts.now ?? new Date());
      if (workingDaysBetween(new Date(doc.event_date), issued) > 5) {
        warnings.push("More than 5 working days after the triggering event");
      }
    }
  }

  for (const key of info.signoffs) {
    if (!doc.signoffs?.[key]) {
      const s = SIGNOFFS[key];
      blockers.push(`${s.label} not recorded (${SIGNOFF_OWNER_LABEL[s.owner]})`);
    }
  }

  return { ready: blockers.length === 0, blockers, warnings };
}

/** The part of the gate that depends on the partner reading. */
export function evaluatePartnerGate(doc: GateDoc, partner: { certifiedNow: boolean }): string[] {
  if (isDocType(doc.doc_type) && DOC_TYPE_INFO[doc.doc_type].category === "offer" && !partner.certifiedNow) {
    return ["Partner's certification is not complete, or is older than 12 months"];
  }
  return [];
}

/**
 * A partner never sees a category until every category above it is complete
 * for them. Complete means:
 *   Certification — certified within the last 12 months (what C1 records);
 *   Offer         — O1, O2 and O3 all released to them;
 *   Legal         — L1 released;  Ownership — OW1 and OW2 released;
 *   Reporting     — at least one R1 released (reporting is recurring).
 * Notices are the one exception and are never held back: a deal-killed or
 * recertification notice must reach a partner at any stage.
 */
export function unlockedCategories(visibleDocTypes: Set<string>, certifiedNow: boolean): Set<DocCategory> {
  const open = new Set<DocCategory>(["certification", "notices"]);
  const complete: Record<string, boolean> = {
    certification: certifiedNow,
    offer: ["brief", "diligence_pack", "term_sheet"].every((t) => visibleDocTypes.has(t)),
    legal: visibleDocTypes.has("legal_pack"),
    ownership: visibleDocTypes.has("completion_statement") && visibleDocTypes.has("share_certificate"),
    reporting: visibleDocTypes.has("quarterly_report"),
  };
  const chain: DocCategory[] = ["certification", "offer", "legal", "ownership", "reporting", "distributions"];
  for (let i = 1; i < chain.length; i++) {
    if (!complete[chain[i - 1]]) break;
    open.add(chain[i]);
  }
  return open;
}
