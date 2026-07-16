-- ═══════════════════════════════════════════════════════════════════════════
--  Aysan Deal Room — initial Supabase schema (Phase 1a)
--
--  Consolidates the Airtable base (appSlarPHIotXrgL4, 26 tables) into a clean,
--  normalized Postgres model. Airtable's deal lifecycle (Deal_Inbox → Review_Queue
--  → Active_Pipeline → Archive, all linked to one Deal_Inbox record) collapses
--  into a single `deals` table with a `stage` enum.
--
--  Conventions:
--   - uuid primary keys (gen_random_uuid()).
--   - created_at / updated_at (trigger-maintained) / deleted_at (soft delete) everywhere.
--   - `airtable_*_id` provenance columns preserve the source record id(s); dropped after cutover.
--   - Airtable singleSelect fields → text (options tightened later once data is loaded).
--   - Airtable lookup/rollup/formula fields are DERIVED and NOT stored.
--   - RLS is enabled here but policies are added in Phase 4 (auth migration).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Extensions ────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;      -- gen_random_uuid()

-- ─── updated_at trigger helper ─────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── Enums ─────────────────────────────────────────────────────────────────
-- Deal lifecycle stage (derived from which Airtable table the record reached).
create type deal_stage as enum ('inbox', 'review', 'active', 'archived');

-- Normalized staff role (collapses the 10 legacy role strings). Mirrored into a
-- JWT claim for RLS in Phase 4.
create type user_role as enum (
  'owner',            -- super admin / owner
  'managing_partner',
  'partner',
  'analyst',
  'hr',
  'admin',
  'read_only'
);

-- External portal audiences (Phase 4 Supabase Auth accounts).
create type portal_role as enum ('lender', 'shareholder', 'stakeholder');

-- ─── ETL id map (transient — dropped at Phase 7 cutover) ──────────────────
-- Maps an Airtable record id to the Supabase uuid it became, so the ETL can
-- rewrite linked-record fields into real foreign keys and re-run idempotently.
create table etl_id_map (
  airtable_table text not null,
  airtable_id    text not null,
  supabase_table text not null,
  supabase_id    uuid not null,
  created_at     timestamptz not null default now(),
  primary key (airtable_table, airtable_id)
);
comment on table etl_id_map is 'TRANSIENT: Airtable id ↔ Supabase uuid mapping for the one-time ETL. Drop after cutover.';

-- ═══════════════════════════════════════════════════════════════════════════
--  People / accounts
-- ═══════════════════════════════════════════════════════════════════════════

-- Staff users (Airtable `Users`). In Phase 4 `id` is reconciled with auth.users.id.
create table profiles (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique,
  full_name       text,
  role            user_role not null default 'read_only',
  status          text not null default 'active',      -- active | inactive
  -- Legacy bcrypt hash imported from Airtable; used only to seed Supabase Auth, then cleared.
  legacy_password_hash text,
  permissions     text,
  last_login_at   timestamptz,
  airtable_id     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

-- Internal team roster (Airtable `ACP_Team`) — display metadata, distinct from auth.
create table acp_team (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  role          text,
  initials      text,
  access_level  text,
  avatar_theme  text,
  sort_order    integer,
  email         text,
  phone         text,
  status        text not null default 'active',
  login_link    text,
  airtable_id   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger trg_acp_team_updated before update on acp_team
  for each row execute function set_updated_at();

-- Lenders (Airtable `Lenders`) — Phase 4 gives each a Supabase Auth account.
create table lenders (
  id                uuid primary key default gen_random_uuid(),
  lender_ref        text unique,                       -- Airtable Lender_ID (e.g. LND-XXXXXX)
  name              text,
  company_name      text,
  contact_name      text,
  email             text,
  phone             text,
  portal_slug       text unique,
  legacy_password_hash text,                           -- Airtable Portal_Password (bcrypt)
  nda_approved      boolean not null default false,
  criteria_pills    text,
  last_contact_date date,
  auth_user_id      uuid,                              -- set in Phase 4 (references auth.users)
  airtable_id       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create trigger trg_lenders_updated before update on lenders
  for each row execute function set_updated_at();

-- Shareholders (Airtable `Shareholders`, currently empty) — Phase 4 accounts.
create table shareholders (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  email         text,
  phone         text,
  status        text not null default 'active',
  notes         text,
  last_login_at timestamptz,
  auth_user_id  uuid,
  airtable_id   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger trg_shareholders_updated before update on shareholders
  for each row execute function set_updated_at();

-- External stakeholders (Airtable `External_Stakeholders`).
create table external_stakeholders (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  association   text,
  organization  text,
  company       text,
  type          text,
  description   text,
  notes         text,
  accent_color  text,
  email         text,
  phone         text,
  status        text not null default 'active',
  login_link    text,
  airtable_id   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger trg_external_stakeholders_updated before update on external_stakeholders
  for each row execute function set_updated_at();

-- Hiring briefs (Airtable `Hiring_Briefs`, currently empty).
create table hiring_briefs (
  id           uuid primary key default gen_random_uuid(),
  role         text not null,
  company      text,
  status_text  text,
  accent_color text,
  airtable_id  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create trigger trg_hiring_briefs_updated before update on hiring_briefs
  for each row execute function set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
--  Deals — consolidated from Deal_Inbox + Review_Queue + Active_Pipeline + Archive
-- ═══════════════════════════════════════════════════════════════════════════
create table deals (
  id                uuid primary key default gen_random_uuid(),
  stage             deal_stage not null default 'inbox',

  -- Identity / refs
  ref_no            text,               -- Deal_Inbox "REF. NO"
  acp_ref_no        text,               -- Active_Pipeline "ACP REF NO"
  deal_name         text,
  company_name      text,
  project_name      text,

  -- Classification
  sector            text,
  industry          text,
  source            text,
  deal_type         text,
  status            text,               -- Deal_Inbox / pipeline status label
  ai_verdict        text,               -- Deal_Inbox AI_Verdict / Archive rollup

  -- Contacts / links
  broker            text,
  contact_email     text,
  contact_phone     text,
  website           text,
  listing_link      text,
  deal_files_url    text,               -- Deal_Inbox "Deal Files"
  location          text,

  -- Financials
  turnover          numeric,
  ebitda_gbp        numeric,
  asking_price_gbp  numeric,
  enterprise_value  numeric,

  -- Narrative
  business_description   text,
  executive_summary      text,
  internal_notes         text,
  one_line_reason        text,
  lender_executive_summary text,
  investment_highlights  text,
  acquisition_rationale  text,
  claude_verdict         text,

  -- Scoring (Deal_Inbox scorecard)
  total_score                   numeric,
  dscr_proxy                    numeric,
  dscr_score                    numeric,
  sector_score                  numeric,
  revenue_scale_score           numeric,
  ebitda_quality_score          numeric,
  recurring_revenue_score       numeric,
  customer_concentration_score  numeric,
  management_score              numeric,
  market_position_score         numeric,
  growth_score                  numeric,
  capital_intensity_score       numeric,
  exit_score                    numeric,
  revenue_per_employee_score    numeric,

  -- Workflow (Active_Pipeline)
  pipeline_stage    text,               -- Active_Pipeline "Stage" (free label; distinct from lifecycle `stage`)
  next_action       text,
  next_action_date  date,
  owner             text,
  analyst           text,
  assigned_to       text,
  date_added        timestamptz,        -- Deal_Inbox "Date Added"
  date_advanced     timestamptz,        -- Active_Pipeline "Date_Advanced"

  -- Review_Queue
  partner_review        text,
  kill_reason_select    text,
  kill_reason_text      text,
  information_needed     text,
  associate_recommendation text,
  decision_date         timestamptz,

  -- Archive
  killed_by     text,
  kill_date     timestamptz,

  -- Provenance (which Airtable rows this deal came from)
  airtable_inbox_id     text,
  airtable_review_id    text,
  airtable_pipeline_id  text,
  airtable_archive_id   text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index idx_deals_stage on deals(stage) where deleted_at is null;
create index idx_deals_ref_no on deals(ref_no);
create index idx_deals_acp_ref_no on deals(acp_ref_no);
create trigger trg_deals_updated before update on deals
  for each row execute function set_updated_at();

-- Immutable stage-change history (Airtable `Deal_Stage_History`).
create table deal_stage_history (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid references deals(id) on delete set null,
  legacy_deal_ref text,
  company_name    text,
  from_stage      text,
  to_stage        text,
  from_stage_label text,
  to_stage_label  text,
  changed_by      text,
  changed_by_role text,
  changed_at      timestamptz,
  notes           text,
  transition_valid boolean,
  airtable_id     text,
  created_at      timestamptz not null default now()
);
create index idx_stage_history_deal on deal_stage_history(deal_id);

-- ═══════════════════════════════════════════════════════════════════════════
--  Documents & files  (file URLs move to Cloudinary during ETL)
-- ═══════════════════════════════════════════════════════════════════════════
create table documents (
  id                uuid primary key default gen_random_uuid(),
  deal_id           uuid references deals(id) on delete cascade,
  doc_key           text,
  document_name     text,
  category          text,
  abl_critical      boolean not null default false,
  status            text,
  source            text,
  date_received     date,
  expected_date     date,
  date_sent_to_lender date,
  lender_target     text,
  document_access   text,
  internal_notes    text,
  -- Storage: Cloudinary after ETL (legacy Drive_Link kept for provenance).
  cloudinary_public_id text,
  file_url          text,               -- Cloudinary secure URL (post-ETL)
  legacy_drive_link text,               -- original Airtable Drive_Link (filebin/tmpfiles/drive)
  -- AI extraction outputs (Airtable Documents.*).
  extracted_text    text,
  summary           text,
  risks             text,
  covenants         text,
  metrics           text,
  processing_status text,
  processing_error  text,
  processing_started_at timestamptz,
  processed_at      timestamptz,
  airtable_id       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index idx_documents_deal on documents(deal_id);
create trigger trg_documents_updated before update on documents
  for each row execute function set_updated_at();

-- IM review documents (Airtable `IM_Review_Documents`, currently empty).
create table im_review_documents (
  id                uuid primary key default gen_random_uuid(),
  deal_id           uuid references deals(id) on delete cascade,
  legacy_deal_ref   text,
  document_name     text,
  file_type         text,
  cloudinary_public_id text,
  file_url          text,
  legacy_file_url   text,
  uploaded_by       text,
  uploaded_at       timestamptz,
  file_size         bigint,
  airtable_id       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index idx_im_docs_deal on im_review_documents(deal_id);
create trigger trg_im_docs_updated before update on im_review_documents
  for each row execute function set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
--  Deal activity: submissions, assignments, chat, notes
-- ═══════════════════════════════════════════════════════════════════════════
create table submission_log (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid references deals(id) on delete cascade,
  submitted_on     date,
  what_was_sent    text,
  sent_to          text,
  sent_via         text,
  response_received text,
  flag             text,
  airtable_id      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index idx_submission_deal on submission_log(deal_id);
create trigger trg_submission_updated before update on submission_log
  for each row execute function set_updated_at();

create table lender_deal_assignments (
  id            uuid primary key default gen_random_uuid(),
  assignment_ref text,
  lender_id     uuid references lenders(id) on delete cascade,
  deal_id       uuid references deals(id) on delete cascade,
  nda_approved  boolean not null default false,
  assigned_by   text,
  assigned_at   timestamptz,
  airtable_id   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (lender_id, deal_id)
);
create index idx_lda_lender on lender_deal_assignments(lender_id);
create index idx_lda_deal on lender_deal_assignments(deal_id);
create trigger trg_lda_updated before update on lender_deal_assignments
  for each row execute function set_updated_at();

create table shareholder_deal_assignments (
  id             uuid primary key default gen_random_uuid(),
  shareholder_id uuid references shareholders(id) on delete cascade,
  deal_id        uuid references deals(id) on delete cascade,
  assigned_at    timestamptz,
  airtable_id    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (shareholder_id, deal_id)
);
create index idx_sda_shareholder on shareholder_deal_assignments(shareholder_id);
create index idx_sda_deal on shareholder_deal_assignments(deal_id);
create trigger trg_sda_updated before update on shareholder_deal_assignments
  for each row execute function set_updated_at();

create table chat_messages (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid references deals(id) on delete cascade,
  lender_id   uuid references lenders(id) on delete set null,
  sender      text,
  message     text,
  airtable_id text,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index idx_chat_deal on chat_messages(deal_id);

create table deal_notes (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid references deals(id) on delete cascade,
  legacy_deal_ref text,
  note_content  text,
  status        text,
  author        text,
  author_email  text,
  airtable_id   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index idx_notes_deal on deal_notes(deal_id);
create trigger trg_notes_updated before update on deal_notes
  for each row execute function set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
--  AI artifacts (linked to deals)
-- ═══════════════════════════════════════════════════════════════════════════
create table transcript_analyses (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid references deals(id) on delete cascade,
  name             text,
  transcript       text,
  analysis         jsonb,               -- structured AI output (Phase 5 typed schema)
  processing_status text,
  processing_error text,
  processing_started_at timestamptz,
  processed_at     timestamptz,
  airtable_id      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index idx_transcripts_deal on transcript_analyses(deal_id);
create trigger trg_transcripts_updated before update on transcript_analyses
  for each row execute function set_updated_at();

create table precall_briefs (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid references deals(id) on delete cascade,
  name             text,
  website          text,
  brief_data       jsonb,
  processing_status text,
  processing_error text,
  processing_started_at timestamptz,
  processed_at     timestamptz,
  airtable_id      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index idx_precall_deal on precall_briefs(deal_id);
create trigger trg_precall_updated before update on precall_briefs
  for each row execute function set_updated_at();

create table postcall_briefs (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid references deals(id) on delete cascade,
  name             text,
  website          text,
  brief_data       jsonb,
  processing_status text,
  processing_error text,
  processing_started_at timestamptz,
  processed_at     timestamptz,
  airtable_id      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index idx_postcall_deal on postcall_briefs(deal_id);
create trigger trg_postcall_updated before update on postcall_briefs
  for each row execute function set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
--  Portfolio monitoring
-- ═══════════════════════════════════════════════════════════════════════════
create table portfolio_companies (
  id           uuid primary key default gen_random_uuid(),
  company_name text not null,
  industry     text,
  location     text,
  status       text not null default 'active',
  revenue      numeric,
  ebitda       numeric,
  debt         numeric,
  headcount    integer,
  notes        text,
  airtable_id  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create trigger trg_portco_updated before update on portfolio_companies
  for each row execute function set_updated_at();

-- Portfolio_* in Airtable key off a free-text Company_Id/Company_Name, not a link.
-- Keep a nullable FK plus the legacy identifiers so the ETL can best-effort match.
create table portfolio_metrics (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid references portfolio_companies(id) on delete set null,
  legacy_company_id text,
  company_name      text,
  reporting_period  text,
  revenue           numeric,
  ebitda            numeric,
  dscr              numeric,
  leverage          numeric,
  headcount         integer,
  churn_rate        numeric,
  recurring_revenue numeric,
  airtable_id       text,
  created_at        timestamptz not null default now()
);
create index idx_portfolio_metrics_company on portfolio_metrics(company_id);

create table portfolio_alerts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid references portfolio_companies(id) on delete set null,
  legacy_company_id text,
  company_name      text,
  alert_type        text,
  severity          text,
  explanation       text,
  triggered_at      timestamptz,
  resolved_at       timestamptz,
  airtable_id       text,
  created_at        timestamptz not null default now()
);
create index idx_portfolio_alerts_company on portfolio_alerts(company_id);

create table portfolio_health (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid references portfolio_companies(id) on delete set null,
  legacy_company_id text,
  company_name      text,
  portfolio_score   numeric,
  risk_level        text,
  active_alerts     integer,
  trend_summary     text,
  updated_at        timestamptz,
  airtable_id       text,
  created_at        timestamptz not null default now()
);
create index idx_portfolio_health_company on portfolio_health(company_id);

-- ═══════════════════════════════════════════════════════════════════════════
--  Audit log (Airtable `Audit_Logs`) — append-only
-- ═══════════════════════════════════════════════════════════════════════════
create table audit_logs (
  id            uuid primary key default gen_random_uuid(),
  action        text,
  event_type    text,
  entity_type   text,
  entity_id     text,
  operator      text,
  operator_role text,
  user_id       text,
  target        text,
  details       text,
  changes       text,
  ip_address    text,
  occurred_at   timestamptz,
  airtable_id   text,
  created_at    timestamptz not null default now()
);
create index idx_audit_entity on audit_logs(entity_type, entity_id);
create index idx_audit_occurred on audit_logs(occurred_at);

-- ═══════════════════════════════════════════════════════════════════════════
--  RLS — enable now, default-deny; policies added in Phase 4 (auth migration).
--  Server code uses the service-role key (bypasses RLS) until then.
-- ═══════════════════════════════════════════════════════════════════════════
alter table profiles                     enable row level security;
alter table acp_team                     enable row level security;
alter table lenders                      enable row level security;
alter table shareholders                 enable row level security;
alter table external_stakeholders        enable row level security;
alter table hiring_briefs                enable row level security;
alter table deals                        enable row level security;
alter table deal_stage_history           enable row level security;
alter table documents                    enable row level security;
alter table im_review_documents          enable row level security;
alter table submission_log               enable row level security;
alter table lender_deal_assignments      enable row level security;
alter table shareholder_deal_assignments enable row level security;
alter table chat_messages                enable row level security;
alter table deal_notes                   enable row level security;
alter table transcript_analyses          enable row level security;
alter table precall_briefs               enable row level security;
alter table postcall_briefs              enable row level security;
alter table portfolio_companies          enable row level security;
alter table portfolio_metrics            enable row level security;
alter table portfolio_alerts             enable row level security;
alter table portfolio_health             enable row level security;
alter table audit_logs                   enable row level security;
