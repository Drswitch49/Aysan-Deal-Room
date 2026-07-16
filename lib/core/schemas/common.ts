/**
 * Shared zod primitives for domain schemas.
 * These schemas are the single source of type truth (types are inferred, not
 * hand-written) and validate data crossing the API boundary in both directions.
 */
import { z } from "zod";

export const uuid = z.string().uuid();
export const isoTimestamp = z.string().datetime({ offset: true });

/** Columns present on every soft-deletable, audited row. */
export const auditFields = {
  id: uuid,
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
};

/** Standard list query params accepted by repositories/endpoints. */
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  orderBy: z.string().optional(),
  ascending: z.coerce.boolean().default(false),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export interface Paginated<T> {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
}
