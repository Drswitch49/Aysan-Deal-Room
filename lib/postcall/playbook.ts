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
import { LANES, WBS_SUBSECTORS, laneFromDeal, laneToDeal, type Lane, type WbsSubsector } from "../../src/lib/acp/wbsSpec.js";

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

/** Every version, newest first. The first row per lane is the one new runs use. */
export async function listPlaybookVersions(lane?: Lane): Promise<PlaybookConfig[]> {
  let q = adminClient().from("playbook_config").select("*").order("version", { ascending: false });
  if (lane) q = q.eq("lane", lane);
  const { data, error } = await q;
  if (error) throw new InternalError(`playbook_config.list: ${error.message}`);
  return (data ?? []) as PlaybookConfig[];
}

/** The config new runs in `lane` score against: its newest version. */
export async function latestPlaybookVersion(lane: Lane): Promise<PlaybookConfig | null> {
  const { data, error } = await adminClient()
    .from("playbook_config").select("*").eq("lane", lane).order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new InternalError(`playbook_config.latest: ${error.message}`);
  return (data as PlaybookConfig | null) ?? null;
}

/** Insert a new version — the table is insert-only; nothing is edited in place. */
export async function createPlaybookVersion(input: NewPlaybookVersion, createdBy: string): Promise<PlaybookConfig> {
  const { data, error } = await adminClient()
    .from("playbook_config")
    .insert({ ...input, lane: "lane_1_cfs", created_by: createdBy })
    .select("*")
    .single();
  if (error) throw new InternalError(`playbook_config.insert: ${error.message}`);
  return data as PlaybookConfig;
}

// ─── Lane 2 · WBS config ───────────────────────────────────────────────────
const linear = z.object({ full: z.number().nullable(), zero: z.number().nullable() }).strict();

export const wbsConfigSchema = z
  .object({
    lane: z.literal("lane_2_wbs"),
    thresholds: z.object({
      metrics: z.record(z.string(), linear),
      h7_practitioner_max_pct: pct,
      h7_payer_max_pct: pct,
      h3_conditions: z.array(z.string().trim().min(1).max(500)).max(10),
    }).strict(),
    weights: z.object({ D1: count, D2: count, D3: count, D4: count, D5: count, D6: count, D7: count }).strict()
      .refine((w) => Object.values(w).reduce<number>((s, v) => s + (v ?? 0), 0) === 100, { message: "D1-D7 weights must sum to 100" }),
    notes: z.string().max(2000).nullable().optional(),
    /** Sign while saving: records the signer and time on the new version. */
    sign: z.boolean().optional(),
  })
  .strict();
export type WbsConfigInput = z.infer<typeof wbsConfigSchema>;

export async function createWbsConfigVersion(input: WbsConfigInput, actor: string): Promise<PlaybookConfig> {
  const { sign, ...rest } = input;
  const { data, error } = await adminClient()
    .from("playbook_config")
    .insert({
      ...rest,
      created_by: actor,
      signed_by: sign ? actor : null,
      signed_at: sign ? new Date().toISOString() : null,
    })
    .select("*")
    .single();
  if (error) throw new InternalError(`playbook_config.insert (wbs): ${error.message}`);
  return data as PlaybookConfig;
}

/**
 * Sign a config. The table is insert-only, so signing writes a new version
 * with the same values plus the signer: every run keeps pointing at the
 * exact (unsigned or signed) version it was scored against.
 */
export async function signPlaybookVersion(version: number, actor: string): Promise<PlaybookConfig> {
  const { data: src, error } = await adminClient().from("playbook_config").select("*").eq("version", version).maybeSingle();
  if (error) throw new InternalError(`playbook_config.sign: ${error.message}`);
  if (!src) throw new NotFoundError(`Playbook config version ${version} not found`);
  const { version: _v, created_at: _c, created_by: _b, signed_by: _sb, signed_at: _sa, ...values } = src as Record<string, unknown>;
  const { data, error: insErr } = await adminClient()
    .from("playbook_config")
    .insert({ ...values, notes: `Signed copy of v${version}${src.notes ? `: ${src.notes}` : ""}`, created_by: actor, signed_by: actor, signed_at: new Date().toISOString() })
    .select("*")
    .single();
  if (insErr) throw new InternalError(`playbook_config.sign insert: ${insErr.message}`);
  return data as PlaybookConfig;
}

export interface DealControls {
  deal_id: string;
  institutional_band_pct: number | null;
  dscr_sanctioned_at: string | null;
  dscr_sanctioned_by: string | null;
  dscr_sanction_note: string | null;
  lane: Lane;
  wbs_subsector: WbsSubsector | null;
  distance_rm11_miles: number | null;
}

export async function getDealControls(dealId: string): Promise<DealControls> {
  const { data, error } = await adminClient()
    .from("deals")
    .select(`id, ${DEAL_CONTROL_COLUMNS.join(", ")}, lane, wbs_subsector, distance_rm11_miles`)
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new InternalError(`deals.controls: ${error.message}`);
  if (!data) throw new NotFoundError(`Deal ${dealId} not found`);
  const row = data as unknown as {
    id: string; institutional_band_pct: number | string | null; dscr_sanctioned_at: string | null; dscr_sanctioned_by: string | null;
    dscr_sanction_note: string | null; lane: number | null; wbs_subsector: WbsSubsector | null; distance_rm11_miles: number | string | null;
  };
  return {
    deal_id: row.id,
    institutional_band_pct: row.institutional_band_pct == null ? null : Number(row.institutional_band_pct),
    dscr_sanctioned_at: row.dscr_sanctioned_at ?? null,
    dscr_sanctioned_by: row.dscr_sanctioned_by ?? null,
    dscr_sanction_note: row.dscr_sanction_note ?? null,
    lane: laneFromDeal(row.lane),
    wbs_subsector: row.wbs_subsector ?? null,
    distance_rm11_miles: row.distance_rm11_miles == null ? null : Number(row.distance_rm11_miles),
  };
}

export const dealControlsPatchSchema = z
  .object({
    deal_id: z.string().uuid(),
    institutional_band_pct: pct.optional(),
    /** true records the sanction now; false withdraws it. */
    dscr_sanctioned: z.boolean().optional(),
    dscr_sanction_note: z.string().max(2000).nullable().optional(),
    lane: z.enum(LANES).optional(),
    wbs_subsector: z.enum(WBS_SUBSECTORS).nullable().optional(),
    distance_rm11_miles: z.number().min(0).nullable().optional(),
  })
  .strict();
export type DealControlsPatch = z.infer<typeof dealControlsPatchSchema>;

export async function setDealControls(patch: DealControlsPatch, actor: string): Promise<DealControls> {
  const update: Record<string, unknown> = {};
  if (patch.institutional_band_pct !== undefined) update.institutional_band_pct = patch.institutional_band_pct;
  if (patch.lane !== undefined) {
    update.lane = laneToDeal(patch.lane);
    // A sub-sector only means something in Lane 2.
    if (patch.lane === "lane_1_cfs") update.wbs_subsector = null;
  }
  if (patch.wbs_subsector !== undefined && patch.lane !== "lane_1_cfs") update.wbs_subsector = patch.wbs_subsector;
  if (patch.distance_rm11_miles !== undefined) update.distance_rm11_miles = patch.distance_rm11_miles;
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
