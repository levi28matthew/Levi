-- ===========================================================================
-- Integration assertions for the LEVI OS database engine.
-- Requires: 00_bootstrap.sql, every migration applied in filename order.
-- Runs as the postgres role and switches into `authenticated` to exercise RLS.
-- ===========================================================================
\set ON_ERROR_STOP on

create or replace function public.test_assert(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'ASSERTION FAILED: %', p_label;
  end if;
  raise notice 'ok - %', p_label;
end;
$$;
-- Functions in schema public are revoked from clients by the hardening migrations,
-- so the test helper must be granted explicitly before switching role.
grant execute on function public.test_assert(boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures: two users. The auth trigger must create their profiles.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.test')
on conflict (id) do nothing;

select public.test_assert(
  (select count(*) from public.profiles) = 2,
  'auth trigger created a profile for each user'
);

-- ---------------------------------------------------------------------------
-- Level formula parity with src/lib/progression.ts
-- ---------------------------------------------------------------------------select public.test_assert(public.xp_for_level(1) = 0, 'xp_for_level(1) = 0');
select public.test_assert(public.xp_for_level(2) = 250, 'xp_for_level(2) = 250');
select public.test_assert(public.xp_for_level(5) = 2500, 'xp_for_level(5) = 2500');
select public.test_assert(public.level_for_xp(249) = 1, 'level_for_xp(249) = 1');
select public.test_assert(public.level_for_xp(250) = 2, 'level_for_xp(250) = 2');
select public.test_assert(public.level_for_xp(1000) = 3, 'level_for_xp(1000) = 3');
select public.test_assert(public.level_for_xp(1500) = 4, 'level_for_xp(1500) = 4');
select public.test_assert(
  not exists (
    select 1 from generate_series(1, 300) as l
    where public.level_for_xp(public.xp_for_level(l)) <> l
  ),
  'level_for_xp and xp_for_level round-trip exactly for levels 1..300'
);
select public.test_assert(
  not exists (
    select 1 from generate_series(2, 300) as l
    where public.level_for_xp(public.xp_for_level(l) - 1) <> l - 1
  ),
  'one XP below a threshold belongs to the previous level, for levels 2..300'
);

-- ---------------------------------------------------------------------------
-- Time zone: server-validated, and every "today" is a local calendar date
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.test_assert(
  (select time_zone from public.profiles) = 'UTC',
  'a new profile defaults to UTC'
);
select public.test_assert(
  public.set_time_zone('America/Los_Angeles') = 'America/Los_Angeles',
  'a valid IANA time zone is accepted'
);
do $$
begin
  begin
    perform public.set_time_zone('Mars/Olympus_Mons');
    raise exception 'ASSERTION FAILED: an invalid time zone was accepted';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - an unrecognized time zone is rejected';
  end;
end $$;
-- The fixtures below use the database's UTC `current_date` as "today", so the
-- profile is deliberately left on UTC here. The interaction between the stored
-- zone and a *local* today is asserted explicitly in its own section later.
select public.set_time_zone('UTC');
reset role;

-- ---------------------------------------------------------------------------
-- Level formula parity with src/lib/progression.ts
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Quest XP: awarded once, on completion, per quest
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.quests (title, kind) values ('Become Job Ready', 'main') returning id as main_id \gset
insert into public.quests (title, kind, parent_quest_id) values ('Interview prep', 'subquest', :'main_id') returning id as sub_id \gset
insert into public.quest_steps (quest_id, title, position) values (:'sub_id', 'Write CV bullet points', 0) returning id as step1 \gset
insert into public.quest_steps (quest_id, title, position) values (:'sub_id', 'Run a mock interview', 1) returning id as step2 \gset

select public.test_assert(
  (select progress_percent from public.quest_progress where id = :'sub_id') = 0,
  'a subquest with no completed steps is 0%'
);

select public.complete_quest_step(:'step1', 'note', 'Reordered the CV around outcomes');
select public.test_assert(
  (select count(*) from public.xp_ledger where source = 'quest_completion' and source_id = :'sub_id') = 0,
  'half-completed subquest has not been awarded'
);

select public.complete_quest_step(:'step2', 'url', 'https://example.test/mock-interview-notes');

select public.test_assert(
  (select progress_percent from public.quest_progress where id = :'sub_id') = 100,
  'subquest progress is 100% once every step is complete'
);
select public.test_assert(
  (select progress_percent from public.quest_progress where id = :'main_id') = 100,
  'main quest progress follows its completed subquest'
);
select public.test_assert(
  (select count(*) from public.xp_ledger where source = 'quest_completion' and source_id = :'sub_id') = 1,
  'subquest XP awarded exactly once'
);
select public.test_assert(
  (select amount from public.xp_ledger where source = 'quest_completion' and source_id = :'sub_id') = 250,
  'subquest XP is 250'
);
select public.test_assert(
  (select amount from public.xp_ledger where source = 'quest_completion' and source_id = :'main_id') = 1000,
  'main quest XP is 1000'
);

-- Replaying the same completion must not award again.
select public.complete_quest_step(:'step2', 'url', 'https://example.test/mock-interview-notes');
select public.test_assert(
  (select count(*) from public.xp_ledger where source = 'quest_completion' and source_id = :'sub_id') = 1,
  'replaying a completion does not duplicate subquest XP'
);
select public.test_assert(
  (select total_xp from public.player_stats) = 1250,
  'player stats total 1250 XP (250 + 1000)'
);
select public.test_assert((select level from public.player_stats) = 3, 'player stats level is 3 at 1250 XP');

-- Direct ledger writes are impossible for a client.
do $$
begin
  begin
    insert into public.xp_ledger (user_id, source, source_id, amount)
    values ('11111111-1111-1111-1111-111111111111', 'bonus', gen_random_uuid(), 9999);
    raise exception 'ASSERTION FAILED: a client could write to the XP ledger';
  exception when insufficient_privilege then
    raise notice 'ok - clients cannot insert XP ledger rows';
  end;
end $$;

-- Another user cannot complete or even see this step.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.test_assert((select count(*) from public.quests) = 0, 'RLS hides another user''s quests');
select public.test_assert((select count(*) from public.player_stats) = 1, 'RLS shows only my own player stats');
select public.test_assert((select total_xp from public.player_stats) = 0, 'a new user starts at 0 XP');
select public.test_assert((select level from public.player_stats) = 1, 'a new user starts at level 1');
do $$
begin
  begin
    perform public.complete_quest_step(
      (select id from public.quest_steps where title = 'Run a mock interview'),
      'note', 'trying to complete someone else''s work');
    raise exception 'ASSERTION FAILED: cross-user completion was allowed';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - cross-user completion is rejected';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Daily missions: complete, reopen, re-complete — never double-counted
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.create_mission(current_date, 'Ship the LEVI OS audit', 'high', 90, 'docs/PROJECT_AUDIT.md exists') as mission_id \gset

select public.set_mission_status(:'mission_id', 'active', null);
select public.test_assert(
  (select status from public.daily_missions where id = :'mission_id') = 'active',
  'a mission can be moved to active'
);
select public.set_mission_status(:'mission_id', 'completed', 'Audit written and committed');
select public.test_assert(
  (select total_xp from public.player_stats) = 1300,
  'completing a mission awards 50 XP'
);
select public.set_mission_status(:'mission_id', 'active', null);
select public.test_assert(
  (select total_xp from public.player_stats) = 1250,
  'reopening a mission removes its XP'
);
select public.test_assert(
  (select count(*) from public.xp_ledger where source = 'daily_mission') = 2,
  'a reopen appends an auditable adjustment instead of deleting history'
);
select public.test_assert(
  (select count(*) from public.xp_ledger where source = 'daily_mission' and reversal_of is not null) = 1,
  'the adjustment is linked to the award it corrects'
);
select public.set_mission_status(:'mission_id', 'completed', 'Audit written and committed');
select public.test_assert(
  (select total_xp from public.player_stats) = 1300,
  're-completing restores exactly 50 XP'
);
select public.test_assert(
  (select count(*) from public.xp_ledger where source = 'daily_mission') = 3,
  'restoring XP is recorded as a second adjustment, never as a new award'
);
select public.set_mission_status(:'mission_id', 'completed', 'Audit written and committed');
select public.test_assert(
  (select total_xp from public.player_stats) = 1300,
  'completing twice never double-awards'
);

-- A skipped mission records a reason and grants nothing.
select public.create_mission(current_date, 'Attend optional webinar', 'low') as skipped_id \gset
select public.set_mission_status(:'skipped_id', 'skipped', 'Overlapped with a real interview');
select public.test_assert(
  (select status from public.daily_missions where id = :'skipped_id') = 'skipped',
  'a mission can be explicitly skipped with a reason'
);
select public.test_assert(
  (select total_xp from public.player_stats) = 1300,
  'a skipped mission grants no XP'
);
do $$
begin
  begin
    perform public.set_mission_status(
      (select id from public.daily_missions where title = 'Attend optional webinar'), 'blocked', null);
    raise exception 'ASSERTION FAILED: blocked mission without a reason was accepted';
  exception when check_violation then
    raise notice 'ok - blocked missions require a reason';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Habits: streaks, un-check/restore, weekday schedules
-- ---------------------------------------------------------------------------
insert into public.habits (name, category) values ('Train', 'fitness') returning id as habit_id \gset

select public.log_habit(:'habit_id', current_date - 6, true);
select public.log_habit(:'habit_id', current_date - 5, true);
select public.log_habit(:'habit_id', current_date - 4, true);
select public.log_habit(:'habit_id', current_date - 3, true);
select public.log_habit(:'habit_id', current_date - 2, true);
select public.log_habit(:'habit_id', current_date - 1, true);

select public.test_assert(
  (select current_streak from public.habit_summary(current_date) where habit_id = :'habit_id') = 6,
  'a six day streak is reported while today is still open'
);
select public.test_assert(
  (select longest_streak from public.habit_summary(current_date) where habit_id = :'habit_id') = 6,
  'longest streak matches the six logged days'
);
select public.test_assert(
  (select total_xp from public.player_stats) = 1300 + 120,
  'six habit logs award 120 XP'
);

select public.log_habit(:'habit_id', current_date, true);
select public.test_assert(
  (select current_streak from public.habit_summary(current_date) where habit_id = :'habit_id') = 7,
  'logging today extends the streak to seven'
);

-- Un-checking a day removes the XP and breaks the current streak; re-checking restores both.
select public.log_habit(:'habit_id', current_date, false);
select public.test_assert(
  (select current_streak from public.habit_summary(current_date) where habit_id = :'habit_id') = 0,
  'an explicitly missed today breaks the current streak'
);
select public.test_assert(
  (select longest_streak from public.habit_summary(current_date) where habit_id = :'habit_id') = 6,
  'longest streak is recomputed from the corrected log, not from stale state'
);
select public.test_assert(
  (select total_xp from public.player_stats) = 1300 + 120,
  'un-checking a habit day removes that day''s XP'
);
select public.log_habit(:'habit_id', current_date, true);
select public.test_assert(
  (select total_xp from public.player_stats) = 1300 + 140,
  're-checking the same day restores the XP without duplicating it'
);
select public.log_habit(:'habit_id', current_date, true);
select public.test_assert(
  (select total_xp from public.player_stats) = 1300 + 140,
  'logging the same day twice never double-awards'
);
select public.test_assert(
  (select count(*) from public.xp_ledger where source = 'habit' and reversal_of is null) = 7,
  'seven habit days produced exactly seven awards'
);
select public.test_assert(
  (select count(*) from public.xp_ledger where source = 'habit' and reversal_of is not null) = 2,
  'the un-check and re-check are recorded as two balanced adjustments'
);

-- A weekday-only habit counts consecutive scheduled occurrences. Logs can only be
-- written through log_habit(), so the fixture must use the RPC as well.
insert into public.habits (name, schedule_weekdays) values ('Scripture study', array[1, 3, 5]::smallint[]) returning id as weekday_habit \gset
select public.log_habit(:'weekday_habit', d::date, true)
from generate_series(current_date - 14, current_date, interval '1 day') d
where extract(isodow from d) in (1, 3, 5);
select public.test_assert(
  (select current_streak from public.habit_summary(current_date) where habit_id = :'weekday_habit') >= 3,
  'a Mon/Wed/Fri habit keeps a streak across unscheduled days'
);

-- Direct habit-log writes are impossible for a client.
do $$
begin
  begin
    insert into public.habit_logs (habit_id, log_date, completed)
    values ((select id from public.habits where name = 'Train'), current_date + 30, true);
    raise exception 'ASSERTION FAILED: a client could write a habit log directly';
  exception when insufficient_privilege then
    raise notice 'ok - clients cannot write habit logs directly';
  end;
end $$;

-- Completed work cannot be quietly deleted.
do $$
begin
  begin
    delete from public.daily_missions
    where id = (select id from public.daily_missions where title = 'Ship the LEVI OS audit');
    raise exception 'ASSERTION FAILED: a mission that awarded XP was deleted';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - missions that awarded XP cannot be deleted';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Plan edits vs. state changes: enforced by column privileges
-- ---------------------------------------------------------------------------
select public.create_mission(current_date, 'Draft plan', 'normal', 30, 'plan is editable') as plan_id \gset

update public.daily_missions
  set title = 'Draft plan (edited)',
      priority = 'urgent',
      estimate_minutes = 45,
      success_criteria = 'the plan fields are writable',
      notes = 'edited',
      mission_date = current_date + 1
where id = :'plan_id';
select public.test_assert(
  (select title from public.daily_missions where id = :'plan_id') = 'Draft plan (edited)'
    and (select priority from public.daily_missions where id = :'plan_id') = 'urgent'
    and (select estimate_minutes from public.daily_missions where id = :'plan_id') = 45
    and (select mission_date from public.daily_missions where id = :'plan_id') = current_date + 1,
  'a client can edit a planned mission (title, priority, estimate, date)'
);

-- Marking work complete outside the RPC must be impossible, even with a crafted request.
do $$
begin
  begin
    update public.daily_missions set status = 'completed', completed_at = now()
    where id = (select id from public.daily_missions where title = 'Draft plan (edited)');
    raise exception 'ASSERTION FAILED: a client could complete a mission directly';
  exception when insufficient_privilege then
    raise notice 'ok - a mission cannot be completed outside set_mission_status';
  end;
end $$;

do $$
begin
  begin
    update public.daily_missions set status = 'skipped', outcome = 'sneaky'
    where id = (select id from public.daily_missions where title = 'Draft plan (edited)');
    raise exception 'ASSERTION FAILED: a client could skip a mission directly';
  exception when insufficient_privilege then
    raise notice 'ok - a mission cannot be skipped outside set_mission_status';
  end;
end $$;

-- A plan edit is still scoped to the caller's own rows.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update public.daily_missions set title = 'hijacked' where id = :'plan_id';
select public.test_assert(
  (select count(*) from public.daily_missions where title = 'hijacked') = 0,
  'a client cannot edit another user''s mission plan'
);
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- The time zone has exactly one write path, and it validates.
do $$
begin
  begin
    update public.profiles set time_zone = 'Mars/Olympus_Mons';
    raise exception 'ASSERTION FAILED: the time zone could be changed outside set_time_zone';
  exception when insufficient_privilege then
    raise notice 'ok - the time zone can only change through set_time_zone';
  end;
end $$;

update public.profiles set display_name = 'Levi';
select public.test_assert(
  (select display_name from public.profiles) = 'Levi',
  'a client can set its own display name'
);

-- ---------------------------------------------------------------------------
-- Achievements: derived from real records, awarded once
-- ---------------------------------------------------------------------------
select public.test_assert(
  (select count(*) from public.sync_achievements()) = 4,
  'first_blood, provable_progress, quest_closer and streak_7 unlock at once'
);
select public.test_assert(
  (select count(*) from public.sync_achievements()) = 0,
  're-running achievement sync unlocks nothing new'
);
select public.test_assert(
  (select count(*) from public.player_achievements) = 4,
  'exactly four achievements are recorded'
);
select public.test_assert(
  (select count(*) from public.xp_ledger where source = 'achievement') = 4,
  'each achievement awarded XP exactly once'
);
select public.test_assert(
  (select count(*) from public.xp_ledger where source = 'achievement' and reversal_of is null) = 4,
  'achievement awards are recorded as awards, not adjustments'
);
select public.test_assert(
  (select count(*) from public.level_history) = (select count(*) from public.xp_ledger),
  'level history has one row per XP event'
);
select public.test_assert(
  (select level_after from public.level_history order by awarded_at desc, event_id desc limit 1)
    = (select level from public.player_stats),
  'the latest level-history entry agrees with player stats'
);

-- ---------------------------------------------------------------------------
-- Historical day review: one derived summary per local calendar date
-- ---------------------------------------------------------------------------
select public.test_assert(
  (select missions_total from public.day_summary(current_date, 'UTC')) = 2
    and (select missions_completed from public.day_summary(current_date, 'UTC')) = 1
    and (select missions_skipped from public.day_summary(current_date, 'UTC')) = 1
    and (select missions_open from public.day_summary(current_date, 'UTC')) = 0,
  'a day summary counts only the missions planned for that local day'
);
select public.test_assert(
  (select missions_total from public.day_summary(current_date + 1, 'UTC')) = 1
    and (select missions_open from public.day_summary(current_date + 1, 'UTC')) = 1,
  'a mission moved to another day is reported on that day'
);
select public.test_assert(
  (select habits_logged from public.day_summary(current_date, 'UTC')) >= 1
    and (select habits_expected from public.day_summary(current_date, 'UTC')) >= 1,
  'a day summary counts the habit that was logged and the habit that was scheduled'
);
select public.test_assert(
  (select xp_net from public.day_summary(current_date, 'UTC'))
    = (select xp_awarded + xp_adjusted from public.day_summary(current_date, 'UTC')),
  'the XP net of a day always equals its awards plus its adjustments'
);
select public.test_assert(
  (select achievements_unlocked from public.day_summary(current_date, 'UTC')) = 4
    and (select xp_awarded from public.day_summary(current_date, 'UTC')) > 0,
  'a day summary reports the achievements and the XP earned on that day'
);
select public.test_assert(
  (select xp_net from public.day_summary(current_date - 1000, 'UTC')) = 0
    and (select missions_total from public.day_summary(current_date - 1000, 'UTC')) = 0
    and (select habits_logged from public.day_summary(current_date - 1000, 'UTC')) = 0,
  'a day with no records summarises to zeros instead of failing'
);

-- Backfill: a log written today for an earlier day belongs to that earlier day.
-- Its XP, however, is recorded when it is awarded — a past day's review is never
-- rewritten by work recorded later.
select log_id as backfill_log from public.log_habit(
  (select id from public.habits where name = 'Train'), current_date - 20, true) \gset
select id as backfill_award from public.xp_ledger
  where source = 'habit' and source_id = :'backfill_log' \gset

select public.test_assert(
  (select habits_logged from public.day_summary(current_date - 20, 'UTC')) = 1
    and (select habits_expected from public.day_summary(current_date - 20, 'UTC')) = 0,
  'a backfilled day reports the log, while a habit created later is not expected on it'
);
select public.test_assert(
  (select xp_net from public.day_summary(current_date - 20, 'UTC')) = 0
    and (select xp_net from public.day_summary(current_date, 'UTC')) >= 20,
  'backfill records the work on the past day but never rewrites that day''s XP'
);
select public.test_assert(
  (select amount from public.xp_ledger where id = :'backfill_award') = 20
    and (select reversal_of from public.xp_ledger where id = :'backfill_award') is null,
  'a backfilled habit day awards the same 20 XP as any other day'
);

select public.log_habit((select id from public.habits where name = 'Train'), current_date - 20, true);
select public.test_assert(
  (select count(*) from public.xp_ledger where source = 'habit' and source_id = :'backfill_log') = 1,
  'logging the same past day twice still awards XP exactly once'
);

select public.log_habit((select id from public.habits where name = 'Train'), current_date - 20, false);
select public.test_assert(
  (select habits_logged from public.day_summary(current_date - 20, 'UTC')) = 0
    and (select count(*) from public.xp_ledger where reversal_of = :'backfill_award') = 1,
  'un-logging a backfilled day withdraws exactly that XP and keeps the audit trail'
);

-- The future guard is anchored to the caller's local date, not the server's:
-- twelve hours behind UTC, "tomorrow" on the server is never a valid log date.
select public.set_time_zone('Etc/GMT+12');
do $$
begin
  begin
    perform public.log_habit((select id from public.habits where name = 'Train'), current_date + 1, true);
    raise exception 'ASSERTION FAILED: a habit could be logged for the future';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - a future habit day is rejected (%)', sqlerrm;
  end;
end $$;
select public.set_time_zone('UTC');
select public.log_habit((select id from public.habits where name = 'Train'), current_date - 19, true);
select public.test_assert(
  (select habits_logged from public.day_summary(current_date - 19, 'UTC')) = 1,
  'backfilling a past day still works after the future is rejected'
);

-- An unrecognised time zone fails loudly instead of reporting the wrong day.
do $$
begin
  begin
    perform count(*) from public.day_summary(current_date, 'Mars/Olympus_Mons');
    raise exception 'ASSERTION FAILED: an unrecognized time zone was accepted';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - a day summary rejects an unrecognized time zone';
  end;
end $$;

-- A summary is always scoped to the caller: it can never read across accounts.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.test_assert(
  (select missions_total from public.day_summary(current_date, 'UTC')) = 0
    and (select xp_net from public.day_summary(current_date, 'UTC')) = 0
    and (select habits_logged from public.day_summary(current_date, 'UTC')) = 0,
  'another user''s day summary is empty'
);
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- ---------------------------------------------------------------------------
-- Focus sessions: measured time, at most one running session, no XP
-- ---------------------------------------------------------------------------
select total_xp as xp_before_focus from public.player_stats \gset
select count(*) as ledger_before_focus from public.xp_ledger \gset

-- A blank intent is not a session.
do $$
begin
  begin
    perform public.start_focus_session('   ');
    raise exception 'ASSERTION FAILED: a blank focus intent was accepted';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - a focus session needs a real intent (%)', sqlerrm;
  end;
end $$;

-- The first session is linked to a mission the caller owns; the link is stored.
select public.start_focus_session('Finish the audit', :'mission_id') as focus_id \gset
select public.test_assert(
  (select count(*) from public.focus_sessions where ended_at is null) = 1
    and (select mission_id from public.focus_sessions where id = :'focus_id') = :'mission_id',
  'starting a focus session opens exactly one, linked to the chosen mission'
);

-- A second running session is impossible, whichever way it is attempted.
do $$
begin
  begin
    perform public.start_focus_session('Second session while the first runs');
    raise exception 'ASSERTION FAILED: two running focus sessions were accepted';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - a second focus session is rejected while one runs';
  end;
end $$;

select public.end_focus_session(:'focus_id');
select public.test_assert(
  (select ended_reason from public.focus_sessions where id = :'focus_id') = 'completed'
    and (select ended_at from public.focus_sessions where id = :'focus_id') is not null,
  'ending a session records a real end time and a completed reason'
);
select public.test_assert(
  (select already_ended from public.end_focus_session(:'focus_id')) is true,
  'ending an already-ended session is a no-op that reports the truth'
);
select public.test_assert(
  (select count(*) from public.focus_sessions where id = :'focus_id') = 1,
  'a double submit never creates a second session'
);
select public.test_assert(
  (select counted from public.focus_session_log where id = :'focus_id') is true
    and (select started_on from public.focus_session_log where id = :'focus_id') = current_date,
  'the session log dates each session on the local day it started and flags what counts'
);

-- An interrupted session: opened, then never ended properly. The user can
-- discard it instead, which keeps the record but banks none of the time.
select public.start_focus_session('Left running by accident') as discard_id \gset
select public.test_assert(
  (select sessions_open from public.focus_summary(current_date, 'UTC')) = 1,
  'a running session is reported as open, not as focused time'
);
select public.test_assert(
  (select focused_seconds from public.focus_summary(current_date, 'UTC')) =
    (select floor(extract(epoch from (ended_at - started_at)))::bigint
     from public.focus_sessions where id = :'focus_id'),
  'focused time counts only the session that was actually ended'
);
reset role;
do $$
begin
  begin
    insert into public.focus_sessions (user_id, intent)
    values ('11111111-1111-1111-1111-111111111111', 'Bypass attempt');
    raise exception 'ASSERTION FAILED: the one-open-session rule could be bypassed';
  exception when unique_violation then
    raise notice 'ok - the one running session rule is a real unique index, not a check that can be skipped';
  end;
end $$;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select public.end_focus_session(:'discard_id', true);
select public.test_assert(
  (select sessions_completed from public.focus_summary(current_date, 'UTC')) = 1
    and (select sessions_discarded from public.focus_summary(current_date, 'UTC')) = 1
    and (select sessions_open from public.focus_summary(current_date, 'UTC')) = 0,
  'a discarded session is recorded separately from a completed one'
);
select public.test_assert(
  (select focused_seconds from public.focus_summary(current_date, 'UTC')) =
    (select floor(extract(epoch from (ended_at - started_at)))::bigint
     from public.focus_sessions where id = :'focus_id'),
  'a discarded session contributes no focused time'
);
select public.test_assert(
  (select counted from public.focus_session_log where id = :'discard_id') is false,
  'a discarded session is never counted as focused time'
);
select public.test_assert(
  (select sessions_total from public.focus_summary(current_date - 1000, 'UTC')) = 0
    and (select focused_seconds from public.focus_summary(current_date - 1000, 'UTC')) = 0,
  'a day with no focus sessions summarises to zeros'
);

do $$
begin
  begin
    perform count(*) from public.focus_summary(current_date, 'Mars/Olympus_Mons');
    raise exception 'ASSERTION FAILED: a focus summary accepted an unrecognized time zone';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - a focus summary rejects an unrecognized time zone';
  end;
end $$;

-- Another account can neither see, end, nor link to this user's records.
-- (psql does not substitute variables inside dollar-quoted blocks, so the real
-- ids are carried across in session settings rather than faked.)
select set_config('levi.test_session_id', :'focus_id', false);
select set_config('levi.test_mission_id', :'mission_id', false);
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.test_assert(
  (select count(*) from public.focus_sessions) = 0,
  'another user sees no focus sessions'
);
do $$
declare v_session uuid := current_setting('levi.test_session_id')::uuid;
begin
  begin
    -- A real session id, captured above: knowing it does not help.
    perform public.end_focus_session(v_session);
    raise exception 'ASSERTION FAILED: another user ended a focus session';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - a session that is not the caller''s is reported as not found (%)', sqlerrm;
  end;
end $$;
do $$
declare v_mission uuid := current_setting('levi.test_mission_id')::uuid;
begin
  begin
    -- A real mission id, belonging to somebody else: ownership is checked, not guessed.
    perform public.start_focus_session('Steal a mission', v_mission);
    raise exception 'ASSERTION FAILED: a session was linked to a mission that is not the caller''s';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - a focus session cannot be linked to a mission the caller does not own';
  end;
end $$;
select public.test_assert(
  (select count(*) from public.focus_sessions) = 0,
  'a rejected start creates nothing'
);

-- Focus sessions are read-only for clients: every write goes through the RPCs.
do $$
begin
  begin
    insert into public.focus_sessions (user_id, intent)
    values ('22222222-2222-2222-2222-222222222222', 'Direct write');
    raise exception 'ASSERTION FAILED: a client could insert a focus session directly';
  exception when insufficient_privilege then
    raise notice 'ok - clients cannot insert focus sessions directly';
  end;
end $$;
do $$
begin
  begin
    update public.focus_sessions set intent = 'rewritten';
    raise exception 'ASSERTION FAILED: a client could rewrite a focus session';
  exception when insufficient_privilege then
    raise notice 'ok - clients cannot update focus sessions directly';
  end;
end $$;
do $$
begin
  begin
    delete from public.focus_sessions;
    raise exception 'ASSERTION FAILED: a client could delete a focus session';
  exception when insufficient_privilege then
    raise notice 'ok - clients cannot delete focus sessions directly';
  end;
end $$;

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.test_assert(
  (select total_xp from public.player_stats) = :xp_before_focus
    and (select count(*) from public.xp_ledger) = :ledger_before_focus,
  'focus sessions award no XP and write nothing to the ledger'
);

-- ---------------------------------------------------------------------------
-- Persistent mission ordering: one explicit order per day, owner-only
-- ---------------------------------------------------------------------------
select public.create_mission(current_date - 5, 'First in the plan', 'low') as ord_a \gset
select public.create_mission(current_date - 5, 'Second in the plan', 'urgent') as ord_b \gset
select public.create_mission(current_date - 5, 'Third in the plan', 'normal') as ord_c \gset
select public.test_assert(
  (select array_agg(id order by position, created_at) from public.daily_missions where mission_date = current_date - 5)
    = array[:'ord_a'::uuid, :'ord_b'::uuid, :'ord_c'::uuid],
  'a new mission is appended to the end of its day''s order'
);

select public.test_assert(
  public.reorder_missions(current_date - 5, array[:'ord_c'::uuid, :'ord_a'::uuid, :'ord_b'::uuid]) = 3,
  'reordering a day updates every mission of that day'
);
select public.test_assert(
  (select array_agg(id order by position, created_at) from public.daily_missions where mission_date = current_date - 5)
    = array[:'ord_c'::uuid, :'ord_a'::uuid, :'ord_b'::uuid],
  'the stored order is exactly the order that was requested, and survives a re-read'
);
select public.test_assert(
  (select array_agg(position order by position) from public.daily_missions where mission_date = current_date - 5)
    = array[0, 1, 2],
  'positions are renumbered to 0..n-1 with no gaps and no duplicates'
);

-- Reordering a single-mission day is legal and leaves position 0.
select public.create_mission(current_date - 6, 'Only mission of the day', 'normal') as solo_ord \gset
select public.test_assert(
  public.reorder_missions(current_date - 6, array[:'solo_ord'::uuid]) = 1
    and (select position from public.daily_missions where id = :'solo_ord') = 0,
  'a one-mission day can be reordered to itself'
);

do $$
begin
  begin
    perform public.reorder_missions(current_date - 5,
      array[(select id from public.daily_missions where title = 'First in the plan'),
            (select id from public.daily_missions where title = 'First in the plan'),
            (select id from public.daily_missions where title = 'Third in the plan')]);
    raise exception 'ASSERTION FAILED: a duplicate mission in an order was accepted';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - an order cannot list the same mission twice (%)', sqlerrm;
  end;

  begin
    perform public.reorder_missions(current_date - 5,
      array[(select id from public.daily_missions where title = 'First in the plan'),
            (select id from public.daily_missions where title = 'Second in the plan')]);
    raise exception 'ASSERTION FAILED: a partial mission order was accepted';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - a partial order is rejected because it could not place the missions it omits';
  end;

  begin
    perform public.reorder_missions(current_date - 5, array[null::uuid, gen_random_uuid(), gen_random_uuid()]);
    raise exception 'ASSERTION FAILED: an order with an empty entry was accepted';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - an order cannot contain an empty entry';
  end;

  begin
    perform public.reorder_missions(current_date - 5, array[]::uuid[]);
    raise exception 'ASSERTION FAILED: an empty order was accepted';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - an empty order is rejected';
  end;

  begin
    -- Every id here is the caller's own, but one is planned for another day.
    perform public.reorder_missions(current_date - 5,
      array[(select id from public.daily_missions where title = 'First in the plan'),
            (select id from public.daily_missions where title = 'Second in the plan'),
            (select id from public.daily_missions where title = 'Draft plan (edited)')]);
    raise exception 'ASSERTION FAILED: a mission from another day was accepted into the order';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - an order can only contain missions planned for that day';
  end;
end $$;

-- Another account's missions are not even visible, let alone orderable.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.create_mission(current_date - 5, 'Their own mission', 'normal') as b_mission \gset
select set_config('levi.test_ord_a', :'ord_a', false);
select set_config('levi.test_b_mission', :'b_mission', false);
do $$
declare
  v_ids uuid[] := array[
    current_setting('levi.test_b_mission')::uuid,
    current_setting('levi.test_ord_a')::uuid
  ];
begin
  begin
    -- One of the caller's own ids plus a *known* id from another account, i.e. the
    -- exact request a crafted client would send.
    perform public.reorder_missions(current_date - 5, v_ids);
    raise exception 'ASSERTION FAILED: a client reordered another user''s missions';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - another user''s missions cannot be ordered (%)', sqlerrm;
  end;
end $$;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.test_assert(
  (select array_agg(id order by position, created_at) from public.daily_missions where mission_date = current_date - 5)
    = array[:'ord_c'::uuid, :'ord_a'::uuid, :'ord_b'::uuid],
  'a rejected reorder leaves the original order untouched'
);

-- Ordering a day that already contains completed and skipped work changes the
-- order only — never the state machine and never the XP.
select public.reorder_missions(current_date, array[:'skipped_id'::uuid, :'mission_id'::uuid]);
select public.test_assert(
  (select status from public.daily_missions where id = :'mission_id') = 'completed'
    and (select status from public.daily_missions where id = :'skipped_id') = 'skipped'
    and (select completed_at from public.daily_missions where id = :'mission_id') is not null,
  'reordering preserves the state of completed and skipped missions'
);
select public.test_assert(
  (select total_xp from public.player_stats) = :xp_before_focus
    and (select count(*) from public.xp_ledger) = :ledger_before_focus,
  'reordering never awards or removes XP'
);

do $$
begin
  begin
    update public.daily_missions set position = 99 where mission_date = current_date - 5;
    raise exception 'ASSERTION FAILED: a client could write a mission position directly';
  exception when insufficient_privilege then
    raise notice 'ok - positions are only writable through reorder_missions';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Misuse: adjustments cannot unbalance an award
-- ---------------------------------------------------------------------------
reset role;
do $$
declare v_award uuid; v_mission uuid;
begin
  select source_id into v_mission from public.xp_ledger
  where source = 'daily_mission' limit 1;
  select id into v_award from public.xp_ledger
  where source = 'daily_mission' and reversal_of is null limit 1;
  begin
    insert into public.xp_ledger (user_id, source, source_id, amount, note, reversal_of)
    values ('11111111-1111-1111-1111-111111111111', 'daily_mission', v_mission, -100, 'illegal over-adjustment', v_award);
    raise exception 'ASSERTION FAILED: an out-of-balance adjustment was accepted';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - out-of-balance adjustments are rejected (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    update public.xp_ledger set amount = 1;
    raise exception 'ASSERTION FAILED: the XP ledger was mutated';
  exception when others then
    if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
    raise notice 'ok - the XP ledger is append-only';
  end;
end $$;

select public.test_assert(
  (select count(*) from public.quest_progress) = 2,
  'the progress view still exposes both quests'
);

drop function public.test_assert(boolean, text);
\echo '========================================================================='
\echo ' ALL DATABASE TESTS PASSED'
\echo '========================================================================='
