-- Permanent erasure of a capital partner.
--
-- An admin can wipe a partner from the system entirely: the record, the
-- linked stakeholder card, their login binding, invites, documents,
-- commitments, capital transactions, HoldCo shareholdings, every log row and
-- every queued email — and, by the user's explicit choice (2026-09-24), the
-- audit trail too, with nothing recording that the erasure happened.
--
-- The obstacle is R7: activity_log, access_log and audit_logs are append only,
-- enforced by block_mutation(), and every write to a partner table is copied
-- into audit_logs by audit_row(). A plain DELETE therefore either fails (the
-- cascade into activity_log is refused) or leaves the partner's details behind
-- in the audit copies it writes on the way out.
--
-- Both functions now step aside while `acp.erasing` is set for the current
-- transaction. The only thing that sets it is erase_investor() below, a
-- SECURITY DEFINER function that is not executable by anon or authenticated,
-- so the append-only rule still holds for every other statement.

create or replace function acp_erasing() returns boolean
language sql stable as $$
  select coalesce(current_setting('acp.erasing', true), '') = 'on'
$$;

create or replace function block_mutation() returns trigger
language plpgsql as $$
begin
  if acp_erasing() and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'append_only_table'
    using hint = format('%s is append only; %s is not permitted.', tg_table_name, tg_op);
end $$;

-- Same body as 0019, plus the erasure short-circuit: an erasure must not write
-- a fresh copy of the row it is removing.
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  row_id text;
begin
  if acp_erasing() then
    return coalesce(new, old);
  end if;
  row_id := coalesce(
    (to_jsonb(case when tg_op = 'DELETE' then old else new end) ->> 'id'),
    null
  );
  insert into audit_logs (
    action, event_type, entity_type, entity_id,
    operator, operator_role, details,
    old_value, new_value, reason, occurred_at
  ) values (
    tg_op,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    row_id,
    nullif(current_setting('acp.actor_email', true), ''),
    acp_actor_role(),
    'Partner portal ' || lower(tg_op) || ' on ' || tg_table_name,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    nullif(current_setting('acp.actor_reason', true), ''),
    now()
  );
  return coalesce(new, old);
end $$;

-- Erase one partner and everything about them. Returns the auth user id (if
-- any) so the API can delete the login from Supabase Auth, which lives outside
-- this schema, plus counts of what was removed.
create or replace function erase_investor(p_investor uuid, p_actor_role text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  inv            investors%rowtype;
  v_auth_uid     uuid;
  v_commitments  uuid[];
  v_txns         uuid[];
  v_invites      uuid[];
  v_docs         uuid[];
  v_stakeholders uuid[];
  v_ids          text[];
  n_txns int; n_commitments int; n_holdco int; n_docs int;
  n_activity int; n_access int; n_mail int; n_audit int; n_stakeholders int;
begin
  if coalesce(p_actor_role, '') not in ('owner','managing_partner','admin') then
    raise exception 'not_authorised';
  end if;

  select * into inv from investors where id = p_investor;
  if not found then
    raise exception 'investor_not_found';
  end if;

  perform set_config('acp.erasing', 'on', true);

  select auth_uid into v_auth_uid from investor_auth_map where investor_id = p_investor;

  select coalesce(array_agg(id), '{}') into v_commitments from commitments where investor_id = p_investor;
  select coalesce(array_agg(id), '{}') into v_txns from capital_transactions where commitment_id = any(v_commitments);
  select coalesce(array_agg(id), '{}') into v_invites from portal_invites where investor_id = p_investor;
  select coalesce(array_agg(id), '{}') into v_docs from investor_documents where investor_id = p_investor;

  -- The linked stakeholder card, plus any other Investor-type card for the
  -- same email: left behind, editing it would quietly re-create the partner.
  select coalesce(array_agg(id), '{}') into v_stakeholders
    from external_stakeholders
   where id = inv.stakeholder_id
      or (lower(coalesce(email, '')) = lower(inv.email) and lower(coalesce(type, '')) = 'investor');

  -- Every id an audit row about this partner could be filed under.
  v_ids := array[p_investor::text]
        || coalesce(v_auth_uid::text, p_investor::text)
        || v_commitments::text[] || v_txns::text[] || v_invites::text[]
        || v_docs::text[] || v_stakeholders::text[];

  delete from audit_logs
   where entity_id = any(v_ids)
      or old_value ->> 'investor_id' = p_investor::text
      or new_value ->> 'investor_id' = p_investor::text;
  get diagnostics n_audit = row_count;

  delete from capital_transactions where id = any(v_txns);
  get diagnostics n_txns = row_count;
  delete from holdco_shareholdings where investor_id = p_investor;
  get diagnostics n_holdco = row_count;
  delete from commitments where id = any(v_commitments);
  get diagnostics n_commitments = row_count;

  delete from investor_documents where investor_id = p_investor;
  get diagnostics n_docs = row_count;
  delete from activity_log where investor_id = p_investor;
  get diagnostics n_activity = row_count;
  delete from access_log where investor_id = p_investor or (v_auth_uid is not null and auth_uid = v_auth_uid);
  get diagnostics n_access = row_count;
  -- Queued and sent mail both carry the partner's address, and credentials
  -- rows carry a password.
  delete from email_queue where investor_id = p_investor or lower(coalesce(intended_to, '')) = lower(inv.email);
  get diagnostics n_mail = row_count;

  -- investor_auth_map and portal_invites cascade from here.
  delete from investors where id = p_investor;

  delete from external_stakeholders where id = any(v_stakeholders);
  get diagnostics n_stakeholders = row_count;

  -- Close the door again: the setting is transaction-local, but nothing else
  -- in this transaction should get past the append-only rule either.
  perform set_config('acp.erasing', '', true);

  return jsonb_build_object(
    'auth_uid', v_auth_uid,
    'email', inv.email,
    'removed', jsonb_build_object(
      'commitments', n_commitments,
      'capital_transactions', n_txns,
      'holdco_shareholdings', n_holdco,
      'documents', n_docs,
      'activity_log', n_activity,
      'access_log', n_access,
      'emails', n_mail,
      'audit_logs', n_audit,
      'stakeholder_cards', n_stakeholders
    )
  );
end $$;

revoke all on function erase_investor(uuid, text) from public, anon, authenticated;
grant execute on function erase_investor(uuid, text) to service_role;
