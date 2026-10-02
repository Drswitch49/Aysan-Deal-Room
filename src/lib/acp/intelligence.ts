/**
 * Deal Intelligence tab — section catalogue (Optimisation Brief v1.1, s4).
 *
 * Tab label INTELLIGENCE, after POST-CALL, sharing its run selector. Two
 * panes, 19 section cards in fixed order. Generation order: 2 to 10, then
 * BLUF (and Actions), then 12 to 19.
 */

export type SectionKey =
  | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10"
  | "11" | "12" | "13" | "14" | "15" | "16" | "17" | "18" | "19";

export type Pane = "brief" | "negotiation";

export interface SectionDef {
  key: SectionKey;
  title: string;
  pane: Pane;
  /** P-089 letter for the Negotiation Engine pane. */
  letter?: string;
  /** Partners only; never in an external export. */
  partnersOnly?: boolean;
  /** Regenerated from documents: a newer upload marks the card stale. */
  documentDependent?: boolean;
}

export const SECTIONS: SectionDef[] = [
  { key: "1", title: "BLUF", pane: "brief", documentDependent: true },
  { key: "2", title: "What the documents say", pane: "brief", documentDependent: true },
  { key: "3", title: "Findings · impact · red flags", pane: "brief", documentDependent: true },
  { key: "4", title: "Contradictions", pane: "brief", documentDependent: true },
  { key: "5", title: "Value creation · confidence", pane: "brief", documentDependent: true },
  { key: "6", title: "Order of work", pane: "brief" },
  { key: "7", title: "Maintainable EBITDA bridge (£k)", pane: "brief", documentDependent: true },
  { key: "8", title: "Structure · DSCR · EV", pane: "brief", partnersOnly: true, documentDependent: true },
  { key: "9", title: "Kill / Price / Condition", pane: "brief", documentDependent: true },
  { key: "10", title: "Power map", pane: "brief" },
  { key: "11", title: "Actions", pane: "brief" },
  { key: "12", title: "Diagnosis", pane: "negotiation", letter: "A" },
  { key: "13", title: "Interests map", pane: "negotiation", letter: "B" },
  { key: "14", title: "Techniques chosen", pane: "negotiation", letter: "C" },
  { key: "15", title: "Draft", pane: "negotiation", letter: "D" },
  { key: "16", title: "Technique map", pane: "negotiation", letter: "E" },
  { key: "17", title: "Gate check", pane: "negotiation", letter: "F" },
  { key: "18", title: "Verbal-only · second-call agenda", pane: "negotiation", letter: "G" },
  { key: "19", title: "Predicted replies · Negotiation Log row", pane: "negotiation", letter: "H · I" },
];

export const SECTION_BY_KEY = Object.fromEntries(SECTIONS.map((s) => [s.key, s])) as Record<SectionKey, SectionDef>;

export const BRIEF_KEYS: SectionKey[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10"];
export const SUMMARY_KEYS: SectionKey[] = ["1", "11"];
export const P089_KEYS: SectionKey[] = ["12", "13", "14", "15", "16", "17", "18", "19"];

/** Partner-level roles see every section. */
export const PARTNER_ROLES = ["owner", "managing_partner", "partner", "admin", "cfo", "super_admin"];
/** Everyone else (the fractional analyst) sees 1 to 9 and 11, minus partners-only 8. */
export const ANALYST_SECTIONS: SectionKey[] = ["1", "2", "3", "4", "5", "6", "7", "9", "11"];

export function visibleSections(role: string | null | undefined): SectionKey[] {
  const r = (role ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  return PARTNER_ROLES.includes(r) ? SECTIONS.map((s) => s.key) : ANALYST_SECTIONS;
}

/** An evidence chip on a card line. */
export type Tag = "FILED" | "MGMT" | "VERIFIED" | "VENDOR" | "ESTIMATED" | "ASSUMPTION" | "UNKNOWN";

/** Card body: bullets or a table, per the Part D contract. */
export interface SectionContent {
  bullets?: Array<{ text: string; tags?: Tag[] }>;
  table?: { columns: string[]; rows: string[][] };
  note?: string;
  /** Missing data renders as an open item, never invented. */
  open_items?: string[];
  evidence?: Array<{ tag: Tag; source: string }>;
}

export interface SectionCard {
  content: SectionContent;
  /** Structured data for the P-089 cards that render specially (15-17, 19). */
  data?: Record<string, unknown>;
  generated_at: string;
  edited?: boolean;
}

export interface SectionComment {
  section: SectionKey;
  by: string;
  at: string;
  text: string;
}

export interface IntelligenceRun {
  id: string;
  deal_id: string;
  run_id: string;
  sections: Partial<Record<SectionKey, SectionCard>>;
  locked_sections: SectionKey[];
  stale_sections: SectionKey[];
  comments: SectionComment[];
  prompt_versions: Record<string, string>;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  generated_at: string | null;
  created_at: string;
}
