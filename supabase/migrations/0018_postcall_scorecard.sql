-- ACP Post-Call Scorecard (spec: "ACP Post-Call Scorecard Spec").
--
-- The post-call tab scored calls on hardcoded 1-10 metrics with editable
-- overrides. The spec replaces that with hard gates, a verdict, completeness
-- and an info request, and sets four backend rules this migration carries:
--
--  * Thresholds live in a versioned config table Dami owns, never in the
--    prompt: `playbook_config`, insert-only. Each change is a new version.
--  * Every run records the Playbook config version it used, and runs are
--    never overwritten: postcall_briefs gains the version + the exact input
--    the run cited, and a trigger freezes a spec run once written.
--  * institutional_band is set by Dami per deal: deals.institutional_band_pct.
--  * loi_ready stays false until Dami's DSCR sanction is recorded:
--    deals.dscr_sanctioned_at / _by / _note.

-- ─── Playbook config (versioned, insert-only) ──────────────────────────────
create table if not exists playbook_config (
  version                   integer generated always as identity primary key,
  recurring_gate_pct        numeric check (recurring_gate_pct between 0 and 100),
  ebitda_band_min_gbp       numeric,
  ebitda_band_max_gbp       numeric,
  concentration_largest_pct numeric check (concentration_largest_pct between 0 and 100),
  concentration_top3_pct    numeric check (concentration_top3_pct between 0 and 100),
  accreditation_stay_months integer check (accreditation_stay_months >= 0),
  manager_install_days      integer check (manager_install_days >= 0),
  notes                     text,
  created_by                text,
  created_at                timestamptz not null default now(),
  check (ebitda_band_min_gbp is null or ebitda_band_max_gbp is null or ebitda_band_min_gbp <= ebitda_band_max_gbp)
);

alter table playbook_config enable row level security;

comment on table  playbook_config is 'Post-call scorecard thresholds from the Playbook. Insert-only: a change is a new version, and every post-call run records the version it used.';
comment on column playbook_config.recurring_gate_pct        is 'Gate 2: minimum contracted + scheduled share of revenue (percent)';
comment on column playbook_config.ebitda_band_min_gbp       is 'Gate 3: maintainable EBITDA band, lower bound (GBP)';
comment on column playbook_config.ebitda_band_max_gbp       is 'Gate 3: maintainable EBITDA band, upper bound (GBP)';
comment on column playbook_config.concentration_largest_pct is 'Gate 4: maximum largest-customer share (percent)';
comment on column playbook_config.concentration_top3_pct    is 'Gate 4: maximum top-3 customer share (percent)';
comment on column playbook_config.accreditation_stay_months is 'Gate 7: months a personal accreditation holder must commit to stay';
comment on column playbook_config.manager_install_days      is 'Gate 5: days within which a manager must be installable';

create or replace function playbook_config_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'playbook_config is insert-only: add a new version instead of changing version %', old.version;
end $$;

drop trigger if exists playbook_config_no_update on playbook_config;
create trigger playbook_config_no_update before update or delete on playbook_config
  for each row execute function playbook_config_immutable();

-- Version 1 is an empty placeholder so every run can stamp a version before
-- the Playbook values are entered. With thresholds unset, threshold-dependent
-- gates cannot pass: they return unknown.
insert into playbook_config (notes, created_by)
select 'Placeholder: thresholds not yet populated from the Playbook', 'migration 0018'
where not exists (select 1 from playbook_config);

-- ─── Deal-level controls ───────────────────────────────────────────────────
alter table deals add column if not exists institutional_band_pct numeric check (institutional_band_pct between 0 and 100);
alter table deals add column if not exists dscr_sanctioned_at     timestamptz;
alter table deals add column if not exists dscr_sanctioned_by     text;
alter table deals add column if not exists dscr_sanction_note     text;

comment on column deals.institutional_band_pct is 'Gate 4: largest-customer share allowed for an institutional buyer on this deal (percent). Set by Dami per deal.';
comment on column deals.dscr_sanctioned_at     is 'When Dami sanctioned the DSCR. Until set, loi_ready is false and broker emails may not carry figures or structure.';
comment on column deals.dscr_sanctioned_by     is 'Who recorded the DSCR sanction';
comment on column deals.dscr_sanction_note     is 'DSCR sanction note (e.g. the sanctioned ratio and basis)';

-- ─── Post-call runs ────────────────────────────────────────────────────────
alter table postcall_briefs add column if not exists playbook_version integer references playbook_config(version);
alter table postcall_briefs add column if not exists input_kind       text check (input_kind in ('transcript', 'notes'));
alter table postcall_briefs add column if not exists input_text       text;
alter table postcall_briefs add column if not exists precall_brief_id uuid references precall_briefs(id) on delete set null;

comment on column postcall_briefs.playbook_version is 'Playbook config version the run was scored against (null = legacy pre-spec brief)';
comment on column postcall_briefs.input_kind       is 'Whether the run read a call transcript or manual notes';
comment on column postcall_briefs.input_text       is 'The exact transcript or notes the run read. Field sources cite its line numbers (L12) or timestamps.';
comment on column postcall_briefs.precall_brief_id is 'The pre-call brief supplied to the run, if any';

-- A spec run (playbook_version set) is never overwritten. Soft-delete and
-- processing bookkeeping may still change; the scorecard and its input may not.
create or replace function postcall_run_immutable() returns trigger language plpgsql as $$
begin
  if old.playbook_version is not null and (
       new.brief_data       is distinct from old.brief_data
    or new.input_text       is distinct from old.input_text
    or new.input_kind       is distinct from old.input_kind
    or new.playbook_version is distinct from old.playbook_version
    or new.deal_id          is distinct from old.deal_id
  ) then
    raise exception 'Post-call run % is immutable: a new transcript or note creates a new run', old.id;
  end if;
  return new;
end $$;

drop trigger if exists postcall_briefs_run_immutable on postcall_briefs;
create trigger postcall_briefs_run_immutable before update on postcall_briefs
  for each row execute function postcall_run_immutable();
