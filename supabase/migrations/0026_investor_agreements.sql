-- ═══════════════════════════════════════════════════════════════════════════
--  0026 — Investors Agreement and Deal Memorandum receipts
--
--  1. A capital partner signs the Investors Agreement (lib/core/investor-
--     agreement.ts) after choosing their own password and before their portal
--     opens. Each signature keeps the exact text the partner was shown, its
--     SHA-256, the typed name, the details it was made out to, and where it
--     was signed from. Append only: the one permitted change is the sponsor's
--     countersignature, written once.
--  2. investors gains the address and indicative pledge the agreement is made
--     out to. Staff pre-fill them; the partner confirms them when signing.
--  3. Deal Memorandum receipts (the O2 Acquisition Memorandum). The partner
--     confirms receipt in the portal, which starts the 10-business-day right
--     of first refusal window in clause 3.3, and then exercises or waives it,
--     once.
-- ═══════════════════════════════════════════════════════════════════════════

alter table investors add column if not exists address text;
alter table investors add column if not exists pledge_pence bigint;
do $$ begin
  alter table investors add constraint pledge_positive check (pledge_pence is null or pledge_pence > 0);
exception when duplicate_object then null;
end $$;

-- ─── Signatures ─────────────────────────────────────────────────────────────

create table if not exists investor_agreement_signatures (
  id               uuid primary key default gen_random_uuid(),
  investor_id      uuid not null references investors(id) on delete cascade,
  agreement_key    text not null default 'investors_agreement',
  version          int  not null,
  -- Signed while the text was still the draft template (test partners only).
  draft            boolean not null default false,
  agreement_date   date not null,
  body             text not null,
  text_sha256      text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  signed_name      text not null check (length(btrim(signed_name)) >= 2),
  signer_entity    text,
  signer_address   text not null,
  pledge_pence     bigint not null check (pledge_pence > 0),
  signed_at        timestamptz not null default now(),
  ip               inet,
  user_agent       text,
  countersigned_name     text,
  countersigned_by_email text,
  countersigned_at       timestamptz,
  unique (investor_id, agreement_key, version)
);
create index if not exists idx_agreement_signatures_investor on investor_agreement_signatures (investor_id);

create or replace function guard_agreement_signature() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- Only a full erasure of the partner (migration 0021) removes a signature.
    if acp_erasing() then return old; end if;
    raise exception 'append_only_table'
      using hint = 'A signed agreement cannot be deleted.';
  end if;
  -- UPDATE: the countersignature may be written once; nothing else may change.
  if old.countersigned_at is not null
     or (to_jsonb(new) - array['countersigned_name','countersigned_by_email','countersigned_at'])
        is distinct from
        (to_jsonb(old) - array['countersigned_name','countersigned_by_email','countersigned_at'])
     or new.countersigned_at is null or new.countersigned_name is null then
    raise exception 'append_only_table'
      using hint = 'A signed agreement cannot be changed; only a single countersignature may be added.';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_agreement_signature on investor_agreement_signatures;
create trigger trg_guard_agreement_signature before update or delete on investor_agreement_signatures
  for each row execute function guard_agreement_signature();

alter table investor_agreement_signatures enable row level security;
revoke all on investor_agreement_signatures from anon, authenticated;

-- ─── Deal Memorandum receipts and ROFR elections ────────────────────────────
-- document_id is kept as evidence even if the document row later goes: it is
-- set null, and the title and deal stay on the receipt.

create table if not exists memorandum_receipts (
  id           uuid primary key default gen_random_uuid(),
  investor_id  uuid not null references investors(id) on delete cascade,
  document_id  uuid references investor_documents(id) on delete set null,
  deal_id      uuid references deals(id) on delete set null,
  doc_title    text not null,
  doc_version  int  not null default 1,
  received_at  timestamptz not null default now(),
  respond_by   date not null,
  election     text check (election in ('exercise','waive')),
  elected_at   timestamptz,
  ip           inet,
  user_agent   text,
  constraint election_has_time check ((election is null) = (elected_at is null)),
  unique (investor_id, document_id)
);
create index if not exists idx_memorandum_receipts_deal on memorandum_receipts (deal_id);

create or replace function guard_memorandum_receipt() returns trigger
language plpgsql as $$
begin
  -- The foreign keys' own "set null", when a document or deal is deleted, is
  -- the one other change allowed.
  if (to_jsonb(new) - array['document_id','deal_id']) = (to_jsonb(old) - array['document_id','deal_id'])
     and (new.document_id is null or new.document_id = old.document_id)
     and (new.deal_id is null or new.deal_id = old.deal_id) then
    return new;
  end if;
  if old.election is not null
     or (to_jsonb(new) - array['election','elected_at']) is distinct from (to_jsonb(old) - array['election','elected_at']) then
    raise exception 'append_only_table'
      using hint = 'A memorandum receipt cannot be changed once recorded; the election is made once.';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_memorandum_receipt on memorandum_receipts;
create trigger trg_guard_memorandum_receipt before update on memorandum_receipts
  for each row execute function guard_memorandum_receipt();

alter table memorandum_receipts enable row level security;
revoke all on memorandum_receipts from anon, authenticated;
