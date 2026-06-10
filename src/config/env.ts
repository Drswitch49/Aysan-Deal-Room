export type AppConfig = {
  pipelineTable: string;
  documentsTable: string;
  submissionTable: string;
  lenderRoomPassword: string;
};

export const config: AppConfig = {
  pipelineTable: import.meta.env.VITE_AIRTABLE_PIPELINE_TABLE ?? "Active Pipeline",
  documentsTable: import.meta.env.VITE_AIRTABLE_DOCUMENTS_TABLE ?? "Documents",
  submissionTable: import.meta.env.VITE_AIRTABLE_SUBMISSION_TABLE ?? "Submission_Log",
  lenderRoomPassword: import.meta.env.VITE_LENDER_ROOM_PASSWORD ?? "",
};

export function getMissingRequiredConfig(): string[] {
  const missing: string[] = [];

  if (!config.pipelineTable) missing.push("VITE_AIRTABLE_PIPELINE_TABLE");
  if (!config.documentsTable) missing.push("VITE_AIRTABLE_DOCUMENTS_TABLE");
  if (!config.submissionTable) missing.push("VITE_AIRTABLE_SUBMISSION_TABLE");

  return missing;
}
