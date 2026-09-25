-- ═══════════════════════════════════════════════════════════════════════════
--  0022 — partner documents you can actually open, and a name for every deal
--
--  1. A deal with no partner-facing name showed partners the word
--     "Acquisition". It now falls back to the ACP reference (ACP-032), which
--     identifies the deal without naming the company.
--  2. The Business tab read only deal_partner_profiles, which nobody had filled
--     in, so partners saw an empty tab. The view now also carries the deal's
--     business description — the same text the team sees on the deal — and the
--     portal shows it whenever no partner summary has been written.
--  3. Documents: staff upload the file to Cloudinary (authenticated asset), and
--     the partner opens it through /api/investor-portal/documents/open, which
--     checks scope, logs doc_open and hands back a short-lived signed URL. The
--     view still never carries the public id. revoked_at hides a document from
--     every partner without deleting the file.
-- ═══════════════════════════════════════════════════════════════════════════

alter table investor_documents add column if not exists cloudinary_public_id     text;
alter table investor_documents add column if not exists cloudinary_resource_type text;
alter table investor_documents add column if not exists file_format              text;
alter table investor_documents add column if not exists file_name                text;
alter table investor_documents add column if not exists file_bytes               bigint;
alter table investor_documents add column if not exists revoked_at               timestamptz;

alter table investor_documents drop constraint if exists doc_has_a_source;
alter table investor_documents add constraint doc_has_a_source check (
  cloudinary_public_id is not null or storage_path is not null
  or file_link is not null or publishes_on is not null
);

-- Columns are appended after the existing ones: CREATE OR REPLACE VIEW may add
-- columns at the end but never reorder or drop them.
create or replace view partner_deal_view with (security_barrier) as
select
  c.investor_id,
  d.id            as deal_key,
  coalesce(nullif(btrim(d.partner_display_name), ''), d.acp_ref_no) as display_name,
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
  p.headcount_band, p.founded_year, p.milestones,
  d.business_description
from commitments c
join deals d on d.id = c.deal_id
left join deal_partner_profiles p on p.deal_id = d.id
where c.status in ('completed','converted','bought_back')
  and d.deleted_at is null;

create or replace view partner_documents with (security_barrier) as
select distinct
  coalesce(doc.investor_id, c.investor_id) as investor_id,
  doc.id, doc.deal_id as deal_key,
  coalesce(nullif(btrim(d.partner_display_name), ''), d.acp_ref_no) as partner_display_name,
  doc.doc_type, doc.title, doc.view_only,
  doc.publishes_on, doc.published_at,
  (doc.published_at is not null or doc.publishes_on is null) as available,
  (doc.cloudinary_public_id is not null or doc.file_link is not null) as has_file,
  doc.file_format,
  doc.file_bytes
from investor_documents doc
left join deals d on d.id = doc.deal_id
left join commitments c
       on doc.investor_id is null
      and c.deal_id = doc.deal_id
      and c.status in ('completed','converted','bought_back')
where (doc.investor_id is not null or c.investor_id is not null)
  and doc.revoked_at is null;
-- cloudinary_public_id, storage_path and file_link stay out of the view.

-- Re-assert the locks from 0019: a replaced view must not come back readable.
alter view partner_deal_view set (security_invoker = true);
alter view partner_documents set (security_invoker = true);
revoke all on partner_deal_view, partner_documents from anon, authenticated;
grant select on partner_deal_view, partner_documents to service_role;
