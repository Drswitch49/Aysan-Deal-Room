-- Phase 4: link app tables to Supabase Auth users.
alter table profiles add column if not exists auth_user_id uuid unique;
create index if not exists idx_profiles_auth_user on profiles(auth_user_id);
-- lenders.auth_user_id and shareholders.auth_user_id already exist (0001).
create index if not exists idx_lenders_auth_user on lenders(auth_user_id);
create index if not exists idx_shareholders_auth_user on shareholders(auth_user_id);
