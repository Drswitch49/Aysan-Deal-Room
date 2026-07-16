/**
 * Deal domain schema — the consolidated deals table (Airtable Deal_Inbox +
 * Review_Queue + Active_Pipeline + Archive collapsed into one row + stage enum).
 */
import { z } from "zod";
import { auditFields } from "./common.js";

export const DEAL_STAGES = ["inbox", "review", "active", "archived"] as const;
export const dealStageSchema = z.enum(DEAL_STAGES);
export type DealStage = z.infer<typeof dealStageSchema>;

const nullableStr = z.string().nullable().optional();
const nullableNum = z.number().nullable().optional();

/** Full deal row as stored/returned. */
export const dealSchema = z.object({
  ...auditFields,
  stage: dealStageSchema,

  ref_no: nullableStr,
  acp_ref_no: nullableStr,
  deal_name: nullableStr,
  company_name: nullableStr,
  project_name: nullableStr,

  sector: nullableStr,
  industry: nullableStr,
  source: nullableStr,
  deal_type: nullableStr,
  status: nullableStr,
  ai_verdict: nullableStr,

  broker: nullableStr,
  contact_email: nullableStr,
  contact_phone: nullableStr,
  website: nullableStr,
  listing_link: nullableStr,
  deal_files_url: nullableStr,
  deal_files_secure_url: nullableStr,
  location: nullableStr,

  turnover: nullableNum,
  ebitda_gbp: nullableNum,
  asking_price_gbp: nullableNum,
  enterprise_value: nullableNum,

  business_description: nullableStr,
  executive_summary: nullableStr,
  internal_notes: nullableStr,
  one_line_reason: nullableStr,
  lender_executive_summary: nullableStr,
  investment_highlights: nullableStr,
  acquisition_rationale: nullableStr,
  claude_verdict: nullableStr,

  total_score: nullableNum,
  dscr_proxy: nullableNum,
  dscr_score: nullableNum,

  pipeline_stage: nullableStr,
  next_action: nullableStr,
  next_action_date: nullableStr,
  owner: nullableStr,
  analyst: nullableStr,
  assigned_to: nullableStr,

  partner_review: nullableStr,
  kill_reason_select: nullableStr,
  kill_reason_text: nullableStr,
  killed_by: nullableStr,
  kill_date: nullableStr,
});
export type Deal = z.infer<typeof dealSchema>;

/** Fields a client may set when creating a deal (server assigns id/stage/timestamps). */
export const createDealSchema = z.object({
  deal_name: z.string().min(1),
  stage: dealStageSchema.default("inbox"),
  company_name: z.string().optional(),
  sector: z.string().optional(),
  broker: z.string().optional(),
  contact_email: z.string().email().optional(),
  ebitda_gbp: z.number().optional(),
  asking_price_gbp: z.number().optional(),
  executive_summary: z.string().optional(),
}).passthrough();
export type CreateDealInput = z.infer<typeof createDealSchema>;

/** Partial update — any deal column may be patched. */
export const updateDealSchema = dealSchema
  .partial()
  .omit({ id: true, created_at: true, updated_at: true });
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
