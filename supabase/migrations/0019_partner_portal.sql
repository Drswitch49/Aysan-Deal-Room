-- ═══════════════════════════════════════════════════════════════════════════
--  Capital Partner Portal — Phase A schema and database gates
--  (ACP Capital Partner Portal Build Pack v1.0, Sections 13 and 14)
--
--  Adapted to this repository's security model. The Build Pack assumes Next.js
--  server actions talking to PostgREST as the signed-in user, so every rule
--  hangs off auth.uid() in RLS. Here every table has RLS enabled with no
--  policies and all access runs through service-role API routes
--  (api/_lib/handler.ts), so auth.uid() is always null and RLS-based rules
--  would silently never fire.
--
--  The doctrine is preserved by moving the same rules to constructs that DO
--  bite under the service role:
--    · CHECK constraints            — R5, R9, certification completeness
--    · triggers + an actor GUC      — R4 (single author), R6 (certification)
--    · audit triggers, append-only  — R7
--    · no projection columns exist  — R1 (Test 6 greps the catalog)
--  Row scoping (R2/R3) is enforced in one server module that derives the
--  investor id from the verified session only: api/_lib/investor-context.ts.
--
--  The actor GUC: gated writes go through the SECURITY DEFINER functions at
--  the foot of this file, which set `acp.actor_role` for the statement. A
--  direct UPDATE that bypasses them leaves the GUC null and is refused — so
--  the rule cannot be moved into React, which is the point of the pack.
--
--  Money is bigint pence. Percentages are integer basis points. No floats in
--  the money path, and no IRR / MOIC / multiple / yield / hold period / target
--  / forecast column exists anywhere in this file by design.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Enums ─────────────────────────────────────────────────────────────────
-- The offer enums land now so Phase D adds tables without an enum migration.

do $$ begin
  create type investor_type    as enum ('holdco_equity','deal_equity','prospective');
  create type investor_status  as enum ('prospective','certified','invited','active','committed','passed','ended');
  create type cert_status      as enum ('not_certified','pending','valid','expired');
  create type cert_kind        as enum ('hnw','self_cert_sophisticated');
  create type login_mode       as enum ('none','pending','full','read_only','revoked');
  create type commitment_status as enum ('pending','completed','converted','bought_back');
  create type txn_type         as enum ('call','distribution','buyback');
  create type dscr_status      as enum ('not_yet_reported','above_floor','watch','breach');
  create type amort_status     as enum ('not_started','on_schedule','ahead','behind');
  create type offer_status     as enum ('draft','offered','interested','declined','withdrawn','expired','allocated');
  create type pack_status      as enum ('draft','approved','retired');
exception when duplicate_object then null;
end $$;

-- ─── Portal settings (singleton) ───────────────────────────────────────────

create table if not exists portal_settings (
  id             boolean primary key default true check (id),
  offers_enabled boolean not null default false,   -- ON only with the Crown Law letter (R9 / s.21 FSMA)
  notify_only    boolean not null default true,    -- every partner email reroutes to the admin address
  terms_version  int     not null default 1,
  updated_at     timestamptz not null default now()
);
insert into portal_settings (id) values (true) on conflict (id) do nothing;

-- ─── Investors ─────────────────────────────────────────────────────────────
-- An investor is created from the CRM's External Stakeholders registry when
-- its type is "Investor"; stakeholder_id keeps the two rows in step so the
-- stakeholder card stays the single front door the team already knows.

create table if not exists investors (
  id             uuid primary key default gen_random_uuid(),
  stakeholder_id uuid references external_stakeholders(id) on delete set null,
  name           text not null,
  entity         text,
  type           investor_type not null default 'prospective',
  email          text not null,
  phone          text,
  warmth         smallint not null default 0 check (warmth between 0 and 3),
  status         investor_status not null default 'prospective',

  -- Admin knowledge only. Unlocks nothing in the portal.
  perimeter_flag boolean not null default false,

  certification_status   cert_status not null default 'not_certified',
  certification_kind     cert_kind,
  certification_date     date,
  certification_evidence_link text,

  last_touch      date,
  staleness_flag  boolean not null default false,
  pass_reason     text,
  pass_category   text,
  source          text,
  notes           text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint pass_needs_reason check (
    status <> 'passed' or (pass_reason is not null and pass_category is not null)
  ),
  constraint valid_cert_complete check (
    certification_status <> 'valid'
    or (certification_kind is not null
        and certification_date is not null
        and certification_evidence_link is not null)
  )
);

create unique index if not exists idx_investors_email on investors (lower(email)) where deleted_at is null;
create index if not exists idx_investors_stakeholder on investors (stakeholder_id);
create index if not exists idx_investors_status on investors (status);

drop trigger if exists trg_investors_updated on investors;
create trigger trg_investors_updated before update on investors
  for each row execute function set_updated_at();

-- Auth mapping. auth_uid is written once and then immutable (gate below), so a
-- partner's rows can never be re-pointed at a different login.
create table if not exists investor_auth_map (
  investor_id       uuid primary key references investors(id) on delete cascade,
  auth_uid          uuid unique,
  login_mode        login_mode not null default 'none',
  terms_version     int,
  terms_accepted_at timestamptz,
  first_login_at    timestamptz,
  last_login_at     timestamptz,
  read_only_until   date,
  updated_at        timestamptz not null default now()
);

drop trigger if exists trg_investor_auth_map_updated on investor_auth_map;
create trigger trg_investor_auth_map_updated before update on investor_auth_map
  for each row execute function set_updated_at();

-- Invites. One active row per investor; issuing a new one revokes the last.
create table if not exists portal_invites (
  id          uuid primary key default gen_random_uuid(),
  investor_id uuid not null references investors(id) on delete cascade,
  issued_by   uuid,
  issued_by_email text,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '24 hours',
  accepted_at timestamptz,
  status      text not null default 'active' check (status in ('active','revoked','accepted','expired'))
);
create index if not exists idx_portal_invites_investor on portal_invites (investor_id, status);

-- ─── Commitments, capital transactions, holdco ─────────────────────────────

create table if not exists commitments (
  id              uuid primary key default gen_random_uuid(),
  investor_id     uuid not null references investors(id),
  deal_id         uuid not null references deals(id),
  offer_id        uuid,                              -- FK added in Phase D with deal_offers
  committed_pence bigint not null check (committed_pence > 0),
  ownership_bp    int check (ownership_bp between 0 and 10000),
  instrument      text not null default 'spv_equity_conversion',
  status          commitment_status not null default 'pending',
  completed_at    timestamptz,
  converted_at    timestamptz,
  bought_back_at  timestamptz,
  created_at      timestamptz not null default now(),
  constraint completed_has_ownership check (status = 'pending' or ownership_bp is not null)
);
create index if not exists idx_commitments_investor on commitments (investor_id);
create index if not exists idx_commitments_deal on commitments (deal_id);

create table if not exists capital_transactions (
  id            uuid primary key default gen_random_uuid(),
  commitment_id uuid not null references commitments(id),
  type          txn_type not null,
  amount_pence  bigint not null check (amount_pence > 0),
  txn_date      date not null,
  due_date      date,
  settled       boolean not null default false,
  settled_at    timestamptz,
  evidence_link text,
  -- R5: no distribution or buyback without a CFO sanction reference.
  cfo_sanction_ref text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint sanction_required check (type = 'call' or cfo_sanction_ref is not null),
  constraint settled_needs_evidence check (not settled or evidence_link is not null)
);
create index if not exists idx_capital_txn_commitment on capital_transactions (commitment_id);

create table if not exists holdco_shareholdings (
  id                 uuid primary key default gen_random_uuid(),
  investor_id        uuid not null references investors(id),
  from_commitment_id uuid not null references commitments(id),
  shares             numeric not null,
  issued_at          date not null,
  created_at         timestamptz not null default now()
);

-- ─── Deals: partner-facing additions ───────────────────────────────────────

alter table deals add column if not exists partner_display_name    text;
alter table deals add column if not exists dscr_status             dscr_status not null default 'not_yet_reported';
alter table deals add column if not exists contracted_bp_verified  int;
alter table deals add column if not exists amort_status            amort_status not null default 'not_started';
alter table deals add column if not exists next_report_date        date;

do $$ begin
  alter table deals add constraint deals_contracted_bp_range
    check (contracted_bp_verified is null or contracted_bp_verified between 0 and 10000);
exception when duplicate_object then null;
end $$;

-- The Business tab. Admin-authored, legal-reviewed text. No seller name before
-- announcement, no CFS code, no lender.
create table if not exists deal_partner_profiles (
  deal_id         uuid primary key references deals(id) on delete cascade,
  sector          text,
  region          text,
  summary         text,
  customer_types  text[],
  headcount_band  text,
  founded_year    int,
  milestones      jsonb not null default '[]',   -- [{date, text}]
  legal_review_ref text,
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_deal_partner_profiles_updated on deal_partner_profiles;
create trigger trg_deal_partner_profiles_updated before update on deal_partner_profiles
  for each row execute function set_updated_at();

create table if not exists deal_reports (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid not null references deals(id) on delete cascade,
  period_label     text not null,                 -- 'Q3 2026'
  publishes_on     date not null,
  published_at     timestamptz,
  trading_summary  text,                          -- ACP-written line, never a computed figure
  coverage_at_period dscr_status,
  report_link      text,
  covenant_cert_link text,
  created_at       timestamptz not null default now(),
  unique (deal_id, period_label)
);

create table if not exists dscr_status_history (
  id         bigserial primary key,
  deal_id    uuid not null references deals(id) on delete cascade,
  status     dscr_status not null,
  basis_note text,
  set_by     uuid,
  set_by_email text,
  set_at     timestamptz not null default now()
);
create index if not exists idx_dscr_history_deal on dscr_status_history (deal_id, set_at desc);

-- ─── Documents, activity, access ───────────────────────────────────────────
-- investor_id null = every partner holding a completed commitment in the deal.

create table if not exists investor_documents (
  id           uuid primary key default gen_random_uuid(),
  investor_id  uuid references investors(id) on delete cascade,
  deal_id      uuid references deals(id) on delete cascade,
  doc_type     text not null check (doc_type in
                 ('subscription','spv_sha','certification','quarterly_report',
                  'covenant_certificate','notice','other')),
  title        text not null,
  storage_path text,                              -- private bucket path (Phase C), or
  file_link    text,                              -- link to the file in its home
  view_only    boolean not null default false,    -- certification is view only
  publishes_on date,
  published_at timestamptz,
  uploaded_by  uuid,
  uploaded_at  timestamptz not null default now(),
  constraint doc_has_a_source check (storage_path is not null or file_link is not null or publishes_on is not null)
);
create index if not exists idx_investor_documents_investor on investor_documents (investor_id);
create index if not exists idx_investor_documents_deal on investor_documents (deal_id);

-- Trigger-written, append only.
create table if not exists activity_log (
  id          bigserial primary key,
  investor_id uuid not null references investors(id) on delete cascade,
  deal_id     uuid,
  event_type  text not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists idx_activity_investor on activity_log (investor_id, created_at desc);

-- Logins, MFA, document opens, offer views.
create table if not exists access_log (
  id          bigserial primary key,
  investor_id uuid,
  auth_uid    uuid,
  event       text not null check (event in ('login','mfa_verified','mfa_failed','doc_open','offer_view','signout')),
  document_id uuid,
  offer_id    uuid,
  ip          inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_access_log_investor on access_log (investor_id, created_at desc);

-- Outbound partner email. A queue rather than a direct send so a failure is
-- visible as a row with an error, not a silent nothing (Section 18.2).
create table if not exists email_queue (
  id          bigserial primary key,
  investor_id uuid references investors(id) on delete set null,
  template    text not null,
  payload     jsonb not null default '{}',
  status      text not null default 'queued' check (status in ('queued','sent','failed')),
  intended_to text,
  sent_to     text,
  sent_at     timestamptz,
  attempts    int not null default 0,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_email_queue_status on email_queue (status, created_at);

-- ─── Audit (R7) ────────────────────────────────────────────────────────────
-- Extends the CRM's existing audit_logs rather than standing up a parallel
-- table, so the admin Audit tab and /api/audit-logs keep working unchanged.

alter table audit_logs add column if not exists old_value jsonb;
alter table audit_logs add column if not exists new_value jsonb;
alter table audit_logs add column if not exists reason    text;

-- ─── RLS: default-deny, matching every other table in this schema ──────────

alter table portal_settings       enable row level security;
alter table investors             enable row level security;
alter table investor_auth_map     enable row level security;
alter table portal_invites        enable row level security;
alter table commitments           enable row level security;
alter table capital_transactions  enable row level security;
alter table holdco_shareholdings  enable row level security;
alter table deal_partner_profiles enable row level security;
alter table deal_reports          enable row level security;
alter table dscr_status_history   enable row level security;
alter table investor_documents    enable row level security;
alter table activity_log          enable row level security;
alter table access_log            enable row level security;
alter table email_queue           enable row level security;

-- Append-only logs (R7). A grant revoke would not bind the service role, which
-- is what this app actually connects as, so history is protected by a trigger
-- that refuses the statement outright.
create or replace function block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'append_only_table'
    using hint = format('%s is append only; %s is not permitted.', tg_table_name, tg_op);
end $$;

do $$
declare t text;
begin
  foreach t in array array['audit_logs','access_log','activity_log','dscr_status_history'] loop
    execute format('drop trigger if exists no_rewrite_%1$s on %1$I', t);
    execute format(
      'create trigger no_rewrite_%1$s before update or delete on %1$I
         for each row execute function block_mutation()', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  Gates
-- ═══════════════════════════════════════════════════════════════════════════

-- The actor role for the current statement, set by the SECURITY DEFINER
-- functions below. Null means "written directly", which the gates refuse.
create or replace function acp_actor_role() returns text
language sql stable as $$
  select nullif(current_setting('acp.actor_role', true), '')
$$;

-- Certification valid, and signed within the last 12 months. Checked live on
-- every read path that depends on it, not just at the moment of issue (R6).
create or replace function is_certified_now(inv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from investors
    where id = inv
      and deleted_at is null
      and certification_status = 'valid'
      and certification_date > current_date - interval '12 months'
  )
$$;

-- R6 / Test 5: no login invite while certification is invalid or over 12 months
-- old, and only admin or cfo may issue one. Issuing revokes the previous invite.
create or replace function gate_invite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if acp_actor_role() is null then
    raise exception 'invite_requires_gate' using hint = 'Call issue_portal_invite(); do not insert portal_invites directly.';
  end if;
  if acp_actor_role() not in ('admin','cfo','owner','managing_partner','partner') then
    raise exception 'not_authorised';
  end if;
  if not is_certified_now(new.investor_id) then
    raise exception 'certification_invalid';
  end if;
  update portal_invites set status = 'revoked'
   where investor_id = new.investor_id and status = 'active';
  return new;
end $$;

drop trigger if exists trg_gate_invite on portal_invites;
create trigger trg_gate_invite before insert on portal_invites
  for each row execute function gate_invite();

-- R4 / Test 4: coverage status has one author, the CFO role. Ayo's admin login
-- fails here by design, and every change is written to history.
create or replace function gate_dscr() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.dscr_status is distinct from old.dscr_status then
    if coalesce(acp_actor_role(), '') <> 'cfo' then
      raise exception 'dscr_status_cfo_only';
    end if;
    insert into dscr_status_history (deal_id, status, basis_note, set_by_email)
    values (new.id, new.dscr_status,
            nullif(current_setting('acp.dscr_basis_note', true), ''),
            nullif(current_setting('acp.actor_email', true), ''));
  end if;
  return new;
end $$;

drop trigger if exists trg_gate_dscr on deals;
create trigger trg_gate_dscr before update of dscr_status on deals
  for each row execute function gate_dscr();

-- A completed commitment is a record of fact. Only lifecycle transitions are
-- allowed afterwards, and the money and ownership can never be edited.
create or replace function gate_commitment_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'pending' then
    if (new.committed_pence, new.ownership_bp, new.deal_id, new.investor_id, new.instrument)
       is distinct from
       (old.committed_pence, old.ownership_bp, old.deal_id, old.investor_id, old.instrument)
    then raise exception 'commitment_locked'; end if;

    if not ((old.status = 'completed' and new.status in ('completed','converted','bought_back'))
            or old.status = new.status)
    then raise exception 'illegal_transition'; end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_commit_lock on commitments;
create trigger trg_commit_lock before update on commitments
  for each row execute function gate_commitment_lock();

create or replace rule no_delete_commitments as on delete to commitments do instead nothing;

-- auth_uid is written once. Re-pointing it would hand one partner another
-- partner's holdings.
create or replace function gate_auth_map() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.auth_uid is not null and new.auth_uid is distinct from old.auth_uid then
    raise exception 'auth_map_immutable';
  end if;
  return new;
end $$;

drop trigger if exists trg_auth_map on investor_auth_map;
create trigger trg_auth_map before update on investor_auth_map
  for each row execute function gate_auth_map();

-- R7: every admin write on a partner-facing table is audit logged with old and
-- new values. Writes into the CRM's existing audit_logs table.
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  row_id text;
begin
  row_id := coalesce(
    (to_jsonb(case when tg_op = 'DELETE' then old else new end) ->> 'id'),
    null
  );
  insert into audit_logs (
    action, event_type, entity_type, entity_id,
    operator, operator_role, details,
    old_value, new_value, reason, occurred_at
  ) values (
    tg_op,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    row_id,
    nullif(current_setting('acp.actor_email', true), ''),
    acp_actor_role(),
    'Partner portal ' || lower(tg_op) || ' on ' || tg_table_name,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    nullif(current_setting('acp.actor_reason', true), ''),
    now()
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'investors','investor_auth_map','portal_invites','commitments',
    'capital_transactions','investor_documents','deal_reports',
    'deal_partner_profiles','portal_settings'
  ] loop
    execute format('drop trigger if exists aud_%1$s on %1$I', t);
    execute format(
      'create trigger aud_%1$s after insert or update or delete on %1$I
         for each row execute function audit_row()', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  Gated write functions — the only way past the gates above
--
--  Each takes the actor explicitly. The API passes the role off the verified
--  session (api/_lib/authz.ts), never off request input.
-- ═══════════════════════════════════════════════════════════════════════════

-- Stamps the actor onto the current transaction so the audit trigger records
-- who did it and why. The setting is transaction-local, so this is only useful
-- when called from inside another function that then does the write — calling
-- it over REST and writing in a second request would not carry. Ordinary admin
-- writes record their own audit row in the API instead (the existing pattern).
create or replace function acp_set_actor(p_role text, p_email text default null, p_reason text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform set_config('acp.actor_role',   coalesce(p_role, ''),   true);
  perform set_config('acp.actor_email',  coalesce(p_email, ''),  true);
  perform set_config('acp.actor_reason', coalesce(p_reason, ''), true);
end $$;

-- R4: the single author path for coverage status.
create or replace function set_dscr_status(
  p_deal uuid, p_status dscr_status, p_basis_note text,
  p_actor_role text, p_actor_email text
) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if coalesce(p_actor_role, '') <> 'cfo' then
    raise exception 'dscr_status_cfo_only';
  end if;
  perform set_config('acp.actor_role', p_actor_role, true);
  perform set_config('acp.actor_email', coalesce(p_actor_email, ''), true);
  perform set_config('acp.dscr_basis_note', coalesce(p_basis_note, ''), true);
  update deals set dscr_status = p_status where id = p_deal;
  if not found then raise exception 'deal_not_found'; end if;
end $$;

-- R6: the only path that creates an invite row.
create or replace function issue_portal_invite(
  p_investor uuid, p_actor_role text, p_actor_email text, p_ttl_hours int default 24
) returns portal_invites
language plpgsql volatile security definer set search_path = public as $$
declare row portal_invites;
begin
  perform set_config('acp.actor_role', coalesce(p_actor_role, ''), true);
  perform set_config('acp.actor_email', coalesce(p_actor_email, ''), true);
  insert into portal_invites (investor_id, issued_by_email, expires_at)
  values (p_investor, p_actor_email, now() + make_interval(hours => p_ttl_hours))
  returning * into row;
  return row;
end $$;

-- Nightly housekeeping (Section 14.7). Called by the existing Vercel cron
-- worker rather than pg_cron, which is not enabled on this project.
create or replace function portal_nightly() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare expired_certs int; stale int; expired_invites int; lapsed_readonly int;
begin
  update investors set certification_status = 'expired'
   where certification_status = 'valid'
     and certification_date <= current_date - interval '12 months';
  get diagnostics expired_certs = row_count;

  update investors set staleness_flag = (last_touch is null or last_touch < current_date - 90);
  get diagnostics stale = row_count;

  update portal_invites set status = 'expired'
   where status = 'active' and expires_at < now();
  get diagnostics expired_invites = row_count;

  update investor_auth_map set login_mode = 'revoked'
   where login_mode = 'read_only' and read_only_until < current_date;
  get diagnostics lapsed_readonly = row_count;

  return jsonb_build_object(
    'certifications_expired', expired_certs,
    'staleness_recalculated', stale,
    'invites_expired', expired_invites,
    'read_only_lapsed', lapsed_readonly
  );
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  Partner read views
--
--  In the pack these filter on current_investor_id() and are the whitelist.
--  Under the service role that function can never resolve, so the whitelist
--  here is the column list: these views select only what a partner may see,
--  and the server always constrains them by the session's investor id
--  (api/_lib/investor-context.ts). No CFS code, deal name, seller, lender,
--  price, walk-away price, kill criteria or internal note is selectable.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view partner_deal_view with (security_barrier) as
select
  c.investor_id,
  d.id            as deal_key,
  d.partner_display_name as display_name,
  d.dscr_status,
  d.contracted_bp_verified,
  d.amort_status,
  d.next_report_date,
  c.id            as commitment_id,
  c.committed_pence,
  c.ownership_bp,
  c.instrument,
  c.status        as commitment_status,
  c.completed_at, c.converted_at, c.bought_back_at,
  p.sector, p.region, p.summary, p.customer_types,
  p.headcount_band, p.founded_year, p.milestones
from commitments c
join deals d on d.id = c.deal_id
left join deal_partner_profiles p on p.deal_id = d.id
where c.status in ('completed','converted','bought_back')
  and d.deleted_at is null;

create or replace view partner_capital_transactions with (security_barrier) as
select
  c.investor_id,
  t.id, c.deal_id as deal_key, t.type, t.amount_pence,
  t.txn_date, t.due_date, t.settled
from capital_transactions t
join commitments c on c.id = t.commitment_id
where t.type in ('call','distribution');
-- Sanction refs, evidence links and created_by are deliberately absent.

create or replace view partner_documents with (security_barrier) as
select distinct
  coalesce(doc.investor_id, c.investor_id) as investor_id,
  doc.id, doc.deal_id as deal_key, d.partner_display_name,
  doc.doc_type, doc.title, doc.view_only,
  doc.publishes_on, doc.published_at,
  (doc.published_at is not null or doc.publishes_on is null) as available
from investor_documents doc
left join deals d on d.id = doc.deal_id
left join commitments c
       on doc.investor_id is null
      and c.deal_id = doc.deal_id
      and c.status in ('completed','converted','bought_back')
where doc.investor_id is not null or c.investor_id is not null;
-- storage_path and file_link are NOT in the view; delivery goes through the
-- open route so every access is checked and logged (Phase C, Section 17).

create or replace view partner_reports with (security_barrier) as
select distinct
  c.investor_id,
  r.id, r.deal_id as deal_key, r.period_label,
  r.publishes_on, r.published_at, r.trading_summary, r.coverage_at_period
from deal_reports r
join commitments c on c.deal_id = r.deal_id
 and c.status in ('completed','converted','bought_back');

-- ─── Locking the views down ────────────────────────────────────────────────
--
-- This matters more here than it does in the Build Pack. There, every view
-- filters on current_investor_id(), so granting it to `authenticated` is safe:
-- the view itself can only ever return the caller's own rows. Here the filter
-- lives in the API, so an unguarded view would return EVERY partner's rows to
-- anyone who could select it — and a view runs with its owner's privileges by
-- default, which means RLS on the base tables would not save us.
--
-- Two locks, either of which is sufficient:
--   1. security_invoker — the view runs as the caller, so the base tables' RLS
--      applies. anon and authenticated have no policy, so they get nothing.
--      service_role holds BYPASSRLS, so the API is unaffected.
--   2. the grants below — anon and authenticated cannot select the view at all.
--
-- Supabase grants SELECT on new public objects to anon and authenticated by
-- default, so the revoke is not belt and braces; without it the default stands.

alter view partner_deal_view            set (security_invoker = true);
alter view partner_capital_transactions set (security_invoker = true);
alter view partner_documents            set (security_invoker = true);
alter view partner_reports              set (security_invoker = true);

revoke all on partner_deal_view, partner_capital_transactions,
              partner_documents, partner_reports
  from anon, authenticated;

grant select on partner_deal_view, partner_capital_transactions,
                partner_documents, partner_reports
  to service_role;

comment on view partner_deal_view is
  'Partner whitelist view. Never add a projection column (IRR, MOIC, multiple, yield, hold period, target, forecast) — acceptance Test 6 greps the catalog for them. Never grant it to anon or authenticated: it is not self-filtering, the API scopes it (api/_lib/investor-context.ts).';
