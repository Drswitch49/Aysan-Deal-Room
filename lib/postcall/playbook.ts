/**
 * Post-call scorecard data access: the versioned Playbook config and the
 * per-deal controls Dami owns (institutional band, DSCR sanction).
 *
 * Kept out of the generic deal PATCH on purpose — the sanction gates LOI
 * readiness and broker figures, so only admins may set it, via these calls.
 */
import { z } from "zod";
import { adminClient } from "../data/supabase/client.js";
import { InternalError, NotFoundError } from "../core/errors.js";
import type { PlaybookConfig } from "../../src/lib/acp/postcallSpec.js";

/** Deal columns only the post-call controls may write (migration 0018). */
export const DEAL_CONTROL_COLUMNS = [
  "institutional_band_pct",
  "dscr_sanctioned_at",
  "dscr_sanctioned_by",
  "dscr_sanction_note",
] as const;

const pct = z.number().min(0).max(100).nullable();
const gbp = z.number().nullable();
const count = z.number().int().min(0).nullable();

export const newPlaybookVersionSchema = z
  .object({
    recurring_gate_pct: pct,
    ebitda_band_min_gbp: gbp,
    ebitda_band_max_gbp: gbp,
    concentration_largest_pct: pct,
    concentration_top3_pct: pct,
    accreditation_stay_months: count,
    manager_install_days: count,
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine(
    (c) => c.ebitda_band_min_gbp == null || c.ebitda_band_max_gbp == null || c.ebitda_band_min_gbp <= c.ebitda_band_max_gbp,
    { message: "ebitda_band_min_gbp must not exceed ebitda_band_max_gbp" },
  );
export type NewPlaybookVersion = z.infer<typeof newPlaybookVersionSchema>;

/** Every version, newest first. The first row is the one new runs use. */
export async function listPlaybookVersions(): Promise<PlaybookConfig[]> {
  const { data, error } = await adminClient().from("playbook_config").select("*").order("version", { ascending: false });
  if (error) throw new InternalError(`playbook_config.list: ${error.message}`);
  return (data ?? []) as PlaybookConfig[];
}

/** Insert a new version — the table is insert-only; nothing is edited in place. */
export async function createPlaybookVersion(input: NewPlaybookVersion, createdBy: string): Promise<PlaybookConfig> {
  const { data, error } = await adminClient()
    .from("playbook_config")
    .insert({ ...input, created_by: createdBy })
    .select("*")
    .single();
  if (error) throw new InternalError(`playbook_config.insert: ${error.message}`);
  return data as PlaybookConfig;
}

export interface DealControls {
  deal_id: string;
  institutional_band_pct: number | null;
  dscr_sanctioned_at: string | null;
  dscr_sanctioned_by: string | null;
  dscr_sanction_note: string | null;
}

export async function getDealControls(dealId: string): Promise<DealControls> {
  const { data, error } = await adminClient()
    .from("deals")
    .select(`id, ${DEAL_CONTROL_COLUMNS.join(", ")}`)
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new InternalError(`deals.controls: ${error.message}`);
  if (!data) throw new NotFoundError(`Deal ${dealId} not found`);
  const row = data as unknown as { id: string; institutional_band_pct: number | string | null; dscr_sanctioned_at: string | null; dscr_sanctioned_by: string | null; dscr_sanction_note: string | null };
  return {
    deal_id: row.id,
    institutional_band_pct: row.institutional_band_pct == null ? null : Number(row.institutional_band_pct),
    dscr_sanctioned_at: row.dscr_sanctioned_at ?? null,
    dscr_sanctioned_by: row.dscr_sanctioned_by ?? null,
    dscr_sanction_note: row.dscr_sanction_note ?? null,
  };
}

export const dealControlsPatchSchema = z
  .object({
    deal_id: z.string().uuid(),
    institutional_band_pct: pct.optional(),
    /** true records the sanction now; false withdraws it. */
    dscr_sanctioned: z.boolean().optional(),
    dscr_sanction_note: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type DealControlsPatch = z.infer<typeof dealControlsPatchSchema>;

export async function setDealControls(patch: DealControlsPatch, actor: string): Promise<DealControls> {
  const update: Record<string, unknown> = {};
  if (patch.institutional_band_pct !== undefined) update.institutional_band_pct = patch.institutional_band_pct;
  if (patch.dscr_sanctioned === true) {
    update.dscr_sanctioned_at = new Date().toISOString();
    update.dscr_sanctioned_by = actor;
    update.dscr_sanction_note = patch.dscr_sanction_note ?? null;
  } else if (patch.dscr_sanctioned === false) {
    update.dscr_sanctioned_at = null;
    update.dscr_sanctioned_by = null;
    update.dscr_sanction_note = null;
  }
  if (Object.keys(update).length) {
    const { error } = await adminClient().from("deals").update(update).eq("id", patch.deal_id).is("deleted_at", null);
    if (error) throw new InternalError(`deals.controls update: ${error.message}`);
  }
  return getDealControls(patch.deal_id);
}
