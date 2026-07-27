/** Document domain schema (deal document checklist + AI extraction + Cloudinary file). */
import { z } from "zod";
import { auditFields } from "./common.js";

const s = z.string().nullable().optional();
const b = z.boolean().nullable().optional();

export const documentSchema = z.object({
  ...auditFields,
  deal_id: z.string().uuid().nullable().optional(),
  doc_key: s,
  document_name: s,
  category: s,
  abl_critical: b,
  status: s,
  source: s,
  date_received: s,
  expected_date: s,
  date_sent_to_lender: s,
  lender_target: s,
  document_access: s,
  internal_notes: s,
  cloudinary_public_id: s,
  file_url: s,
  legacy_drive_link: s,
  extracted_text: s,
  summary: s,
  risks: s,
  covenants: s,
  metrics: s,
  processing_status: s,
  processing_error: s,
  processing_started_at: s,
  processed_at: s,
});
export type Document = z.infer<typeof documentSchema>;

export const createDocumentSchema = z.object({
  deal_id: z.string().uuid().optional(),
  document_name: z.string().min(1),
  category: z.string().optional(),
  status: z.string().optional(),
  abl_critical: z.boolean().optional(),
  cloudinary_public_id: z.string().optional(),
  file_url: z.string().url().optional(),
}).passthrough();
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = documentSchema
  .partial()
  .omit({ id: true, created_at: true, updated_at: true });
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
