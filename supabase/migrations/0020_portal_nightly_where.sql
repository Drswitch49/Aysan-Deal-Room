-- Fix portal_nightly(): the staleness recalculation had no WHERE clause.
--
-- Two problems with the original, both real:
--
--   1. It does not run. Safe updates are enforced on this database, so an
--      UPDATE with no WHERE is refused outright ("UPDATE requires a WHERE
--      clause") — and because the whole function is one transaction, the
--      refusal took the certification expiry and the invite expiry down with
--      it. The nightly job would have failed every night from the first run.
--
--   2. Even if it ran, it rewrote every investor row nightly whether anything
--      had changed or not, and the audit trigger on `investors` would have
--      written one row per partner per night — burying the writes that matter
--      in a log nobody can then read.
--
-- Restricting the update to rows whose flag would actually change fixes both.

create or replace function portal_nightly() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare expired_certs int; stale int; expired_invites int; lapsed_readonly int;
begin
  update investors set certification_status = 'expired'
   where certification_status = 'valid'
     and certification_date <= current_date - interval '12 months';
  get diagnostics expired_certs = row_count;

  -- Only the rows that actually flip.
  update investors
     set staleness_flag = (last_touch is null or last_touch < current_date - 90)
   where staleness_flag is distinct from (last_touch is null or last_touch < current_date - 90)
     and deleted_at is null;
  get diagnostics stale = row_count;

  update portal_invites set status = 'expired'
   where status = 'active' and expires_at < now();
  get diagnostics expired_invites = row_count;

  update investor_auth_map set login_mode = 'revoked'
   where login_mode = 'read_only' and read_only_until < current_date;
  get diagnostics lapsed_readonly = row_count;

  return jsonb_build_object(
    'certifications_expired', expired_certs,
    'staleness_recalculated', stale,
    'invites_expired', expired_invites,
    'read_only_lapsed', lapsed_readonly
  );
end $$;
