-- Reconcile the legacy `status` text with the authoritative lifecycle `stage`.
--
-- `stage` is what the inbox filters, the pill counts and the dashboard count,
-- and what a transition writes. `status` is a display label that the Airtable
-- migration carried over unreconciled and that the inbox edit form used to
-- write on its own, without moving `stage`. The result:
--   * 1,623 of 1,814 rows had status NULL, which the UI defaulted to "Inbox" —
--     so the detail modal reported almost every deal as Inbox; and
--   * ~40 rows actively contradicted their stage (deals in `inbox` labelled
--     "Active", `archived` deals labelled "Active").
--
-- The app now derives the label from `stage` on read and writes `status` only
-- through a real transition, so this backfill makes the stored column agree
-- with what is displayed. Values match STATUS_TO_STAGE / STAGE_TO_STATUS
-- exactly, so it is idempotent and safe to re-run.

update deals
set status = case stage
               when 'inbox'    then 'Inbox'
               when 'review'   then 'Review'
               when 'active'   then 'Active'
               when 'archived' then 'Kill'
             end
where deleted_at is null
  and status is distinct from (case stage
                                 when 'inbox'    then 'Inbox'
                                 when 'review'   then 'Review'
                                 when 'active'   then 'Active'
                                 when 'archived' then 'Kill'
                               end);
