/**
 * Repository port — the storage-agnostic contract every entity data-access object
 * implements. The app depends on this interface, never on Supabase directly, so
 * storage concerns stay behind the seam.
 */
import type { ListQuery, Paginated } from "../../core/schemas/common.js";

export interface Repository<TRow, TCreate, TUpdate> {
  findById(id: string): Promise<TRow | null>;
  list(query?: Partial<ListQuery> & Record<string, unknown>): Promise<Paginated<TRow>>;
  create(input: TCreate): Promise<TRow>;
  update(id: string, patch: TUpdate): Promise<TRow>;
  /** Soft delete (sets deleted_at). */
  remove(id: string): Promise<void>;
}
