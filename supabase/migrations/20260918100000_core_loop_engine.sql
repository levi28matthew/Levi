-- ===========================================================================
-- LEVI OS — Core loop engine (daily missions, habits, canonical player stats)
--
-- Additive and non-destructive:
--   * no existing row is deleted or rewritten;
--   * no awarded XP row is modified;
--   * the only column change to an existing table is the nullable
--     `xp_ledger.reversal_of` added for auditable corrections.
--
-- Two deliberate relaxations of the original ledger rules make *corrections*
-- possible without ever making double-awards possible:
--   1. `amount` may now be negative (an adjustment entry), never zero.
--   2. an adjustment must reference the award it corrects (`reversal_of`) and a
--      trigger keeps `original.amount + sum(adjustments)` inside {0, original.amount}.
--      So XP can be removed and restored, but can never be counted twice.
-- Award rows keep the original `unique (user_id, source, source_id)` guarantee,
-- which is what makes every award idempotent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Canonical level formula — must stay identical to src/lib/progression.ts
--    xp_for_level(L) = 250 * (L - 1) * L / 2
-- ---------------------------------------------------------------------------
create or replace function public.xp_for_level(p_level integer)
returns bigint language sql immutable as $$
  select (250::bigint * (greatest(coalesce(p_level, 1), 1) - 1) * greatest(coalesce(p_level, 1), 1)) / 2;
$$;

create or replace function public.level_for_xp(p_total_xp bigint)
returns integer language sql immutable as $$
  with target as (select greatest(coalesce(p_total_xp, 0), 0)::bigint as xp),
  candidate as (
    select greatest(1, floor((1 + sqrt(1 + (8.0 * xp / 250))) / 2)::integer) as level, xp from target
  )
  select case
    when public.xp_for_level(level + 1) <= xp then level + 1
    when public.xp_for_level(level) > xp then greatest(1, level - 1)
    else level
  end
  from candidate;
$$;

revoke all on function public.xp_for_level(integer) from public, anon;
revoke all on function public.level_for_xp(bigint) from public, anon;
grant execute on function public.xp_for_level(integer) to authenticated;
grant execute on function public.level_for_xp(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Auditable XP adjustments (append-only, balanced, traceable)
-- ---------------------------------------------------------------------------
alter table public.xp_ledger
  add column if not exists reversal_of uuid references public.xp_ledger(id) on delete restrict;

alter table public.xp_ledger drop constraint if exists xp_ledger_amount_check;
alter table public.xp_ledger
  add constraint xp_ledger_amount_check check (amount <> 0 and abs(amount) <= 10000);

create or replace function public.validate_xp_adjustment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_original public.xp_ledger%rowtype;
  v_adjustments bigint;
  v_balance bigint;
begin
  if new.reversal_of is null then
    return new;
  end if;

  select * into v_original from public.xp_ledger where id = new.reversal_of;
  if not found then raise exception 'Cannot adjust an XP entry that does not exist'; end if;
  if v_original.reversal_of is not null then
    raise exception 'An adjustment cannot itself be adjusted';
  end if;

  -- Ownership and provenance are taken from the original entry, never from the caller.
  -- `source` is inherited so per-module reporting stays correct, but `source_id` is
  -- deliberately NOT copied: the award keeps the unique key (user_id, source, source_id)
  -- and an adjustment is a distinct row with its own id plus a `reversal_of` link.
  new.user_id := v_original.user_id;
  new.source := v_original.source;
  new.source_id := gen_random_uuid();
  new.note := coalesce(new.note, 'Adjustment of entry ' || v_original.id::text);

  select coalesce(sum(amount), 0) into v_adjustments
  from public.xp_ledger where reversal_of = v_original.id;

  v_balance := v_original.amount + v_adjustments + new.amount;
  if v_balance <> 0 and v_balance <> v_original.amount then
    raise exception
      'Adjustment would leave XP out of balance (award %, current balance %, proposed %)',
      v_original.amount, v_original.amount + v_adjustments, v_balance;
  end if;

  return new;
end;
$$;
revoke all on function public.validate_xp_adjustment() from public, anon, authenticated;

drop trigger if exists xp_ledger_validate_adjustment on public.xp_ledger;
create trigger xp_ledger_validate_adjustment
  before insert on public.xp_ledger
  for each row execute procedure public.validate_xp_adjustment();

-- NOTE: the award rows themselves must bypass the ledger's unique key collision
-- handling, so the original unique constraint is kept and adjustments are only
-- allowed to point at award rows (reversal_of is null on awards).

-- ---------------------------------------------------------------------------
-- 2b. User time zone — every "today" in LEVI OS is a local calendar date
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists time_zone text not null default 'UTC'
  check (char_length(time_zone) between 1 and 64);

create or replace function public.set_time_zone(p_time_zone text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_resolved text := trim(coalesce(p_time_zone, ''));
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;
  -- Validated against the database's own tz database, so a typo cannot silently
  -- shift every habit day and mission to the wrong date.
  if not exists (select 1 from pg_timezone_names where name = v_resolved) then
    raise exception '"%" is not a recognized IANA time zone', v_resolved;
  end if;
  update public.profiles set time_zone = v_resolved where id = v_user_id;
  return v_resolved;
end;
$$;
revoke all on function public.set_time_zone(text) from public, anon;
grant execute on function public.set_time_zone(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Daily missions
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.mission_status as enum ('planned', 'active', 'completed', 'skipped', 'blocked');
exception when duplicate_object then null; end $$;

create table if not exists public.daily_missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- The *local* calendar date the user planned this mission for. The client supplies it
  -- so a mission never lands on the wrong day because the server runs in UTC.
  mission_date date not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  notes text check (notes is null or char_length(notes) <= 4000),
  priority text not null default 'normal' check (priority in ('urgent', 'high', 'normal', 'low')),
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes between 1 and 1440),
  success_criteria text check (success_criteria is null or char_length(trim(success_criteria)) between 1 and 500),
  quest_id uuid references public.quests(id) on delete set null,
  status public.mission_status not null default 'planned',
  position integer not null default 0 check (position >= 0),
  completed_at timestamptz,
  outcome text check (outcome is null or char_length(trim(outcome)) between 1 and 2000),
  -- Completed work must have a timestamp; work that was skipped or blocked must say why.
  constraint daily_missions_state_check check (
    (status = 'completed' and completed_at is not null)
    or (status in ('skipped', 'blocked') and outcome is not null and char_length(trim(outcome)) > 0)
    or (status in ('planned', 'active') and completed_at is null)
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists daily_missions_user_date_idx on public.daily_missions(user_id, mission_date desc);
create index if not exists daily_missions_quest_idx on public.daily_missions(quest_id);

drop trigger if exists daily_missions_set_updated_at on public.daily_missions;
create trigger daily_missions_set_updated_at before update on public.daily_missions
  for each row execute procedure public.set_updated_at();

-- Files 1–2 kept the "state follows real records" rule; missions extend it:
-- a mission may only point at a quest the caller owns.
create or replace function public.assert_mission_quest_owned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.quest_id is not null and not exists (
    select 1 from public.quests where id = new.quest_id and user_id = new.user_id
  ) then
    raise exception 'A mission can only be linked to one of your own quests';
  end if;
  return new;
end;
$$;
revoke all on function public.assert_mission_quest_owned() from public, anon, authenticated;

drop trigger if exists daily_missions_verify_quest on public.daily_missions;
create trigger daily_missions_verify_quest
  before insert or update of quest_id, user_id on public.daily_missions
  for each row execute procedure public.assert_mission_quest_owned();

-- ---------------------------------------------------------------------------
-- 4. Habits and habit logs
-- ---------------------------------------------------------------------------
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  category text check (category is null or char_length(trim(category)) between 1 and 60),
  -- NULL / all seven = every day. Otherwise the ISO weekdays (1 = Mon … 7 = Sun) it is expected.
  schedule_weekdays smallint[],
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint habits_schedule_check check (
    schedule_weekdays is null
    or (
      coalesce(array_length(schedule_weekdays, 1), 0) between 1 and 7
      and schedule_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
    )
  )
);
create index if not exists habits_user_idx on public.habits(user_id) where archived_at is null;

drop trigger if exists habits_set_updated_at on public.habits;
create trigger habits_set_updated_at before update on public.habits
  for each row execute procedure public.set_updated_at();

create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  log_date date not null,
  completed boolean not null default true,
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (habit_id, log_date)
);
create index if not exists habit_logs_date_idx on public.habit_logs(habit_id, log_date desc);

drop trigger if exists habit_logs_set_updated_at on public.habit_logs;
create trigger habit_logs_set_updated_at before update on public.habit_logs
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Achievements (rules live here; the TS catalogue is display metadata only)
-- ---------------------------------------------------------------------------
create table if not exists public.achievements (
  id text primary key check (id ~ '^[a-z0-9_]{3,60}$'),
  title text not null,
  description text not null,
  xp integer not null check (xp > 0 and xp <= 10000),
  sort_order integer not null default 0
);

create table if not exists public.player_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references public.achievements(id) on delete restrict,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

insert into public.achievements (id, title, description, xp, sort_order) values
  ('first_blood',       'First Blood',        'Complete your first daily mission.',                          25,  10),
  ('provable_progress', 'Provable Progress',  'Complete a subquest where every step is backed by evidence.',  50,  20),
  ('quest_closer',      'Quest Closer',       'Finish a main quest end to end.',                             150,  30),
  ('streak_7',          'Seven Day Streak',   'Keep a habit alive for seven consecutive days.',              100,  40),
  ('streak_30',         'Thirty Day Streak',  'Keep a habit alive for thirty consecutive days.',            500,  50),
  ('habitual',          'Habitual',           'Log 100 habit completions.',                                 200,  60),
  ('level_5',           'Ascendant',          'Reach level 5.',                                             100,  70),
  ('level_10',          'Unstoppable',        'Reach level 10.',                                            250,  80)
on conflict (id) do update
  set title = excluded.title, description = excluded.description, xp = excluded.xp, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 6. Canonical player statistics
--    Lifetime XP is the sum of the ledger, including adjustments. Level, XP into
--    the level and XP for the next level all derive from that single number.
-- ---------------------------------------------------------------------------
create or replace view public.player_stats with (security_invoker = true) as
with xp as (
  select user_id, coalesce(sum(amount), 0)::bigint as total_xp
  from public.xp_ledger group by user_id
)
select
  u.id as user_id,
  coalesce(xp.total_xp, 0)::bigint as total_xp,
  public.level_for_xp(coalesce(xp.total_xp, 0)) as level,
  public.xp_for_level(public.level_for_xp(coalesce(xp.total_xp, 0))) as current_level_floor_xp,
  (coalesce(xp.total_xp, 0) - public.xp_for_level(public.level_for_xp(coalesce(xp.total_xp, 0))))::bigint as xp_into_level,
  (public.xp_for_level(public.level_for_xp(coalesce(xp.total_xp, 0)) + 1)
    - public.xp_for_level(public.level_for_xp(coalesce(xp.total_xp, 0))))::bigint as xp_for_next_level,
  (public.xp_for_level(public.level_for_xp(coalesce(xp.total_xp, 0)) + 1) - coalesce(xp.total_xp, 0))::bigint as xp_to_next_level,
  c.quests_completed, c.subquests_completed, c.missions_completed,
  c.missions_skipped, c.missions_blocked, c.habits_logged, c.steps_completed
from public.profiles u
left join xp on xp.user_id = u.id
-- Correlated to `u.id` (not auth.uid()) so the same view is correct for a caller
-- under RLS and for a trusted server-side function that bypasses RLS.
cross join lateral (
  select
    (select count(*) from public.quests q where q.kind = 'main' and q.user_id = u.id
      and exists (select 1 from public.xp_ledger x where x.source = 'quest_completion' and x.source_id = q.id)) as quests_completed,
    (select count(*) from public.quests q where q.kind = 'subquest' and q.user_id = u.id
      and exists (select 1 from public.xp_ledger x where x.source = 'quest_completion' and x.source_id = q.id)) as subquests_completed,
    (select count(*) from public.daily_missions m where m.user_id = u.id and m.status = 'completed') as missions_completed,
    (select count(*) from public.daily_missions m where m.user_id = u.id and m.status = 'skipped') as missions_skipped,
    (select count(*) from public.daily_missions m where m.user_id = u.id and m.status = 'blocked') as missions_blocked,
    (select count(*) from public.habit_logs l join public.habits h on h.id = l.habit_id
      where h.user_id = u.id and l.completed) as habits_logged,
    (select count(*) from public.quest_steps s join public.quests q on q.id = s.quest_id
      where q.user_id = u.id and s.completed_at is not null) as steps_completed
) c;
grant select on public.player_stats to authenticated;

-- Level history: the level each XP event moved the player to. Derived, never stored.
create or replace view public.level_history with (security_invoker = true) as
select
  x.id as event_id,
  x.user_id,
  x.source,
  x.source_id,
  x.amount,
  x.awarded_at,
  sum(x.amount) over (partition by x.user_id order by x.awarded_at, x.id)::bigint as lifetime_xp_after,
  public.level_for_xp(sum(x.amount) over (partition by x.user_id order by x.awarded_at, x.id)) as level_after
from public.xp_ledger x;
grant select on public.level_history to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Idempotent award + adjust helpers (server-side only)
-- ---------------------------------------------------------------------------
create or replace function public.award_xp(
  p_user_id uuid, p_source public.xp_source, p_source_id uuid, p_amount integer, p_note text
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_inserted integer;
begin
  if p_amount <= 0 then raise exception 'Awards must be positive; use adjust_xp to remove XP'; end if;
  insert into public.xp_ledger (user_id, source, source_id, amount, note)
  values (p_user_id, p_source, p_source_id, p_amount, p_note)
  on conflict (user_id, source, source_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;
revoke all on function public.award_xp(uuid, public.xp_source, uuid, integer, text) from public, anon, authenticated;

create or replace function public.adjust_xp(
  p_original_id uuid, p_amount integer, p_note text
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_original public.xp_ledger%rowtype;
  v_balance bigint;
begin
  select * into v_original from public.xp_ledger where id = p_original_id;
  if not found then raise exception 'XP entry not found'; end if;
  if p_amount = 0 then raise exception 'An adjustment must change the balance'; end if;

  select coalesce(sum(amount), 0) into v_balance from public.xp_ledger where reversal_of = p_original_id;
  v_balance := v_original.amount + v_balance;

  if p_amount > 0 and v_balance <> 0 then
    raise exception 'Nothing to restore for this XP entry';
  end if;
  if p_amount < 0 and v_balance <> v_original.amount then
    raise exception 'This XP entry has already been adjusted';
  end if;

  insert into public.xp_ledger (user_id, source, source_id, amount, note, reversal_of)
  values (v_original.user_id, v_original.source, gen_random_uuid(), p_amount, p_note, p_original_id);
  return true;
end;
$$;
revoke all on function public.adjust_xp(uuid, integer, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Mission lifecycle RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_mission(
  p_mission_date date, p_title text, p_priority text default 'normal',
  p_estimate_minutes integer default null, p_success_criteria text default null,
  p_quest_id uuid default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
  v_position integer;
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;
  if char_length(trim(coalesce(p_title, ''))) < 1 then raise exception 'A mission needs a title'; end if;
  if p_priority not in ('urgent', 'high', 'normal', 'low') then raise exception 'Invalid mission priority'; end if;

  select coalesce(max(position), -1) + 1 into v_position
  from public.daily_missions where user_id = v_user_id and mission_date = p_mission_date;

  insert into public.daily_missions (user_id, mission_date, title, priority, estimate_minutes, success_criteria, quest_id, notes, position)
  values (v_user_id, p_mission_date, trim(p_title), p_priority, p_estimate_minutes,
          nullif(trim(coalesce(p_success_criteria, '')), ''), p_quest_id, nullif(trim(coalesce(p_notes, '')), ''), v_position)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.set_mission_status(
  p_mission_id uuid, p_status public.mission_status, p_outcome text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_mission public.daily_missions%rowtype;
  v_award public.xp_ledger%rowtype;
  v_reversed integer;
  v_has_award boolean;
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;

  select * into v_mission from public.daily_missions
  where id = p_mission_id and user_id = v_user_id for update;
  if not found then raise exception 'Mission not found'; end if;

  update public.daily_missions set
    status = p_status,
    completed_at = case when p_status = 'completed' then coalesce(v_mission.completed_at, now()) else null end,
    -- A skipped or blocked mission must carry its own reason; an old reason is never
    -- inherited, so the constraint cannot be satisfied by stale text.
    outcome = case when p_status in ('skipped', 'blocked', 'completed')
                   then nullif(trim(coalesce(p_outcome, '')), '')
                   else null end
  where id = p_mission_id;

  -- XP follows the mission's real state: exactly one award while completed, removed
  -- (never duplicated) when the mission is reopened, and restored if it is completed again.
  select * into v_award from public.xp_ledger
  where user_id = v_user_id and source = 'daily_mission' and source_id = p_mission_id;
  v_has_award := found;

  if p_status = 'completed' then
    if not v_has_award then
      perform public.award_xp(v_user_id, 'daily_mission', p_mission_id, 50, 'Daily mission completed');
    else
      select coalesce(sum(amount), 0) into v_reversed
      from public.xp_ledger where reversal_of = v_award.id;
      if v_reversed < 0 then
        perform public.adjust_xp(v_award.id, -v_reversed, 'Mission completed again');
      end if;
    end if;
  elsif v_has_award then
    select coalesce(sum(amount), 0) into v_reversed
    from public.xp_ledger where reversal_of = v_award.id;
    if v_reversed = 0 then
      perform public.adjust_xp(v_award.id, -v_award.amount, 'Mission reopened or changed');
    end if;
  end if;

  return true;
end;
$$;

create or replace function public.reopen_mission(p_mission_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  return public.set_mission_status(p_mission_id, 'active', null);
end;
$$;

revoke all on function public.create_mission(date, text, text, integer, text, uuid, text) from public, anon;
revoke all on function public.set_mission_status(uuid, public.mission_status, text) from public, anon;
revoke all on function public.reopen_mission(uuid) from public, anon;
grant execute on function public.create_mission(date, text, text, integer, text, uuid, text) to authenticated;
grant execute on function public.set_mission_status(uuid, public.mission_status, text) to authenticated;
grant execute on function public.reopen_mission(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Habit logging RPC — one row per habit per local day, XP tracks the row state
-- ---------------------------------------------------------------------------
create or replace function public.log_habit(
  p_habit_id uuid, p_log_date date, p_completed boolean, p_note text default null
) returns table (log_id uuid, completed boolean, xp_delta integer)
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_habit public.habits%rowtype;
  v_log public.habit_logs%rowtype;
  v_award public.xp_ledger%rowtype;
  v_reversed integer;
  v_delta integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;

  select * into v_habit from public.habits where id = p_habit_id and user_id = v_user_id;
  if not found then raise exception 'Habit not found'; end if;

  select * into v_log from public.habit_logs where habit_id = p_habit_id and log_date = p_log_date for update;

  if found then
    update public.habit_logs
      set completed = p_completed, note = nullif(trim(coalesce(p_note, v_log.note, '')), '')
      where id = v_log.id returning * into v_log;
  else
    insert into public.habit_logs (habit_id, log_date, completed, note)
    values (p_habit_id, p_log_date, p_completed, nullif(trim(coalesce(p_note, '')), ''))
    returning * into v_log;
  end if;

  select * into v_award from public.xp_ledger
  where user_id = v_user_id and source = 'habit' and source_id = v_log.id;

  if p_completed then
    if not found then
      perform public.award_xp(v_user_id, 'habit', v_log.id, 20, 'Habit logged for ' || p_log_date::text);
      v_delta := 20;
    else
      -- An award exists: restore its XP if a previous un-check removed it.
      select coalesce(sum(amount), 0) into v_reversed from public.xp_ledger where reversal_of = v_award.id;
      if v_reversed < 0 then
        perform public.adjust_xp(v_award.id, -v_reversed, 'Habit completion restored');
        v_delta := -v_reversed;
      end if;
    end if;
  elsif found then
    select coalesce(sum(amount), 0) into v_reversed from public.xp_ledger where reversal_of = v_award.id;
    if v_reversed = 0 then
      perform public.adjust_xp(v_award.id, -v_award.amount, 'Habit day unchecked');
      v_delta := -v_award.amount;
    end if;
  end if;

  return query select v_log.id, v_log.completed, v_delta;
end;
$$;
revoke all on function public.log_habit(uuid, date, boolean, text) from public, anon;
grant execute on function public.log_habit(uuid, date, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Habit summaries computed in the database (streaks never drift from the logs)
-- ---------------------------------------------------------------------------
create or replace function public.habit_summary(p_today date)
returns table (
  habit_id uuid, name text, category text, schedule_weekdays smallint[],
  total_completed bigint, current_streak integer, longest_streak integer
)
language sql stable as $$
with scheduled as (
  -- One row per habit per *scheduled* day. `idx` numbers the scheduled occurrences so
  -- gaps-and-islands works for weekday-only schedules too (Mon/Wed/Fri are consecutive
  -- *occurrences* even though they are not consecutive calendar days).
  select h.id as habit_id, h.user_id, h.name, h.category, h.schedule_weekdays,
         d::date as day,
         row_number() over (partition by h.id order by d) as idx
  from public.habits h
  cross join lateral generate_series(p_today - interval '400 days', p_today, interval '1 day') as d
  where h.archived_at is null
    and (h.schedule_weekdays is null or extract(isodow from d)::smallint = any(h.schedule_weekdays))
), marks as (
  -- `log_state` is NULL when the day was never logged, which is *not* the same as a miss.
  select s.*, l.completed as log_state
  from scheduled s
  left join public.habit_logs l on l.habit_id = s.habit_id and l.log_date = s.day
), runs as (
  select m.*, (m.idx - row_number() over (partition by m.habit_id order by m.day)) as run_key
  from marks m where m.log_state is true
), run_lengths as (
  select habit_id, run_key, count(*)::integer as length, max(day) as last_day
  from runs group by habit_id, run_key
), today_missed as (
  select distinct habit_id from marks where day = p_today and log_state is false
), anchor as (
  -- The occurrence the current streak must end on. Mirrors currentStreak() in
  -- src/lib/habits.ts: an explicitly missed today kills the streak, otherwise the
  -- streak ends at today (if done) or at the most recent scheduled day before today.
  select m.habit_id, case when m.day = p_today then m.idx - 1 else m.idx end as anchor_idx
  from marks m
  where not exists (select 1 from today_missed tm where tm.habit_id = m.habit_id)
    and (
      m.day = p_today
      or (m.day < p_today and not exists (
        select 1 from marks m2
        where m2.habit_id = m.habit_id and m2.day > m.day and m2.day <= p_today))
    )
), current_run as (
  -- Joining `runs` at the anchor occurrence only matches when that day was done.
  select a.habit_id, rl.length
  from anchor a
  join runs r on r.habit_id = a.habit_id and r.idx = a.anchor_idx
  join run_lengths rl on rl.habit_id = r.habit_id and rl.run_key = r.run_key
), totals as (
  select habit_id, count(*)::bigint as total_completed from runs group by habit_id
)
select h.id, h.name, h.category, h.schedule_weekdays,
  coalesce(t.total_completed, 0),
  coalesce((select cr.length from current_run cr where cr.habit_id = h.id limit 1), 0),
  coalesce((select max(rl.length) from run_lengths rl where rl.habit_id = h.id), 0)
from public.habits h
left join totals t on t.habit_id = h.id;
$$;
revoke all on function public.habit_summary(date) from public, anon;
grant execute on function public.habit_summary(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Achievement synchronisation — one idempotent, re-runnable automation step
-- ---------------------------------------------------------------------------
create or replace function public.deterministic_uuid(p_text text)
returns uuid language sql immutable as $$ select md5(p_text)::uuid; $$;
revoke all on function public.deterministic_uuid(text) from public, anon, authenticated;

-- Returns the achievements unlocked by this call. The OUT parameters are deliberately
-- NOT named `achievement_id`/`xp`, because those would shadow the table columns used
-- inside the query and make `on conflict (user_id, achievement_id)` ambiguous.
create or replace function public.sync_achievements()
returns table (unlocked_achievement_id text, xp_awarded integer)
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_stats public.player_stats%rowtype;
  v_today date := (now() at time zone 'UTC')::date;
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;

  select * into v_stats from public.player_stats where user_id = v_user_id;
  if not found then return; end if;
  return query
  with earned as (
    select a.id, a.xp from public.achievements a
    where
      (a.id = 'first_blood'       and v_stats.missions_completed >= 1)
      or (a.id = 'provable_progress' and v_stats.subquests_completed >= 1)
      or (a.id = 'quest_closer'      and v_stats.quests_completed >= 1)
      or (a.id = 'streak_7'  and exists (
            select 1 from public.habit_summary(v_today) hs
            where hs.habit_id in (select id from public.habits where user_id = v_user_id)
              and hs.longest_streak >= 7))
      or (a.id = 'streak_30' and exists (
            select 1 from public.habit_summary(v_today) hs
            where hs.habit_id in (select id from public.habits where user_id = v_user_id)
              and hs.longest_streak >= 30))
      or (a.id = 'habitual'  and v_stats.habits_logged >= 100)
      or (a.id = 'level_5'   and v_stats.level >= 5)
      or (a.id = 'level_10'  and v_stats.level >= 10)
  ), inserted as (
    insert into public.player_achievements (user_id, achievement_id)
    select v_user_id, e.id from earned e
    on conflict (user_id, achievement_id) do nothing
    returning achievement_id
  ), awarded as (
    select i.achievement_id, a.xp
    from inserted i
    join public.achievements a on a.id = i.achievement_id
    where public.award_xp(
      v_user_id, 'achievement',
      public.deterministic_uuid(v_user_id::text || ':' || i.achievement_id),
      a.xp, 'Achievement unlocked: ' || i.achievement_id)
  )
  select a.achievement_id, a.xp from awarded a;
end;
$$;
revoke all on function public.sync_achievements() from public, anon;
grant execute on function public.sync_achievements() to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Row level security and privileges for every new object
-- ---------------------------------------------------------------------------
alter table public.daily_missions enable row level security;
alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;
alter table public.achievements enable row level security;
alter table public.player_achievements enable row level security;

drop policy if exists "missions are private" on public.daily_missions;
drop policy if exists "missions select own" on public.daily_missions;
drop policy if exists "missions insert planned own" on public.daily_missions;
drop policy if exists "missions delete own" on public.daily_missions;

create policy "missions select own" on public.daily_missions
  for select to authenticated using ((select auth.uid()) = user_id);
-- A mission can be created, but its *state* can only change through
-- set_mission_status(), so nobody can mark work complete without the XP event.
create policy "missions insert planned own" on public.daily_missions
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and status in ('planned', 'active')
    and completed_at is null
    and outcome is null
  );
create policy "missions delete own" on public.daily_missions
  for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.assert_records_with_xp_not_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'daily_missions' then
    if exists (select 1 from public.xp_ledger where source = 'daily_mission' and source_id = old.id) then
      raise exception 'Cannot delete a mission that awarded XP — reopen or skip it instead';
    end if;
  elsif tg_table_name = 'habits' then
    if exists (
      select 1 from public.xp_ledger x
      join public.habit_logs l on l.id = x.source_id
      where x.source = 'habit' and l.habit_id = old.id
    ) then
      raise exception 'Cannot delete a habit that awarded XP — archive it instead';
    end if;
  end if;
  return old;
end;
$$;
revoke all on function public.assert_records_with_xp_not_deleted() from public, anon, authenticated;

drop trigger if exists daily_missions_block_awarded_delete on public.daily_missions;
create trigger daily_missions_block_awarded_delete
  before delete on public.daily_missions
  for each row execute procedure public.assert_records_with_xp_not_deleted();

drop trigger if exists habits_block_awarded_delete on public.habits;
create trigger habits_block_awarded_delete
  before delete on public.habits
  for each row execute procedure public.assert_records_with_xp_not_deleted();

drop policy if exists "habits are private" on public.habits;
drop policy if exists "habits select own" on public.habits;
drop policy if exists "habits insert own" on public.habits;
drop policy if exists "habits update own" on public.habits;
drop policy if exists "habits delete own" on public.habits;

create policy "habits select own" on public.habits
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "habits insert own" on public.habits
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "habits update own" on public.habits
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "habits delete own" on public.habits
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Habit logs are written only by log_habit() (like quest steps): a client cannot
-- create a completion row that bypasses the XP ledger.
drop policy if exists "habit logs follow owned habits" on public.habit_logs;
create policy "habit logs follow owned habits" on public.habit_logs
  for select to authenticated
  using (exists (select 1 from public.habits h where h.id = habit_id and h.user_id = (select auth.uid())));

drop policy if exists "achievements are public reference data" on public.achievements;
create policy "achievements are public reference data" on public.achievements
  for select to authenticated using (true);

drop policy if exists "player achievements are private" on public.player_achievements;
create policy "player achievements are private" on public.player_achievements
  for select to authenticated using ((select auth.uid()) = user_id);

grant select, insert, delete on public.daily_missions to authenticated;
grant select, insert, update, delete on public.habits to authenticated;
grant select on public.habit_logs to authenticated;
grant select on public.achievements to authenticated;
grant select on public.player_achievements to authenticated;
revoke update on public.daily_missions from authenticated;
revoke insert, update, delete on public.habit_logs from authenticated;

revoke references, trigger, truncate on public.daily_missions, public.habits, public.habit_logs,
  public.achievements, public.player_achievements, public.player_stats, public.level_history
  from anon, authenticated;
