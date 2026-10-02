-- ACP Deal OS: WBS Scoring Engine and Deal Intelligence Page
-- (Optimisation Brief v1.1, section 7). All changes are additive; nothing
-- existing is renamed, and Lane 1 rows and runs are untouched.
--
--  * deals gain a lane (Lane 1 CFS by default) and a WBS sub-sector; every
--    post-call run inherits the deal's lane and keeps its own lane stamp.
--  * playbook_config is stored per lane and signed. An unsigned WBS config
--    scores nothing: every gate and dimension is UNSCORED and no verdict can
--    be KILL. The proposed WBS v2 values are seeded UNSIGNED for Dami.
--  * post-call runs record lane, run type, dimensions, total and confidence.
--  * intelligence_runs hold the 19-section Deal Intelligence tab per run.
--  * negotiation_exchanges mirror the Notion Negotiation Log (no live figures).
--  * negotiation_techniques is the P-089 technique registry, T01 to T20.

-- ─── Enums (section 7) ─────────────────────────────────────────────────────
do $$ begin
  create type evidence_tag as enum ('FILED', 'MGMT', 'VERIFIED', 'VENDOR', 'ESTIMATED', 'ASSUMPTION', 'UNKNOWN');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cash_model as enum ('point_of_sale', 'direct_debit_membership', 'prepaid_plan', 'insurer_billed',
    'corporate_invoice', 'service_invoice', 'applications_for_payment', 'project_staged');
exception when duplicate_object then null; end $$;

-- ─── deals ─────────────────────────────────────────────────────────────────
-- deals.lane already exists (0024: smallint 1 | 2, read by the partner
-- views). It is the same lane, so the scorer reads and writes it as
-- 1 = Lane 1 CFS, 2 = Lane 2 WBS, null = Lane 1. No second column.
alter table deals add column if not exists wbs_subsector text
  check (wbs_subsector in ('physio_msk_chiro', 'diagnostics_longevity', 'medical_aesthetics', 'occupational_health',
                           'corporate_wellbeing', 'recovery_performance', 'other'));
alter table deals add column if not exists asking_ev_gbp       numeric;
alter table deals add column if not exists distance_rm11_miles numeric check (distance_rm11_miles >= 0);

comment on column deals.lane                is 'Lane: 1 = statutory compliance (Lane 1 CFS), 2 = regulated clinical / wellbeing (Lane 2 WBS). Null scores as Lane 1. Read by the partner views (0024) and the post-call scorer (0025); every post-call run keeps its own lane stamp.';
comment on column deals.wbs_subsector       is 'Lane 2 only: applies the sub-sector weight shift to the WBS dimensions.';
comment on column deals.asking_ev_gbp       is 'Asking enterprise value (GBP), when the broker states one.';
comment on column deals.distance_rm11_miles is 'Miles from RM11 (D7 growth and platform fit).';

-- ─── playbook_config: per lane, signed ─────────────────────────────────────
alter table playbook_config add column if not exists lane       text not null default 'lane_1_cfs'
  check (lane in ('lane_1_cfs', 'lane_2_wbs'));
alter table playbook_config add column if not exists thresholds jsonb;
alter table playbook_config add column if not exists weights    jsonb;
alter table playbook_config add column if not exists signed_by  text;
alter table playbook_config add column if not exists signed_at  timestamptz;

comment on column playbook_config.lane       is 'Which lane this config version scores.';
comment on column playbook_config.thresholds is 'Lane 2: WBS metric end-points, H7 bands and H3 conditions (lib/postcall/wbs.ts).';
comment on column playbook_config.weights    is 'Lane 2: D1-D7 weights, summing to 100 before the sub-sector shift.';
comment on column playbook_config.signed_at  is 'When the config was signed. Null = UNSCORED: no gate or dimension scores, and no verdict can be KILL.';

-- Proposed WBS v2 values, seeded unsigned. Signing inserts a new, signed
-- version (the table stays insert-only).
insert into playbook_config (lane, thresholds, weights, notes, created_by)
select 'lane_2_wbs', '{"metrics":{"recurring_pct":{"full":60,"zero":45},"member_churn_monthly":{"full":2,"zero":3.5},"min_term_months":{"full":6,"zero":0},"maintainable_base_gbp":{"full":250000,"zero":150000},"addback_haircut_pct":{"full":15,"zero":35},"fcf_conversion_pct":{"full":75,"zero":40},"top_practitioner_rev_pct":{"full":15,"zero":25},"subcontracted_practitioner_pct":{"full":20,"zero":40},"non_solicit_coverage_pct":{"full":80,"zero":40},"owner_clinical_caseload_pct":{"full":0,"zero":40},"dscr":{"full":2.5,"zero":1},"lease_years_remaining":{"full":5,"zero":0},"collateral":{"full":100000,"zero":0},"capacity_utilisation":{"full":70,"zero":95},"cac_ltv":{"full":5,"zero":1},"distance_rm11_miles":{"full":50,"zero":100}},"h7_practitioner_max_pct":25,"h7_payer_max_pct":40,"h3_conditions":[]}'::jsonb, '{"D1":20,"D2":20,"D3":15,"D4":15,"D5":15,"D6":5,"D7":10}'::jsonb,
       'WBS v2 proposed values (Optimisation Brief v1.1 section 3). Unsigned: awaiting Dami.', 'migration 0025'
where not exists (select 1 from playbook_config where lane = 'lane_2_wbs');

-- ─── post-call runs ────────────────────────────────────────────────────────
alter table postcall_briefs add column if not exists lane           text check (lane in ('lane_1_cfs', 'lane_2_wbs'));
alter table postcall_briefs add column if not exists run_type       text check (run_type in ('pre_call', 'post_call', 'post_document'));
alter table postcall_briefs add column if not exists dimensions     jsonb;
alter table postcall_briefs add column if not exists total_score    numeric;
alter table postcall_briefs add column if not exists confidence_pct numeric;
alter table postcall_briefs add column if not exists verdict        text check (verdict in (
  'Kill', 'Price', 'Condition', 'Proceed to info request',
  'KILL', 'PROVISIONAL', 'ADVANCE', 'PRICE_CONDITION', 'HOLD', 'DECLINE', 'UNSCORED'));

comment on column postcall_briefs.lane     is 'Lane stamp: the deal''s lane when the run was scored. Old runs keep theirs when the deal changes lane.';
comment on column postcall_briefs.run_type is 'Pre-call, post-call or post-document: decides which evidence may fail a gate.';

-- ─── Deal Intelligence tab ─────────────────────────────────────────────────
create table if not exists intelligence_runs (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid not null references deals(id) on delete cascade,
  run_id           uuid not null references postcall_briefs(id) on delete cascade,
  sections         jsonb not null default '{}'::jsonb,
  locked_sections  text[] not null default '{}',
  stale_sections   text[] not null default '{}',
  comments         jsonb not null default '[]'::jsonb,
  prompt_versions  jsonb not null default '{}'::jsonb,
  status           text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  error            text,
  generated_at     timestamptz,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists intelligence_runs_deal_run on intelligence_runs (deal_id, run_id, created_at desc);
alter table intelligence_runs enable row level security;

comment on table intelligence_runs is 'Deal Intelligence tab: 19 section cards per post-call run (keys "1".."19"). Locked sections survive regeneration.';

-- ─── Negotiation Log mirror ────────────────────────────────────────────────
create table if not exists negotiation_exchanges (
  id                  uuid primary key default gen_random_uuid(),
  deal_id             uuid not null references deals(id) on delete cascade,
  intelligence_run_id uuid references intelligence_runs(id) on delete set null,
  exchange_no         integer not null,
  direction           text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  deal_ref            text,
  counterparty        text,
  counterparty_role   text check (counterparty_role in ('broker', 'seller', 'lender', 'adviser')),
  move_type           text,
  techniques          text[] not null default '{}',
  moved               text not null default 'pending' check (moved in ('pending', 'moved', 'partial', 'hardened', 'silence')),
  next_move           text,
  lesson              text,
  notion_page_id      text,
  notion_synced_at    timestamptz,
  created_by          text,
  created_at          timestamptz not null default now()
);
create index if not exists negotiation_exchanges_deal on negotiation_exchanges (deal_id, exchange_no);
alter table negotiation_exchanges enable row level security;

comment on table negotiation_exchanges is 'Mirror of the Notion Negotiation Log. Never holds live figures (H-08): rows are stripped before insert and sync.';

-- ─── P-089 technique registry ──────────────────────────────────────────────
create table if not exists negotiation_techniques (
  code              text primary key check (code ~ '^T[0-9]{2}$'),
  name              text not null,
  source            text not null,
  principle         text not null,
  triggers          text[] not null default '{}',
  blocks            int[] not null default '{}',
  channels          text[] not null default '{}',
  render_rule       text not null,
  example           text not null default '',
  anti_patterns     text[] not null default '{}',
  lint              jsonb not null default '{}'::jsonb,
  requires_sanction boolean not null default false,
  learning_score    integer not null default 0 check (learning_score between -3 and 3),
  updated_at        timestamptz not null default now()
);
alter table negotiation_techniques enable row level security;

comment on table negotiation_techniques is 'P-089 technique registry (T01-T20). The engine selects only from these rows; learning_score is written by the quarterly learning loop.';

insert into negotiation_techniques (code, name, source, principle, triggers, blocks, channels, render_rule, example, anti_patterns, lint, requires_sanction, learning_score) values
  ('T01', 'Separate people from problem', 'Fisher, Ury, Getting to Yes', 'Treat the relationship and the issue as separate; be soft on people, firm on substance', array['warm_relationship', 'friction']::text[], array[1, 9]::int[], array['email', 'call']::text[], 'Credit the person, keep the issue impersonal.', 'Thank you for arranging Friday''s call.', array['blame', 'you failed to']::text[], '{"check":"No second-person blame verbs (failed, refused, ignored)"}'::jsonb, false, 0),
  ('T02', 'Accusation audit', 'Voss, Never Split the Difference', 'Name their likely negative reading of you before they do; it defuses it', array['request_may_read_as_stall', 'price_anchor_dispute', 'anger']::text[], array[2]::int[], array['email', 'call']::text[], 'You may be reading X as Y. It is neither.', 'You may be reading a long information request as a buyer slowing things down.', array['defensive over-explaining']::text[], '{"check":"Block 2 contains \"may be reading\", \"might think\" or \"may feel\" + a negative"}'::jsonb, false, 0),
  ('T03', 'Labelling', 'Voss, Never Split the Difference', 'State the emotion or position you observe; it shows you heard them', array['emotion', 'contradiction']::text[], array[3, 4]::int[], array['email', 'call']::text[], 'It sounds like… / It seems… / It looks like…', 'It sounds like YE25 was a strong year and YE26 a rebuilding one.', array['I understand how you feel', 'I hear you']::text[], '{"check":"Sentence starts with It sounds / seems / looks like"}'::jsonb, false, 0),
  ('T04', 'Mirroring', 'Voss, Never Split the Difference', 'Repeat their last 1 to 3 words as a question to draw them out', array['calls_only']::text[], array[]::int[], array['call']::text[], '…had offers?', '…had offers?', array['any use in written email']::text[], '{"check":"Blocked when channel = email"}'::jsonb, false, 0),
  ('T05', 'Reciprocity', 'Cialdini, Influence', 'People return a concession they receive; acknowledging theirs creates the debt', array['concession_made', 'disclosure']::text[], array[1]::int[], array['email', 'call']::text[], 'Name the specific concession.', 'Open about this year''s numbers and the licence.', array['generic thanks']::text[], '{"check":"References a concession listed in diagnosis"}'::jsonb, false, 0),
  ('T06', 'Interests not positions', 'Fisher, Ury, Getting to Yes', 'Work on why they want something, not what they demand', array['position_differs_from_interest']::text[], array[3]::int[], array['email', 'call']::text[], 'List 2 to 3 shared interests.', 'We share three things…', array['arguing their number']::text[], '{"check":"2 to 3 interests, each in diagnosis interests map"}'::jsonb, false, 0),
  ('T07', 'Objective criteria', 'Fisher, Ury, Getting to Yes', 'Anchor on independent standards both sides accept', array['figure_in_play', 'valuation_in_play']::text[], array[4]::int[], array['email', 'call']::text[], 'Figures in a table, each with source.', '| Adjusted EBITDA YE25 c.£265k | IM p.15 |', array['unsourced claims', 'market rate is']::text[], '{"check":"Every figure has a source; table present"}'::jsonb, false, 0),
  ('T08', 'Golden bridge', 'Ury, Getting Past No', 'Give them a face-saving path to agree', array['anchored_high', 'must_climb_down']::text[], array[9]::int[], array['email', 'call']::text[], 'Frame the next step as their win.', 'So we can move quickly for them.', array['you were wrong']::text[], '{"check":"Close names a benefit to them"}'::jsonb, false, 0),
  ('T09', 'Bounded options', 'Fisher, Ury; Voss', 'Offer two choices, both acceptable to ACP; choice reduces resistance', array['decision_needed']::text[], array[6]::int[], array['email', 'call']::text[], 'Exactly two numbered options.', 'Two ways forward, both work for us: (1) … (2) …', array['three plus options', 'an option ACP cannot accept']::text[], '{"check":"Exactly 2 options; both inside ACP limits"}'::jsonb, false, 0),
  ('T10', 'Calibrated questions', 'Voss, Never Split the Difference', 'Open How / What questions make them solve your problem', array['information_needed', 'commitment_needed']::text[], array[8]::int[], array['email', 'call']::text[], 'Max two questions, starting How or What, to the decision unit.', 'How are you planning the timetable once YE26 is final?', array['why questions', 'yes/no questions']::text[], '{"check":"≤ 2 questions; each starts How/What; none starts Why"}'::jsonb, false, 0),
  ('T11', 'Low-friction next step', 'Cialdini, Influence (commitment)', 'Small, easy commitments lead to bigger ones', array['every_message']::text[], array[9]::int[], array['email', 'call']::text[], 'One concrete, cheap action with a link or date.', 'We would welcome a second call: [ACP calendar link]', array['vague let us know']::text[], '{"check":"Close holds one action + link or date"}'::jsonb, false, 0),
  ('T12', 'Re-anchor to evidence', 'Kahneman; Malhotra', 'Replace their anchor with documented figures; anchoring bias fades against evidence', array['anchored_on_peak', 'unverified_figure']::text[], array[4]::int[], array['email', 'call']::text[], 'Place their own three figures side by side.', 'Three-figure source table', array['counter-anchoring with ACP''s own number pre-sanction']::text[], '{"check":"Uses counterparty figures; zero ACP figures pre-sanction"}'::jsonb, false, 0),
  ('T13', 'Contingent agreement', 'Malhotra, Negotiating the Impossible', 'Bridge disagreement with value paid when a verifiable milestone occurs', array['uncertainty_they_believe_you_doubt']::text[], array[7]::int[], array['email', 'call']::text[], 'Milestone only (licence signed, lease granted). Mechanics verbal.', 'Reflect its long-term continuity in how we structure the proposal.', array['performance or revenue targets (earn-out)']::text[], '{"check":"Bans: earn-out, target, performance, EBITDA hit"}'::jsonb, false, 0),
  ('T14', 'Silent BATNA', 'Fisher, Ury, Getting to Yes', 'Your best alternative gives power only when unspoken', array['always_internal']::text[], array[]::int[], array[]::text[], 'Never written. Shapes tone and walk-away.', '', array['stating alternatives or other deals']::text[], '{"check":"No mention of other targets or deals"}'::jsonb, false, 0),
  ('T15', '"That''s right" summary', 'Voss, Never Split the Difference', 'Summarise their view so well they say "that''s right"', array['conditional_acceptance', 'long_exchange']::text[], array[3]::int[], array['email', 'call']::text[], 'Two-sentence summary of their position.', '', array['you''re right (concession)']::text[], '{"check":"Summary matches diagnosis stated position"}'::jsonb, false, 0),
  ('T16', 'No-oriented question', 'Voss, Never Split the Difference', 'People feel safer saying no; a "no" answer moves things', array['silence', 'stall']::text[], array[8]::int[], array['email', 'call']::text[], '"Is it a bad time to…?" "Would it be unreasonable to…?"', 'Is it a bad time to pick this up?', array['pushy yes-questions']::text[], '{"check":"Question answerable by \"no\" to proceed"}'::jsonb, false, 0),
  ('T17', 'Loss framing', 'Kahneman, Thinking, Fast and Slow', 'Losses weigh about twice gains; show what they lose', array['explaining_a_limit', 'risk']::text[], array[5]::int[], array['email', 'call']::text[], 'One sentence: the cost to them of the alternative.', 'That risk falls on the sellers as much as on us.', array['threats']::text[], '{"check":"One sentence; mentions their cost; stated once"}'::jsonb, false, 0),
  ('T18', 'Go to the balcony', 'Ury, Getting Past No', 'Step back and name a tactic calmly instead of reacting', array['ultimatum', 'deadline', 'pressure']::text[], array[2, 4]::int[], array['email', 'call']::text[], '"We note the timetable. Our process is the same either way."', 'We note the timetable. Our process is the same either way.', array['matching their pressure']::text[], '{"check":"Neutral verbs; no counter-deadline"}'::jsonb, false, 0),
  ('T19', 'Conditional concession', 'Malhotra, Negotiating the Impossible', 'Never give; trade. Every give is tied to a get', array['acp_concession']::text[], array[6, 7]::int[], array['email', 'call']::text[], '"If you…, then we…"', 'If you share the licence and membership data, then we can be specific on price within X days.', array['unconditional gives']::text[], '{"check":"Every concession sentence contains If + then"}'::jsonb, false, 0),
  ('T20', 'Ackerman increments', 'Voss, Never Split the Difference', 'Price moves 65/85/95/100% in shrinking steps', array['live_price_haggling']::text[], array[]::int[], array['call']::text[], 'Never written.', '', array['any written use']::text[], '{"check":"Blocked in email"}'::jsonb, true, 0)
on conflict (code) do nothing;
