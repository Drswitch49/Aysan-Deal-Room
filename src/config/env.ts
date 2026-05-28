export type AppConfig = {
  airtableApiKey: string;
  airtableBaseId: string;
  pipelineTable: string;
  documentsTable: string;
  submissionTable: string;
  lenderRoomPassword: string;
};

export const config: AppConfig = {
  airtableApiKey: import.meta.env.VITE_AIRTABLE_API_KEY ?? "",
  airtableBaseId: import.meta.env.VITE_AIRTABLE_BASE_ID ?? "",
  pipelineTable: import.meta.env.VITE_AIRTABLE_PIPELINE_TABLE ?? "Active Pipeline",
  documentsTable: import.meta.env.VITE_AIRTABLE_DOCUMENTS_TABLE ?? "Documents",
  submissionTable: import.meta.env.VITE_AIRTABLE_SUBMISSION_TABLE ?? "Submission_Log",
  lenderRoomPassword: import.meta.env.VITE_LENDER_ROOM_PASSWORD ?? "",
};

export function getMissingRequiredConfig(): string[] {
  const missing: string[] = [];

  if (!config.airtableApiKey) missing.push("VITE_AIRTABLE_API_KEY");
  if (!config.airtableBaseId) missing.push("VITE_AIRTABLE_BASE_ID");
  if (!config.pipelineTable) missing.push("VITE_AIRTABLE_PIPELINE_TABLE");
  if (!config.documentsTable) missing.push("VITE_AIRTABLE_DOCUMENTS_TABLE");
  if (!config.submissionTable) missing.push("VITE_AIRTABLE_SUBMISSION_TABLE");

  return missing;
}
