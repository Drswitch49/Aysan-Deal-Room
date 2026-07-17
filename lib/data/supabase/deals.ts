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
