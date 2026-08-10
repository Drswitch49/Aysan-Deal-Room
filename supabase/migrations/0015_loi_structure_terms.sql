-- LOI deal-structure terms.
--
-- The LOI tab's structure parameters (cash at completion, VLN, deferred
-- consideration, target completion, exclusivity) had nowhere to live, so the
-- tab held them in component state seeded with one hardcoded set of figures —
-- every deal's letter drafted with the same £525k/£341k/£105k/£79k terms.
-- They belong on the deal alongside enterprise_value/turnover/ebitda_gbp, so
-- the letter, the deal record and the edit form all read the same numbers.

alter table deals add column if not exists loi_cash_at_close          numeric;
alter table deals add column if not exists loi_vln_amount             numeric;
alter table deals add column if not exists loi_deferred_consideration numeric;
alter table deals add column if not exists loi_target_completion      text;
alter table deals add column if not exists loi_exclusivity_period     text;

comment on column deals.loi_cash_at_close          is 'LOI: cash payable at completion (GBP)';
comment on column deals.loi_vln_amount             is 'LOI: vendor loan note principal (GBP)';
comment on column deals.loi_deferred_consideration is 'LOI: deferred consideration (GBP)';
comment on column deals.loi_target_completion      is 'LOI: target completion date, as drafted (free text, e.g. "31 July 2026")';
comment on column deals.loi_exclusivity_period     is 'LOI: exclusivity period, as drafted (free text, e.g. "30 days")';
