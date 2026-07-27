/**
 * Deal pipeline stage vocabulary (extracted from the deleted Airtable schema
 * module). These are the kanban/pipeline_stage labels — distinct from the
 * lifecycle enum (inbox/review/active/archived) on the deals table.
 */
export type DealStage =
  | "INTRO"
  | "DISCOVERY"
  | "LOI"
  | "DUE_DILIGENCE"
  | "CLOSING"
  | "PORTFOLIO"
  | "KILLED";

export const CANONICAL_STAGES: DealStage[] = [
  "INTRO",
  "DISCOVERY",
  "LOI",
  "DUE_DILIGENCE",
  "CLOSING",
  "PORTFOLIO",
];

/** Human-readable labels for display */
export const STAGE_LABELS: Record<DealStage, string> = {
  INTRO: "Intro",
  DISCOVERY: "Discovery",
  LOI: "LOI",
  DUE_DILIGENCE: "Due Diligence",
  CLOSING: "Closing",
  PORTFOLIO: "Portfolio",
  KILLED: "Killed",
};
