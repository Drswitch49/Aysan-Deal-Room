/**
 * Generic Supabase-backed repository. Entity repositories extend this and supply
 * a table name + zod schemas; it provides validated CRUD, soft-delete, and
 * paginated list with filtering.
 */
import type { ZodType } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "./client.js";
import { NotFoundError, InternalError, ValidationError } from "../../core/errors.js";
import type { ListQuery, Paginated } from "../../core/schemas/common.js";
import type { Repository } from "../ports/repository.js";

export abstract class SupabaseRepository<TRow, TCreate, TUpdate>
  implements Repository<TRow, TCreate, TUpdate>
{
  protected abstract table: string;
  protected abstract rowSchema: ZodType<TRow>;
  protected abstract createSchema: ZodType<TCreate>;
  protected abstract updateSchema: ZodType<TUpdate>;
  /** Columns allowed as equality filters in list(). */
  protected filterableColumns: string[] = [];

  protected get db(): SupabaseClient {
    return adminClient();
  }

  protected parseRow(data: unknown): TRow {
    const res = this.rowSchema.safeParse(data);
    if (!res.success) {
      throw new InternalError(`${this.table} row failed validation`, res.error.issues);
    }
    return res.data;
  }

  async findById(id: string): Promise<TRow | null> {
    const { data, error } = await this.db
      .from(this.table)
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new InternalError(`${this.table}.findById: ${error.message}`);
    return data ? this.parseRow(data) : null;
  }

  async list(query: Partial<ListQuery> & Record<string, unknown> = {}): Promise<Paginated<TRow>> {
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);
    const offset = Math.max(Number(query.offset ?? 0), 0);
    const orderBy = typeof query.orderBy === "string" ? query.orderBy : "created_at";
    const ascending = query.ascending === true || (query.ascending as unknown) === "true";

    let q = this.db
      .from(this.table)
      .select("*", { count: "exact" })
      .is("deleted_at", null);

    for (const col of this.filterableColumns) {
      if (query[col] != null) q = q.eq(col, query[col] as string);
    }

    q = q.order(orderBy, { ascending }).range(offset, offset + limit - 1);

    const { data, error, count } = await q;
    if (error) throw new InternalError(`${this.table}.list: ${error.message}`);
    return {
      rows: (data ?? []).map((d) => this.parseRow(d)),
      total: count ?? 0,
      limit,
      offset,
    };
  }

  async create(input: TCreate): Promise<TRow> {
    const parsed = this.createSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(`Invalid ${this.table} payload`, parsed.error.issues);
    const { data, error } = await this.db.from(this.table).insert(parsed.data as object).select("*").single();
    if (error) throw new InternalError(`${this.table}.create: ${error.message}`);
    return this.parseRow(data);
  }

  async update(id: string, patch: TUpdate): Promise<TRow> {
    const parsed = this.updateSchema.safeParse(patch);
    if (!parsed.success) throw new ValidationError(`Invalid ${this.table} patch`, parsed.error.issues);
    const { data, error } = await this.db
      .from(this.table)
      .update(parsed.data as object)
      .eq("id", id)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw new InternalError(`${this.table}.update: ${error.message}`);
    if (!data) throw new NotFoundError(`${this.table} ${id} not found`);
    return this.parseRow(data);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db
      .from(this.table)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new InternalError(`${this.table}.remove: ${error.message}`);
  }
}
