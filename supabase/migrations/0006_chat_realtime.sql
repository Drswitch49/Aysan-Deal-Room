-- ═══════════════════════════════════════════════════════════════════════════
--  Realtime deal chat
--  ---------------------------------------------------------------------------
--  Replaces the frontend's 8s/15s polling of /api/chats with Supabase Realtime.
--  The browser opens an authenticated realtime socket (user's Supabase JWT) and
--  subscribes to INSERTs on chat_messages. That means the *browser* now reads
--  this table directly, so it needs RLS SELECT policies (until now every read
--  went through the service-role REST API, which bypasses RLS).
--
--  Writes are unchanged: /api/chats still inserts via the service-role client,
--  so no INSERT/UPDATE policy is added here — the browser can only listen.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Publish chat_messages on the realtime publication (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    execute 'alter publication supabase_realtime add table chat_messages';
  end if;
end $$;

-- 2) SELECT policies — scoped so realtime only delivers rows the user may see.
--    (RLS is already enabled on chat_messages from 0001; it was default-deny.)

-- Staff (ACP team) can read every deal's chat.
drop policy if exists chat_select_staff on chat_messages;
create policy chat_select_staff on chat_messages
  for select to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') in
      ('owner', 'managing_partner', 'partner', 'analyst', 'hr', 'admin', 'read_only')
  );

-- A lender portal account can read only its own thread (rows tagged with its
-- lender_id, taken from the server-controlled app_metadata claim).
drop policy if exists chat_select_own_lender on chat_messages;
create policy chat_select_own_lender on chat_messages
  for select to authenticated
  using (
    lender_id = nullif(auth.jwt() -> 'app_metadata' ->> 'lender_id', '')::uuid
  );
