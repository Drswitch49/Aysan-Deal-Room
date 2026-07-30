-- Killed deals must not sit in the Active Pipeline.
--
-- Killing a deal used to only relabel `pipeline_stage`, leaving the lifecycle
-- `stage` on 'active' — so the deal kept showing on the Active Deals page with a
-- "Killed" badge instead of moving to the Deal Inbox's Kill (archived) bucket.
-- The app now performs a real lifecycle transition; this backfills the deals
-- that were killed before that fix.

-- Record the move in the immutable stage history, same as a UI transition would.
insert into deal_stage_history (
  deal_id, legacy_deal_ref, company_name,
  from_stage, to_stage, from_stage_label, to_stage_label,
  changed_by, changed_by_role, changed_at, notes, transition_valid
)
select
  d.id, d.acp_ref_no, coalesce(d.company_name, d.deal_name),
  'active', 'archived', 'active', 'archived',
  'system', 'system', now(),
  'Backfill: killed deal moved out of the active pipeline into the Kill bucket',
  true
from deals d
where d.deleted_at is null
  and d.stage = 'active'
  and lower(trim(coalesce(d.pipeline_stage, ''))) in ('killed', 'dead');

update deals
set stage      = 'archived',
    status     = 'Kill',
    kill_date  = coalesce(kill_date, now()),
    killed_by  = coalesce(killed_by, 'system (backfill)')
where deleted_at is null
  and stage = 'active'
  and lower(trim(coalesce(pipeline_stage, ''))) in ('killed', 'dead');
