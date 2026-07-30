-- Sequential ACP reference numbers for active deals: ACP-001, ACP-002, …
--
-- Three things happen here:
--   1. Existing ACP-CFS-NNN refs are rewritten to ACP-NNN, keeping their
--      number. The team already knows these deals by that number, so
--      ACP-CFS-008 becomes ACP-008 rather than being renumbered.
--   2. Active deals with no ref get one, oldest first.
--   3. A sequence + next_acp_ref() issues every subsequent number. A sequence
--      rather than max(ref) + 1, because two deals created in the same moment
--      would otherwise read the same max and be handed the same reference.
--
-- Only active deals are numbered. A deal in inbox/review has no ACP ref until
-- it is promoted; archived deals keep whatever they were given while live.

-- 1. Migrate the legacy format in place (all stages — same identifier, new shape).
update deals
set acp_ref_no = 'ACP-' || substring(acp_ref_no from 'ACP-CFS-([0-9]+)$')
where deleted_at is null
  and acp_ref_no ~ '^ACP-CFS-[0-9]+$';

do $$
declare
  max_ref integer;
begin
  select coalesce(max(substring(acp_ref_no from '^ACP-([0-9]+)$')::integer), 0)
    into max_ref
    from deals
   where deleted_at is null and acp_ref_no ~ '^ACP-[0-9]+$';

  -- 2. Backfill unreferenced active deals. The number comes from row_number(),
  --    not nextval(): the order in which an UPDATE ... FROM evaluates rows is
  --    not guaranteed to match the subquery's ordering, so nextval() here would
  --    number them arbitrarily rather than oldest-first.
  with numbered as (
    select id, row_number() over (order by date_added nulls last, created_at, id) as n
      from deals
     where deleted_at is null
       and stage = 'active'
       and acp_ref_no is null
  )
  update deals d
     set acp_ref_no = 'ACP-' || lpad((max_ref + numbered.n)::text, 3, '0')
    from numbered
   where d.id = numbered.id;

  -- 3. Point the sequence past everything now in use.
  select coalesce(max(substring(acp_ref_no from '^ACP-([0-9]+)$')::integer), 0)
    into max_ref
    from deals
   where deleted_at is null and acp_ref_no ~ '^ACP-[0-9]+$';

  create sequence if not exists acp_ref_seq;
  execute format('alter sequence acp_ref_seq restart with %s', max_ref + 1);
end $$;

create or replace function next_acp_ref()
returns text
language sql
security definer
as $$
  select 'ACP-' || lpad(nextval('acp_ref_seq')::text, 3, '0');
$$;

-- Two deals must never share a reference.
create unique index if not exists idx_deals_acp_ref_no_unique
  on deals (acp_ref_no)
  where acp_ref_no is not null and deleted_at is null;
