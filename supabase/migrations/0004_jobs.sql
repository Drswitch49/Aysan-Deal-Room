-- Phase 5: self-hosted background job queue (replaces Inngest + Upstash QStash).
-- Claimed by the Vercel-Cron-driven worker with FOR UPDATE SKIP LOCKED.

create type job_status as enum ('queued', 'running', 'done', 'failed');

create table jobs (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,                      -- handler key, e.g. 'document-analysis'
  payload      jsonb not null default '{}'::jsonb,
  status       job_status not null default 'queued',
  attempts     integer not null default 0,
  max_attempts integer not null default 3,
  run_after    timestamptz not null default now(), -- backoff scheduling
  started_at   timestamptz,
  finished_at  timestamptz,
  result       jsonb,
  error        text,
  created_by   text,                               -- operator email
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_jobs_claim on jobs (run_after) where status = 'queued';
create index idx_jobs_type on jobs (type);
create trigger trg_jobs_updated before update on jobs
  for each row execute function set_updated_at();

alter table jobs enable row level security;

-- Atomic claim used by the worker: grabs up to `batch` due jobs, marks them
-- running, returns them. SKIP LOCKED makes concurrent workers safe.
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
      where status = 'queued' and run_after <= now()
      order by created_at
      limit batch
      for update skip locked
   )
  returning j.*;
end;
$$;
