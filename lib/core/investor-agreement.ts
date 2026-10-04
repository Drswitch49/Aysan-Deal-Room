/**
 * The Investors Agreement a capital partner signs before their portal opens.
 *
 * Shared by the portal (which renders it and hashes what the partner saw) and
 * the API (which re-renders it from the submitted details, checks the hash and
 * stores the exact text alongside the signature). The two must produce the
 * same text byte for byte, so nothing here may depend on the runtime: no
 * locale formatting, no Intl, no time zone.
 *
 * Changing a single word of the body is a new version. Bump `version`, and every
 * partner is asked to sign again at their next sign-in.
 *
 * While `status` is "draft" the text still carries the template's blanks, so
 * only TEST partners are asked to sign it (to try the flow end to end). Real
 * partners are gated only once a solicitor-approved text is in and `status` is
 * "final".
 */

export const INVESTORS_AGREEMENT = {
  key: "investors_agreement",
  title: "Investors Agreement",
  version: 1,
  status: "draft" as "draft" | "final",
};

/** The sponsor's particulars. Blanks until the final text is approved. */
const SPONSOR = {
  name: "[YOUR FIRM NAME] LIMITED",
  companyNumber: "[Number]",
  address: "[Address]",
};

/** Does this partner have to sign the current version before entering? */
export const agreementRequired = (isTest: boolean): boolean =>
  INVESTORS_AGREEMENT.status === "final" || isTest;

export interface AgreementParty {
  /** The partner's full name. */
  name: string;
  /** Family office or company, if they invest through one. */
  entity: string | null;
  address: string;
  /** The indicative pledge, in pence. */
  pledgePence: number;
  /** The day the agreement is made, YYYY-MM-DD. */
  date: string;
}

export interface AgreementSection {
  heading: string;
  clauses: string[];
}

export interface AgreementDoc {
  title: string;
  preamble: string[];
  sections: AgreementSection[];
  closing: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-10-04" → "4 October 2026", without Intl so every runtime agrees. */
export function longDate(isoDay: string): string {
  const [y, m, d] = isoDay.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return isoDay;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** 10000000 → "£100,000"; pence are shown only when there are some. */
export function poundsText(pence: number): string {
  const whole = Math.floor(pence / 100);
  const rest = pence % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `£${grouped}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/** The investor as the agreement names them. */
export const investorPartyName = (p: Pick<AgreementParty, "name" | "entity">): string =>
  p.entity && p.entity.trim() ? `${p.name.trim()} (${p.entity.trim()})` : p.name.trim();

export function investorsAgreement(p: AgreementParty): AgreementDoc {
  return {
    title: "Investors Agreement",
    preamble: [
      `THIS AGREEMENT is made on ${longDate(p.date)}`,
      "BETWEEN:",
      `${SPONSOR.name}, a company incorporated in England and Wales under company number ${SPONSOR.companyNumber}, whose registered office is at ${SPONSOR.address} (the "Sponsor"); and`,
      `${investorPartyName(p)}, residing at or having its principal place of business at ${p.address.trim()} (the "Investor").`,
    ],
    sections: [
      {
        heading: "1. Purpose and thesis",
        clauses: [
          '1.1 The Sponsor is executing a disciplined "Buy-and-Build" acquisition strategy targeting independently cash-generating, CQC-registered private clinical wellness, physiotherapy, and diagnostics assets within the United Kingdom.',
          "1.2 The Sponsor intends to source off-market target acquisitions trading at inefficient multiples (typically 2.5x to 3.5x EBITDA), leveraging a combination of senior asset-based lending (ABL) and deferred Vendor Loan Notes (VLN) to minimize upfront equity requirements.",
        ],
      },
      {
        heading: "2. The indicative pledge",
        clauses: [
          `2.1 The Investor hereby registers an indicative, soft-commitment capital pledge of ${poundsText(p.pledgePence)} (the "Pledge Amount") for deployment into transactions sourced by the Sponsor that meet the Investment Criteria.`,
          "2.2 The Investor acknowledges that this Agreement does not constitute a legal obligation to fund or a blind-pool capital commitment. No capital shall be drawn or deposited into an escrow account until a specific target asset is secured under an executed Letter of Intent (LOI) and presented via a formal Deal Memorandum.",
        ],
      },
      {
        heading: "3. First right of refusal (ROFR)",
        clauses: [
          "3.1 In consideration for the Sponsor's allocation of time, research, and deal-sourcing overheads, the Sponsor grants the Investor a First Right of Refusal to review and invest in any qualified transaction sourced within the UK clinical wellness sector.",
          "3.2 Upon securing a target asset under an exclusivity framework, the Sponsor shall issue a detailed Deal Memorandum to the Investor, outlining the financials, debt breakdown, and exact equity gap requirement.",
          "3.3 The Investor shall have 10 business days from the receipt of the Deal Memorandum to either:",
          "(a) Exercise the ROFR: Elect to participate in the transaction up to their maximum Pledge Amount by signing a deal-specific Special Purpose Vehicle (SPV) Subscription Agreement.",
          "(b) Waive the ROFR: Decline participation in the specific transaction. In the event of a waiver, the Sponsor reserves the absolute right to present the equity allocation to alternative co-investors.",
        ],
      },
      {
        heading: "4. Structure and fees",
        clauses: [
          "4.1 Each successful acquisition will be housed in an independent, asset-specific Special Purpose Vehicle (SPV) corporate structure to insulate liabilities.",
          "4.2 Transactions successfully executed under this framework will be subject to a standard micro-M&A incentive model, to be fully detailed in the final SPV agreement:",
          "Acquisition/Deal Fee: [e.g., 2%] of the enterprise value upon deal close to cover transaction costs.",
          "Management/Oversight Fee: [e.g., 2%] per annum of gross revenues for operational centralization execution.",
          "Carried Interest: [e.g., 20%] performance hurdle over a [e.g., 8%] preferred return back to the Investor upon capital exit event.",
        ],
      },
      {
        heading: "5. Confidentiality",
        clauses: [
          "5.1 The Investor agrees to keep all information regarding sourced target assets, proprietary scraping methods, financial data, and clinic operations entirely confidential. This data may not be shared with third parties or used to execute direct or broker-led transactions outside of this Sponsor agreement.",
        ],
      },
    ],
    closing:
      "IN WITNESS WHEREOF, the Parties have executed this Agreement on the date first written above. The Investor signs electronically by typing their full name; the Sponsor countersigns on behalf of the Sponsor.",
  };
}

/**
 * The canonical text: what is hashed, stored with the signature and printed in
 * the signed copy. Headings and clauses one per line, sections separated by a
 * blank line.
 */
export function agreementText(doc: AgreementDoc): string {
  const blocks = [
    [doc.title.toUpperCase(), `Version ${INVESTORS_AGREEMENT.version}`].join("\n"),
    doc.preamble.join("\n"),
    ...doc.sections.map((s) => [s.heading.toUpperCase(), ...s.clauses].join("\n")),
    doc.closing,
  ];
  return blocks.join("\n\n");
}

/** Normalise a typed signature for storage: trimmed, single spaces. */
export const cleanSignature = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The ROFR response window: 10 business days from receipt (clause 3.3). */
export const ROFR_BUSINESS_DAYS = 10;

/**
 * England and Wales bank holidays (gov.uk), substitute days included. Extend
 * this list before the end of 2028.
 */
const BANK_HOLIDAYS = new Set([
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28",
  "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28",
  "2028-01-03", "2028-04-14", "2028-04-17", "2028-05-01", "2028-05-29", "2028-08-28", "2028-12-25", "2028-12-26",
]);

/** The day `n` business days after `from` (weekends and bank holidays skipped), as YYYY-MM-DD. */
export function addWorkingDays(from: Date, n: number): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !BANK_HOLIDAYS.has(d.toISOString().slice(0, 10))) added++;
  }
  return d.toISOString().slice(0, 10);
}
