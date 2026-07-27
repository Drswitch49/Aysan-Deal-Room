-- Phase 5c: OSINT enrichment results live on the deal (replaces the legacy
-- Airtable OSINT_* columns written by the deleted Inngest workflow).
alter table deals add column if not exists osint jsonb;
alter table deals add column if not exists osint_status text;
alter table deals add column if not exists osint_summary text;
alter table deals add column if not exists osint_completed_at timestamptz;
