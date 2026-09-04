-- Put stranded chat messages back into a lender thread.
--
-- lender_id is the only handle a chat message has: the admin inbox builds its
-- conversation list by grouping messages on it, and the lender's own RLS policy
-- matches on it. The lender portal never sent one when posting, so every
-- message a lender wrote was stored with lender_id NULL — in the table, but in
-- nobody's thread, which is why admins never saw lender mail. /api/chats now
-- stamps the sender's own lender id server-side; these are the rows written
-- before it did.
--
-- Attribution is unambiguous rather than guessed: each affected deal has
-- exactly one lender assigned, so the sole assignee is the only party that
-- could have been on the other end of the thread. Deals with no assignment, or
-- with more than one, are left alone — a wrong lender_id would show one
-- lender's message to another.

update chat_messages m
set lender_id = sole.lender_id
from (
  select a.deal_id, min(a.lender_id::text)::uuid as lender_id
  from lender_deal_assignments a
  where a.deleted_at is null
    and a.lender_id is not null
  group by a.deal_id
  having count(distinct a.lender_id) = 1
) sole
where m.lender_id is null
  and m.deal_id = sole.deal_id;
