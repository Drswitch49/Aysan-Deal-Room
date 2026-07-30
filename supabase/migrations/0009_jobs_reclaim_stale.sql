-- Reclaim jobs abandoned by a killed worker.
--
-- claim_jobs only ever looked at status = 'queued'. A worker that is killed
-- mid-job — which a serverless function will be, since a single AI brief can
-- run 150s+ against a 300s function ceiling — leaves its job in 'running'
-- forever: nothing re-queues it and nothing reports it, so the deal simply
-- never gets its brief.
--
-- Jobs now carry a 10-minute lease. Past that a 'running' job with retries left
-- is claimable again, exactly like a queued one. Signature is unchanged so the
-- existing rpc('claim_jobs', {batch}) call keeps working.

create or replace function claim_jobs(batch integer default 5)
returns setof jobs
language plpgsql
security definer
as $$
begin
  return query
  update jobs j
     set status = 'running', started_at = now(), attempts = j.attempts + 1
   where j.id in (
     select id from jobs
      where (status = 'queued' and run_after <= now())
         -- Lease expired: the worker that claimed this is gone.
         or (status = 'running'
             and started_at < now() - interval '10 minutes'
             and attempts < max_attempts)
      order by created_at
      limit batch
      for update skip locked
   )
  returning j.*;
end;
$$;

-- Anything already stranded in 'running' by the old behaviour: hand it back to
-- the queue so the next worker picks it up.
update jobs
set status = 'queued', run_after = now()
where status = 'running'
  and started_at < now() - interval '10 minutes'
  and attempts < max_attempts;
