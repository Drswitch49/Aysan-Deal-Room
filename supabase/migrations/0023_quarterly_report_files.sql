-- ═══════════════════════════════════════════════════════════════════════════
--  0023 — quarterly reports carry their files
--
--  A report was a period label, a date and a trading line; the report PDF and
--  covenant certificate were bare link columns nobody could fill from the app.
--  Staff now upload those files when they schedule a report (Investors →
--  Quarterly reports). Each file is an investor_documents row for the whole
--  deal, tied back to its report, so it is delivered by the existing signed,
--  logged document route and reaches every partner in the deal.
--
--  Until the report publishes, its documents stay in the "Publishes <date>"
--  state, and the trading summary and coverage are withheld from the view:
--  a scheduled report must not show its numbers early.
-- ═══════════════════════════════════════════════════════════════════════════

alter table investor_documents
  add column if not exists deal_report_id uuid references deal_reports(id) on delete cascade;
create index if not exists idx_investor_documents_report on investor_documents (deal_report_id);

create or replace view partner_reports with (security_barrier) as
select distinct
  c.investor_id,
  r.id, r.deal_id as deal_key, r.period_label,
  r.publishes_on, r.published_at,
  case when r.published_at is not null then r.trading_summary end    as trading_summary,
  case when r.published_at is not null then r.coverage_at_period end as coverage_at_period,
  (select doc.id from investor_documents doc
    where doc.deal_report_id = r.id and doc.doc_type = 'quarterly_report'
      and doc.revoked_at is null
    order by doc.uploaded_at desc limit 1)                          as report_document_id,
  (select doc.id from investor_documents doc
    where doc.deal_report_id = r.id and doc.doc_type = 'covenant_certificate'
      and doc.revoked_at is null
    order by doc.uploaded_at desc limit 1)                          as certificate_document_id
from deal_reports r
join commitments c on c.deal_id = r.deal_id
 and c.status in ('completed','converted','bought_back');

-- Re-assert the locks from 0019 on the replaced view.
alter view partner_reports set (security_invoker = true);
revoke all on partner_reports from anon, authenticated;
grant select on partner_reports to service_role;
