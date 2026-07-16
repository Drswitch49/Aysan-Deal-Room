/**
 * Central repository registry. The API layer imports `repositories` and never
 * touches Supabase directly.
 *
 * Core entities (deal, document, lender, profile) have strict zod schemas.
 * Secondary tables use a permissive row schema (audit fields + passthrough) so
 * CRUD is available immediately; tighten them into full schemas as endpoints
 * that consume them are built.
 */
import { z, type ZodType } from "zod";
import { SupabaseRepository } from "./base-repository.js";
import { auditFields } from "../../core/schemas/common.js";

import {
  documentSchema, createDocumentSchema, updateDocumentSchema,
  type Document, type CreateDocumentInput, type UpdateDocumentInput,
} from "../../core/schemas/document.js";
import {
  lenderSchema, createLenderSchema, updateLenderSchema,
  type Lender, type CreateLenderInput, type UpdateLenderInput,
} from "../../core/schemas/lender.js";
import {
  profileSchema, createProfileSchema, updateProfileSchema,
  type Profile, type CreateProfileInput, type UpdateProfileInput,
} from "../../core/schemas/profile.js";

import { DealsRepository } from "./deals.js";

// ─── Core entity repositories ──────────────────────────────────────────────
class DocumentsRepository extends SupabaseRepository<Document, CreateDocumentInput, UpdateDocumentInput> {
  protected table = "documents";
  protected rowSchema = documentSchema as unknown as ZodType<Document>;
  protected createSchema = createDocumentSchema as unknown as ZodType<CreateDocumentInput>;
  protected updateSchema = updateDocumentSchema as unknown as ZodType<UpdateDocumentInput>;
  protected filterableColumns = ["deal_id", "category", "status", "lender_target"];
}

class LendersRepository extends SupabaseRepository<Lender, CreateLenderInput, UpdateLenderInput> {
  protected table = "lenders";
  protected rowSchema = lenderSchema as unknown as ZodType<Lender>;
  protected createSchema = createLenderSchema as unknown as ZodType<CreateLenderInput>;
  protected updateSchema = updateLenderSchema as unknown as ZodType<UpdateLenderInput>;
  protected filterableColumns = ["portal_slug", "nda_approved"];
}

class ProfilesRepository extends SupabaseRepository<Profile, CreateProfileInput, UpdateProfileInput> {
  protected table = "profiles";
  protected rowSchema = profileSchema as unknown as ZodType<Profile>;
  protected createSchema = createProfileSchema as unknown as ZodType<CreateProfileInput>;
  protected updateSchema = updateProfileSchema as unknown as ZodType<UpdateProfileInput>;
  protected filterableColumns = ["role", "status", "email"];
}

// ─── Loose repositories for secondary tables ───────────────────────────────
type LooseRow = { id: string } & Record<string, unknown>;
const looseRowSchema = z.object({ ...auditFields }).passthrough() as unknown as ZodType<LooseRow>;
const looseWriteSchema = z.record(z.string(), z.unknown()) as unknown as ZodType<Record<string, unknown>>;

class LooseRepository extends SupabaseRepository<LooseRow, Record<string, unknown>, Record<string, unknown>> {
  protected rowSchema = looseRowSchema;
  protected createSchema = looseWriteSchema;
  protected updateSchema = looseWriteSchema;
  constructor(
    protected table: string,
    protected filterableColumns: string[] = [],
  ) {
    super();
  }
}

// ─── Registry ──────────────────────────────────────────────────────────────
export const repositories = {
  deals: new DealsRepository(),
  documents: new DocumentsRepository(),
  lenders: new LendersRepository(),
  profiles: new ProfilesRepository(),

  imReviewDocuments: new LooseRepository("im_review_documents", ["deal_id"]),
  submissionLog: new LooseRepository("submission_log", ["deal_id"]),
  lenderDealAssignments: new LooseRepository("lender_deal_assignments", ["deal_id", "lender_id"]),
  shareholderDealAssignments: new LooseRepository("shareholder_deal_assignments", ["deal_id", "shareholder_id"]),
  chatMessages: new LooseRepository("chat_messages", ["deal_id", "lender_id"]),
  dealNotes: new LooseRepository("deal_notes", ["deal_id"]),
  dealStageHistory: new LooseRepository("deal_stage_history", ["deal_id"]),
  transcriptAnalyses: new LooseRepository("transcript_analyses", ["deal_id"]),
  precallBriefs: new LooseRepository("precall_briefs", ["deal_id"]),
  postcallBriefs: new LooseRepository("postcall_briefs", ["deal_id"]),
  acpTeam: new LooseRepository("acp_team", ["status"]),
  hiringBriefs: new LooseRepository("hiring_briefs", []),
  externalStakeholders: new LooseRepository("external_stakeholders", ["status", "type"]),
  shareholders: new LooseRepository("shareholders", ["status"]),
  portfolioCompanies: new LooseRepository("portfolio_companies", ["status"]),
  portfolioMetrics: new LooseRepository("portfolio_metrics", ["company_id"]),
  portfolioAlerts: new LooseRepository("portfolio_alerts", ["company_id", "severity"]),
  portfolioHealth: new LooseRepository("portfolio_health", ["company_id"]),
  auditLogs: new LooseRepository("audit_logs", ["entity_type", "entity_id"]),
} as const;

export type Repositories = typeof repositories;
