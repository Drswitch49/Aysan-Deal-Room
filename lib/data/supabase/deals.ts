/**
 * Deals repository — typed CRUD over the consolidated `deals` table.
 */
import type { ZodType } from "zod";
import { SupabaseRepository } from "./base-repository.js";
import {
  dealSchema, createDealSchema, updateDealSchema,
  type Deal, type CreateDealInput, type UpdateDealInput, type DealStage,
} from "../../core/schemas/deal.js";
import type { Paginated } from "../../core/schemas/common.js";

export class DealsRepository extends SupabaseRepository<Deal, CreateDealInput, UpdateDealInput> {
  protected table = "deals";
  protected rowSchema = dealSchema as unknown as ZodType<Deal>;
  protected createSchema = createDealSchema as unknown as ZodType<CreateDealInput>;
  protected updateSchema = updateDealSchema as unknown as ZodType<UpdateDealInput>;
  protected filterableColumns = ["stage", "sector", "owner", "analyst"];

  /** Deals in a given lifecycle stage. */
  listByStage(stage: DealStage, limit = 50, offset = 0): Promise<Paginated<Deal>> {
    return this.list({ stage, limit, offset });
  }

  /**
   * Normalise a user search term for PostgREST's `.or()` grammar.
   *
   * That grammar is comma/parenthesis-delimited, so those characters in user
   * input would corrupt the filter (or error). Strip them, and the ilike
   * wildcards, rather than trying to escape them. Returns "" when nothing usable
   * remains, meaning "don't filter".
   */
  private searchTerm(search?: string): string {
    return (search ?? "").trim().replace(/[,()*%\\]/g, " ").trim();
  }

  /** OR-clause matching a term across the columns users actually search by. */
  private searchClause(term: string): string {
    return [
      `company_name.ilike.%${term}%`,
      `deal_name.ilike.%${term}%`,
      `ref_no.ilike.%${term}%`,
      `acp_ref_no.ilike.%${term}%`,
      `sector.ilike.%${term}%`,
    ].join(",");
  }

  /**
   * Paged list with optional full-text search and an explicit id set.
   *
   * The base list() can't serve the Deal Inbox any more: that page now spans
   * every lifecycle stage (~1.8k rows), so searching and starring have to
   * happen in the database rather than over one client-held page.
   *
   *  - `search` matches company/deal name, ref and sector, case-insensitively.
   *  - `ids` restricts to a set (the watchlist, whose membership lives client-side).
   *
   * Returns an exact `total` so callers can paginate without loading everything.
   */
  async search(params: {
    stage?: DealStage;
    search?: string;
    ids?: string[];
    limit?: number;
    offset?: number;
    orderBy?: string;
    ascending?: boolean;
  }): Promise<Paginated<Deal>> {
    const limit = Math.min(Math.max(Number(params.limit ?? 50), 1), 200);
    const offset = Math.max(Number(params.offset ?? 0), 0);

    // An empty id set means "nothing starred" — short-circuit, because .in("id", [])
    // is a query PostgREST rejects rather than an empty result.
    if (params.ids && params.ids.length === 0) {
      return { rows: [], total: 0, limit, offset };
    }

    let q = this.db.from("deals").select("*", { count: "exact" }).is("deleted_at", null);

    if (params.stage) q = q.eq("stage", params.stage);
    if (params.ids) q = q.in("id", params.ids);

    const term = this.searchTerm(params.search);
    if (term) q = q.or(this.searchClause(term));

    const orderBy = params.orderBy || "created_at";
    q = q.order(orderBy, { ascending: params.ascending === true }).range(offset, offset + limit - 1);

    const { data, error, count } = await q;
    if (error) throw new Error(`deals.search: ${error.message}`);
    return { rows: (data ?? []).map((d) => this.parseRow(d)), total: count ?? 0, limit, offset };
  }

  /**
   * Per-filter counts for the Deal Inbox pills, honouring the active search so
   * the pill numbers always describe what the list is actually showing.
   */
  async stageCountsMatching(search?: string): Promise<Record<DealStage, number> & { all: number }> {
    const stages: DealStage[] = ["inbox", "review", "active", "archived"];
    const term = this.searchTerm(search);

    const countFor = async (stage?: DealStage) => {
      let q = this.db.from("deals").select("*", { count: "exact", head: true }).is("deleted_at", null);
      if (stage) q = q.eq("stage", stage);
      if (term) q = q.or(this.searchClause(term));
      const { count, error } = await q;
      if (error) throw new Error(`deals.stageCountsMatching(${stage ?? "all"}): ${error.message}`);
      return count ?? 0;
    };

    const [all, inbox, review, active, archived] = await Promise.all([
      countFor(),
      ...stages.map((s) => countFor(s)),
    ]);
    return { all, inbox, review, active, archived };
  }

  /**
   * Deals with nobody in either the `owner` or `assigned_to` column, within the
   * given stage/search scope.
   *
   * Counted in the database rather than over the loaded page: the inbox now pages
   * through ~1.8k rows, so a client-side tally would only ever describe 25 of them.
   * Both columns are usually null, but a stray empty string exists too, hence the
   * null-or-empty test on each.
   */
  async unassignedCount(params: { stage?: DealStage; search?: string; ids?: string[] } = {}): Promise<number> {
    if (params.ids && params.ids.length === 0) return 0;

    let q = this.db.from("deals").select("*", { count: "exact", head: true }).is("deleted_at", null);
    if (params.stage) q = q.eq("stage", params.stage);
    if (params.ids) q = q.in("id", params.ids);

    const term = this.searchTerm(params.search);
    if (term) q = q.or(this.searchClause(term));

    q = q.or("owner.is.null,owner.eq.").or("assigned_to.is.null,assigned_to.eq.");

    const { count, error } = await q;
    if (error) throw new Error(`deals.unassignedCount: ${error.message}`);
    return count ?? 0;
  }

  /** Find a deal by any of its human refs (ACP ref, listing ref) or uuid. */
  async findByRef(ref: string): Promise<Deal | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
    if (isUuid) return this.findById(ref);
    const { data, error } = await this.db
      .from("deals")
      .select("*")
      .is("deleted_at", null)
      .or(`acp_ref_no.eq.${ref},ref_no.eq.${ref},deal_name.eq.${ref}`)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`deals.findByRef: ${error.message}`);
    return data ? this.parseRow(data) : null;
  }

  /** Count deals grouped by stage (dashboard). Uses per-stage count queries so it
   *  is not limited by the 1000-row select cap. */
  async stageCounts(): Promise<Record<DealStage, number>> {
    const counts = { inbox: 0, review: 0, active: 0, archived: 0 } as Record<DealStage, number>;
    await Promise.all(
      (Object.keys(counts) as DealStage[]).map(async (stage) => {
        const { count, error } = await this.db
          .from("deals")
          .select("*", { count: "exact", head: true })
          .is("deleted_at", null)
          .eq("stage", stage);
        if (error) throw new Error(`deals.stageCounts(${stage}): ${error.message}`);
        counts[stage] = count ?? 0;
      }),
    );
    return counts;
  }
}

export const dealsRepository = new DealsRepository();
