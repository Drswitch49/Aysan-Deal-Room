export type AirtableFieldValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | string[]
  | number[]
  | { id?: string; url?: string; filename?: string; [key: string]: unknown }
  | Array<{ id?: string; url?: string; filename?: string; [key: string]: unknown }>;

export type AirtableRecord<TFields extends Record<string, AirtableFieldValue>> = {
  id: string;
  createdTime: string;
  fields: TFields;
};

export type AirtableListResponse<TFields extends Record<string, AirtableFieldValue>> = {
  records: Array<AirtableRecord<TFields>>;
  offset?: string;
};

export type RawAirtableFields = Record<string, AirtableFieldValue>;
