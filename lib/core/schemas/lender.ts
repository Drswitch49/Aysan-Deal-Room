/** Lender domain schema. Legacy password hash is NEVER exposed to clients. */
import { z } from "zod";
import { auditFields } from "./common.js";

const s = z.string().nullable().optional();

export const lenderSchema = z.object({
  ...auditFields,
  lender_ref: s,
  name: s,
  company_name: s,
  contact_name: s,
  email: s,
  phone: s,
  portal_slug: s,
  nda_approved: z.boolean().nullable().optional(),
  criteria_pills: s,
  last_contact_date: s,
  auth_user_id: z.string().uuid().nullable().optional(),
  // legacy_password_hash intentionally omitted from the domain type (never returned).
});
export type Lender = z.infer<typeof lenderSchema>;

export const createLenderSchema = z.object({
  company_name: z.string().min(1),
  contact_name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  portal_slug: z.string().optional(),
  criteria_pills: z.string().optional(),
}).passthrough();
export type CreateLenderInput = z.infer<typeof createLenderSchema>;

export const updateLenderSchema = lenderSchema
  .partial()
  .omit({ id: true, created_at: true, updated_at: true });
export type UpdateLenderInput = z.infer<typeof updateLenderSchema>;
