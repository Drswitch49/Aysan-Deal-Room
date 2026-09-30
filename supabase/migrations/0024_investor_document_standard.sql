-- ═══════════════════════════════════════════════════════════════════════════
--  0024 — Investor Portal Document Standard v1.1
--
--  Every capital partner, in every acquisition, receives the same 11 documents
--  across 7 categories (Investor Documents and Portal: Team Summary v1.0).
--
--  1. investor_documents carries a category and one of the 11 doc types. The
--     old "other" type is retired: nothing visible is filed without one of the
--     7 categories. Existing rows are re-filed by the code in their title
--     (01_C1_…, 02_O1_…), then by their old type.
--  2. Versions. A correction is a new row that supersedes the old one; the old
--     one stays visible, marked superseded. A released document is locked and
--     can never be deleted, only revoked.
--  3. Sign-offs for the capital gates (legal counsel approval, CFO sanctions)
--     live on the document version they approve. The gates themselves are
--     evaluated by the API on every partner read (api/_lib/document-gates.ts).
--  4. Offer documents are view only, and each partner gets a watermarked,
--     numbered copy (investor_document_copies logs every issue).
--  5. P0: a subscription cannot be marked completed until that partner has a
--     completion statement (payment receipt) and a share certificate on file.
--     is_test on investors and commitments keeps test holdings away from real
--     partners.
--  6. P2: deals carry a lane (1 statutory compliance, 2 regulated clinical) and
--     an acquisition number, used for "Acquisition nn" naming.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── The standard's vocabulary ──────────────────────────────────────────────

create or replace function investor_doc_category(p_doc_type text) returns text
language sql immutable as $$
  select case p_doc_type
    when 'onboarding_pack'      then 'certification'
    when 'brief'                then 'offer'
    when 'diligence_pack'       then 'offer'
    when 'term_sheet'           then 'offer'
    when 'legal_pack'           then 'legal'
    when 'completion_statement' then 'ownership'
    when 'share_certificate'    then 'ownership'
    when 'quarterly_report'     then 'reporting'
    when 'annual_statement'     then 'reporting'
    when 'distribution_notice'  then 'distributions'
    when 'partner_notice'       then 'notices'
  end
$$;

-- ─── New columns ────────────────────────────────────────────────────────────

alter table investor_documents add column if not exists category      text;
alter table investor_documents add column if not exists notice_type   text;
alter table investor_documents add column if not exists version       int not null default 1;
alter table investor_documents add column if not exists supersedes_id uuid references investor_documents(id);
alter table investor_documents add column if not exists signoffs      jsonb not null default '{}'::jsonb;
alter table investor_documents add column if not exists event_date    date;
-- Which file of a quarterly report this is: the report itself or its certificate.
alter table investor_documents add column if not exists report_part   text check (report_part in ('report','certificate'));

create index if not exists idx_investor_documents_supersedes on investor_documents (supersedes_id);

alter table investors   add column if not exists is_test boolean not null default false;
alter table commitments add column if not exists is_test boolean not null default false;

alter table deals add column if not exists lane           smallint check (lane in (1, 2));
alter table deals add column if not exists acquisition_no int check (acquisition_no > 0);
create unique index if not exists uq_deals_acquisition_no on deals (acquisition_no) where acquisition_no is not null;

-- ─── Re-file existing documents ─────────────────────────────────────────────

alter table investor_documents drop constraint if exists investor_documents_doc_type_check;

update investor_documents
   set report_part = case when doc_type = 'covenant_certificate' then 'certificate' else 'report' end
 where deal_report_id is not null and report_part is null;

update investor_documents set doc_type = case
    when title ~* '(^|_)C1_'  then 'onboarding_pack'
    when title ~* '(^|_)O1_' or title ~* 'capital_partner_brief' then 'brief'
    when title ~* '(^|_)O2_'  then 'diligence_pack'
    when title ~* '(^|_)O3_'  then 'term_sheet'
    when title ~* '(^|_)L1_'  then 'legal_pack'
    when title ~* '(^|_)OW1_' then 'completion_statement'
    when title ~* '(^|_)OW2_' then 'share_certificate'
    when title ~* '(^|_)R1_'  then 'quarterly_report'
    when title ~* '(^|_)R2_'  then 'annual_statement'
    when title ~* '(^|_)D1_'  then 'distribution_notice'
    when title ~* '(^|_)N1_'  then 'partner_notice'
    when doc_type = 'certification' then 'onboarding_pack'
    when doc_type in ('subscription', 'spv_sha') then 'legal_pack'
    when doc_type = 'covenant_certificate' and deal_report_id is not null then 'quarterly_report'
    when doc_type = 'notice' then 'partner_notice'
    else doc_type
  end
 where investor_doc_category(doc_type) is null;

update investor_documents set notice_type = 'material_event'
 where doc_type = 'partner_notice' and notice_type is null;

-- Anything that still has no place in the standard (an internal gate register
-- was shared with partners) is withdrawn from partners. The file and the row
-- stay; it can be re-filed under one of the 7 categories and restored.
update investor_documents set revoked_at = now()
 where investor_doc_category(doc_type) is null and revoked_at is null;

update investor_documents set category = investor_doc_category(doc_type)
 where investor_doc_category(doc_type) is not null;

-- Offer documents are view only.
update investor_documents set view_only = true where category = 'offer' and not view_only;

-- A document that was visible without a release date keeps being visible:
-- from now on a row with neither published_at nor publishes_on is a draft.
update investor_documents set published_at = uploaded_at
 where published_at is null and publishes_on is null
   and (cloudinary_public_id is not null or file_link is not null or storage_path is not null);

-- ─── Constraints ────────────────────────────────────────────────────────────

alter table investor_documents drop constraint if exists investor_documents_standard_type;
alter table investor_documents add constraint investor_documents_standard_type check (
  (investor_doc_category(doc_type) is not null and category = investor_doc_category(doc_type))
  or (revoked_at is not null and category is null
      and doc_type in ('subscription','spv_sha','certification','quarterly_report','covenant_certificate','notice','other'))
);

alter table investor_documents drop constraint if exists investor_documents_notice_type;
alter table investor_documents add constraint investor_documents_notice_type check (
  (doc_type = 'partner_notice') = (notice_type is not null)
  and (notice_type is null or notice_type in
    ('material_event','deal_killed','buyback_exercise','buyback_outcome','conversion','recertification_due'))
);

alter table investor_documents drop constraint if exists investor_documents_offer_view_only;
alter table investor_documents add constraint investor_documents_offer_view_only check (
  category is distinct from 'offer' or view_only
);

alter table investor_documents drop constraint if exists investor_documents_version_positive;
alter table investor_documents add constraint investor_documents_version_positive check (version >= 1);

-- ─── Released documents are records of fact ─────────────────────────────────
-- Once released (published_at set) a document can only be revoked or restored.
-- A correction is a new version. Nothing released is ever deleted, except by
-- erase_investor(), which the partner's full-erasure decision allows.

create or replace function lock_released_document() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if acp_erasing() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.published_at is not null then raise exception 'released_document_kept'; end if;
    return old;
  end if;

  if old.published_at is not null then
    if new.published_at is null then raise exception 'released_document_locked'; end if;
    if (new.doc_type, new.category, new.notice_type, new.title, new.investor_id, new.deal_id,
        new.version, new.supersedes_id, new.signoffs, new.event_date, new.view_only,
        new.cloudinary_public_id, new.file_link, new.storage_path, new.publishes_on)
       is distinct from
       (old.doc_type, old.category, old.notice_type, old.title, old.investor_id, old.deal_id,
        old.version, old.supersedes_id, old.signoffs, old.event_date, old.view_only,
        old.cloudinary_public_id, old.file_link, old.storage_path, old.publishes_on)
    then raise exception 'released_document_locked'; end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_lock_released_document on investor_documents;
create trigger trg_lock_released_document before update or delete on investor_documents
  for each row execute function lock_released_document();

-- ─── Watermarked copies of Offer documents ──────────────────────────────────
-- One numbered copy per partner per document version. The row is the issue
-- log: partner, version, copy number, date.

create table if not exists investor_document_copies (
  id                       uuid primary key default gen_random_uuid(),
  document_id              uuid not null references investor_documents(id) on delete cascade,
  investor_id              uuid not null references investors(id) on delete cascade,
  copy_no                  int not null,
  cloudinary_public_id     text not null,
  cloudinary_resource_type text not null default 'image',
  created_at               timestamptz not null default now(),
  unique (document_id, investor_id),
  unique (document_id, copy_no)
);
alter table investor_document_copies enable row level security;
revoke all on investor_document_copies from anon, authenticated;

-- ─── P0: completion needs a payment receipt and a share certificate ─────────

create or replace function gate_commitment_completion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status = 'pending') then
    if not exists (
      select 1 from investor_documents d
       where d.investor_id = new.investor_id and d.deal_id = new.deal_id
         and d.doc_type = 'completion_statement' and d.revoked_at is null
         and (d.cloudinary_public_id is not null or d.file_link is not null)
    ) or not exists (
      select 1 from investor_documents d
       where d.investor_id = new.investor_id and d.deal_id = new.deal_id
         and d.doc_type = 'share_certificate' and d.revoked_at is null
         and (d.cloudinary_public_id is not null or d.file_link is not null)
    ) then
      raise exception 'completion_needs_receipt_and_certificate';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_commitment_completion on commitments;
create trigger trg_commitment_completion before insert or update of status on commitments
  for each row execute function gate_commitment_completion();

-- ─── Partner views ──────────────────────────────────────────────────────────
-- CREATE OR REPLACE VIEW may add columns at the end, never reorder or drop.
-- A test holding reaches only a test partner.

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
  d.business_description,
  d.lane,
  d.acquisition_no
from commitments c
join deals d on d.id = c.deal_id
join investors i on i.id = c.investor_id
left join deal_partner_profiles p on p.deal_id = d.id
where c.status in ('completed','converted','bought_back')
  and d.deleted_at is null
  and (not c.is_test or i.is_test);

create or replace view partner_capital_transactions with (security_barrier) as
select
  c.investor_id,
  t.id, c.deal_id as deal_key, t.type, t.amount_pence,
  t.txn_date, t.due_date, t.settled
from capital_transactions t
join commitments c on c.id = t.commitment_id
join investors i on i.id = c.investor_id
where t.type in ('call','distribution')
  and (not c.is_test or i.is_test);

-- Deal-wide documents reach partners whose subscription is live. Offer, legal,
-- certification and notice documents also reach a partner still subscribing
-- (pending): they are what the partner reads and signs before completion.
-- Drafts (neither released nor scheduled) never reach a partner.
create or replace view partner_documents with (security_barrier) as
select distinct
  coalesce(doc.investor_id, c.investor_id) as investor_id,
  doc.id, doc.deal_id as deal_key,
  coalesce(nullif(btrim(d.partner_display_name), ''), d.acp_ref_no) as partner_display_name,
  doc.doc_type, doc.title, doc.view_only,
  doc.publishes_on, doc.published_at,
  (doc.published_at is not null) as available,
  (doc.cloudinary_public_id is not null or doc.file_link is not null) as has_file,
  doc.file_format,
  doc.file_bytes,
  doc.category,
  doc.notice_type,
  doc.version,
  doc.supersedes_id,
  doc.event_date,
  d.acquisition_no,
  d.lane
from investor_documents doc
left join deals d on d.id = doc.deal_id
left join commitments c
       on doc.investor_id is null
      and c.deal_id = doc.deal_id
      and (c.status in ('completed','converted','bought_back')
           or (c.status = 'pending' and doc.category in ('certification','offer','legal','notices')))
left join investors ci on ci.id = c.investor_id
where (doc.investor_id is not null or c.investor_id is not null)
  and (c.id is null or not c.is_test or ci.is_test)
  and doc.revoked_at is null
  and doc.category is not null
  and (doc.published_at is not null or doc.publishes_on is not null);
-- cloudinary_public_id, storage_path, file_link and signoffs stay out of the view.

create or replace view partner_reports with (security_barrier) as
select distinct
  c.investor_id,
  r.id, r.deal_id as deal_key, r.period_label,
  r.publishes_on, r.published_at,
  case when r.published_at is not null then r.trading_summary end    as trading_summary,
  case when r.published_at is not null then r.coverage_at_period end as coverage_at_period,
  (select doc.id from investor_documents doc
    where doc.deal_report_id = r.id and doc.report_part = 'report'
      and doc.revoked_at is null
    order by doc.uploaded_at desc limit 1)                          as report_document_id,
  (select doc.id from investor_documents doc
    where doc.deal_report_id = r.id and doc.report_part = 'certificate'
      and doc.revoked_at is null
    order by doc.uploaded_at desc limit 1)                          as certificate_document_id
from deal_reports r
join commitments c on c.deal_id = r.deal_id
 and c.status in ('completed','converted','bought_back')
join investors i on i.id = c.investor_id
where not c.is_test or i.is_test;

-- Re-assert the locks from 0019 on every replaced view.
alter view partner_deal_view            set (security_invoker = true);
alter view partner_capital_transactions set (security_invoker = true);
alter view partner_documents            set (security_invoker = true);
alter view partner_reports              set (security_invoker = true);
revoke all on partner_deal_view, partner_capital_transactions, partner_documents, partner_reports
  from anon, authenticated;
grant select on partner_deal_view, partner_capital_transactions, partner_documents, partner_reports
  to service_role;
