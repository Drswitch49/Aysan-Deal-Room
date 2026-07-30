-- Fail jobs whose worker died on the final attempt.
--
-- 0009 reclaims a stranded 'running' job only while it has retries left. One
-- that dies on its last attempt is stranded permanently: it never re-queues and
-- never reports, so the UI polls a job that will never finish. claim_jobs now
-- expires those first, on every worker tick, so the failure is visible.

create or replace function claim_jobs(batch integer default 5)
returns setof jobs
language plpgsql
security definer
as $$
begin
  -- Self-heal: a lease-expired job with no retries left is a dead job.
  update jobs
     set status = 'failed',
         finished_at = now(),
         error = coalesce(nullif(error, ''),
                          'Worker stopped before the job finished (lease expired, retries exhausted)')
   where status = 'running'
     and started_at < now() - interval '10 minutes'
     and attempts >= max_attempts;

  return query
  update jobs j
     set status = 'running', started_at = now(), attempts = j.attempts + 1
   where j.id in (
     select id from jobs
      where (status = 'queued' and run_after <= now())
         -- Lease expired with retries left: the worker that claimed it is gone.
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

-- Clear anything already stranded by the old behaviour.
update jobs
set status = 'failed',
    finished_at = now(),
    error = coalesce(nullif(error, ''),
                     'Worker stopped before the job finished (lease expired, retries exhausted)')
where status = 'running'
  and started_at < now() - interval '10 minutes'
  and attempts >= max_attempts;
