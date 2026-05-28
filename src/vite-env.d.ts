/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AIRTABLE_API_KEY?: string;
  readonly VITE_AIRTABLE_BASE_ID?: string;
  readonly VITE_AIRTABLE_PIPELINE_TABLE?: string;
  readonly VITE_AIRTABLE_DOCUMENTS_TABLE?: string;
  readonly VITE_AIRTABLE_SUBMISSION_TABLE?: string;
  readonly VITE_LENDER_ROOM_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
