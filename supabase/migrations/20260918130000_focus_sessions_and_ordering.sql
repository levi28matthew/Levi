-- ===========================================================================
-- Focus sessions + persistent mission ordering
--
-- Two things the daily loop was missing:
--
--  1. The engine could record what was *finished*, but not where the time
--     actually went. A focus session measures one block of attention with the
--     server's own clock: the client starts it, the database timestamps it,
--     and the database decides the duration. It deliberately awards **no XP**:
--     time spent is not evidence of an outcome, and a reward for elapsed
--     minutes would be the easiest thing in the system to farm. (A future
--     reward rule would need its own migration and its own assertions.)
--
--  2. `daily_missions.position` already existed and was already honoured by
--     every query, but nothing let the user set it: the order was whatever
--     priority noise `create_mission()` produced. `reorder_missions()` makes
--     the order explicit and the column is taken away from clients so an
--     arbitrary number can never be written straight into it.
--
-- Additive and non-destructive: no existing row is rewritten, no awarded XP is
-- touched, and no table or column is dropped.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. focus_sessions
-- ---------------------------------------------------------------------------
create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Optional link to the mission being pushed forward. If the mission is
  -- deleted the session survives with its intention text intact.
  mission_id uuid references public.daily_missions(id) on delete set null,
  -- A session has to be *about* something. "Being busy" is not a record.
  intent text not null check (char_length(trim(intent)) between 1 and 200),
  note text check (note is null or char_length(note) <= 2000),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- 'completed'  — ended by the user, the time counts.
  -- 'discarded'  — the session was left running (interrupted); the row is kept
  --                for honesty but its time is never banked.
  ended_reason text check (ended_reason is null or ended_reason in ('completed', 'discarded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An ended session must say how it ended; an open one must say nothing. The
  -- duration can only ever be a real interval of this clock's time.
  constraint focus_sessions_end_check check (
    (ended_at is null and ended_reason is null)
    or (ended_at is not null and ended_reason is not null and ended_at >= started_at)
  )
);

-- At most one running session per user, enforced by the database itself rather
-- than by application logic: two tabs, two devices or two races cannot both be
-- "focusing" at the same time.
create unique index if not exists focus_sessions_one_open_idx
  on public.focus_sessions(user_id) where ended_at is null;

create index if not exists focus_sessions_user_started_idx
  on public.focus_sessions(user_id, started_at desc);

drop trigger if exists focus_sessions_set_updated_at on public.focus_sessions;
create trigger focus_sessions_set_updated_at before update on public.focus_sessions
  for each row execute procedure public.set_updated_at();

-- A session can only point at one of the caller's own missions. The RPC checks
-- this too; the trigger means no future write path can forget to.
create or replace function public.assert_focus_mission_owned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.mission_id is not null and not exists (
    select 1 from public.daily_missions where id = new.mission_id and user_id = new.user_id
  ) then
    raise exception 'A focus session can only be linked to one of your own missions';
  end if;
  return new;
end;
$$;
revoke all on function public.assert_focus_mission_owned() from public, anon, authenticated;

drop trigger if exists focus_sessions_verify_mission on public.focus_sessions;
create trigger focus_sessions_verify_mission
  before insert or update of mission_id, user_id on public.focus_sessions
  for each row execute procedure public.assert_focus_mission_owned();

alter table public.focus_sessions enable row level security;

drop policy if exists "focus sessions select own" on public.focus_sessions;
create policy "focus sessions select own" on public.focus_sessions
  for select to authenticated using ((select auth.uid()) = user_id);

-- Read-only for clients: there is deliberately no insert/update/delete policy,
-- so a session can only be started or ended through the RPCs below.
grant select on public.focus_sessions to authenticated;
revoke insert, update, delete on public.focus_sessions from anon, authenticated;
revoke references, trigger, truncate on public.focus_sessions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. focus_session_log — one row per session, dated in the caller's own zone
-- ---------------------------------------------------------------------------
create or replace view public.focus_session_log with (security_invoker = true) as
select
  s.id,
  s.user_id,
  s.mission_id,
  s.intent,
  s.note,
  s.started_at,
  s.ended_at,
  s.ended_reason,
  -- The local day the session started on: the day it is reviewed under, even
  -- when it ran past midnight.
  (s.started_at at time zone p.time_zone)::date as started_on,
  -- Elapsed time from the two server timestamps. An open session reports how
  -- long it has been running *so far*; nothing is banked until it is ended.
  greatest(0, floor(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at))))::bigint as elapsed_seconds,
  -- Only a session the user actually ended counts towards focused time.
  (s.ended_reason = 'completed') as counted
from public.focus_sessions s
join public.profiles p on p.id = s.user_id;

grant select on public.focus_session_log to authenticated;
revoke insert, update, delete on public.focus_session_log from anon, authenticated;
revoke references, trigger, truncate on public.focus_session_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. focus_summary(date, time_zone) — the day's focus, computed by the database
--
--    Session counting rules, asserted in the test suite:
--      * a session belongs to the local day it *started* on;
--      * focused_seconds counts ended sessions marked 'completed' only — a
--        discarded session contributes zero, and an open one contributes
--        nothing until it is ended;
--      * a day with no sessions is a summary of zeros, never an error.
--    As with day_summary(), an unrecognised time zone is an error: a typo must
--    not silently report the wrong day.
-- ---------------------------------------------------------------------------
create or replace function public.focus_summary(p_date date, p_time_zone text)
returns table (
  sessions_total integer,
  sessions_completed integer,
  sessions_discarded integer,
  sessions_open integer,
  focused_seconds bigint
)
language plpgsql stable set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
begin
  if p_date is null then
    raise exception 'A focus summary needs a calendar date';
  end if;

  if p_time_zone is null or not exists (select 1 from pg_timezone_names z where z.name = p_time_zone) then
    raise exception '"%" is not a recognized IANA time zone', coalesce(p_time_zone, 'null');
  end if;

  -- No session: no rows to summarise.
  if v_user_id is null then
    return;
  end if;

  return query
  select
    count(*)::integer,
    count(*) filter (where s.ended_reason = 'completed')::integer,
    count(*) filter (where s.ended_reason = 'discarded')::integer,
    count(*) filter (where s.ended_at is null)::integer,
    coalesce(
      sum(greatest(0, floor(extract(epoch from (s.ended_at - s.started_at)))))
        filter (where s.ended_reason = 'completed'),
      0
    )::bigint
  from public.focus_sessions s
  where s.user_id = v_user_id
    and (s.started_at at time zone p_time_zone)::date = p_date;
end;
$$;
revoke all on function public.focus_summary(date, text) from public, anon;
grant execute on function public.focus_summary(date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The only two write paths for a session
-- ---------------------------------------------------------------------------
create or replace function public.start_focus_session(p_intent text, p_mission_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_intent text := trim(coalesce(p_intent, ''));
  v_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;
  if char_length(v_intent) < 1 then raise exception 'A focus session needs an intent'; end if;
  if char_length(v_intent) > 200 then raise exception 'A focus intent must be 200 characters or fewer'; end if;

  if p_mission_id is not null and not exists (
    select 1 from public.daily_missions where id = p_mission_id and user_id = v_user_id
  ) then
    raise exception 'Mission not found';
  end if;

  -- Checked here for a clear message; the partial unique index is the real guard.
  if exists (select 1 from public.focus_sessions where user_id = v_user_id and ended_at is null) then
    raise exception 'A focus session is already running — end or discard it before starting another';
  end if;

  begin
    insert into public.focus_sessions (user_id, mission_id, intent)
    values (v_user_id, p_mission_id, v_intent)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'A focus session is already running — end or discard it before starting another';
  end;

  return v_id;
end;
$$;
revoke all on function public.start_focus_session(text, uuid) from public, anon;
grant execute on function public.start_focus_session(text, uuid) to authenticated;

create or replace function public.end_focus_session(p_session_id uuid, p_discard boolean default false)
returns table (session_id uuid, elapsed_seconds integer, already_ended boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.focus_sessions%rowtype;
  v_seconds integer;
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;
  if p_session_id is null then raise exception 'A focus session needs an id'; end if;

  select * into v_session from public.focus_sessions
  where id = p_session_id and user_id = v_user_id
  for update;
  if not found then raise exception 'Focus session not found'; end if;

  if v_session.ended_at is not null then
    -- Ending twice (double submit, second tab, reload) is not an error and must
    -- not rewrite history: report the stored truth and change nothing.
    return query
      select v_session.id,
             greatest(0, floor(extract(epoch from (v_session.ended_at - v_session.started_at))))::integer,
             true;
    return;
  end if;

  v_seconds := greatest(0, floor(extract(epoch from (now() - v_session.started_at)))::integer);

  update public.focus_sessions
    set ended_at = now(),
        ended_reason = case when p_discard then 'discarded' else 'completed' end
  where id = v_session.id;

  return query select v_session.id, v_seconds, false;
end;
$$;
revoke all on function public.end_focus_session(uuid, boolean) from public, anon;
grant execute on function public.end_focus_session(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. reorder_missions(date, ids) — the day's plan, in the user's own order
--
--    The contract is deliberately strict so there is no ambiguity to guess at:
--    the array must be *every* mission of that local day, exactly once, all of
--    them the caller's. The stored positions become 0..n-1 in the given order.
--    This is what makes duplicate positions impossible to introduce.
-- ---------------------------------------------------------------------------
create or replace function public.reorder_missions(p_mission_date date, p_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
  v_owned integer;
  v_total integer;
  v_updated integer;
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;
  if p_mission_date is null then raise exception 'A mission order needs a calendar date'; end if;

  v_count := coalesce(array_length(p_ids, 1), 0);
  if v_count = 0 then
    raise exception 'A mission order needs at least one mission';
  end if;

  if exists (select 1 from unnest(p_ids) as id where id is null) then
    raise exception 'A mission order cannot contain an empty entry';
  end if;
  if (select count(distinct id) from unnest(p_ids) as id) <> v_count then
    raise exception 'A mission order cannot list the same mission twice';
  end if;

  select count(*) into v_owned
  from public.daily_missions m
  where m.user_id = v_user_id and m.mission_date = p_mission_date and m.id = any(p_ids);
  if v_owned <> v_count then
    raise exception 'An order may only contain your own missions for that day';
  end if;

  -- The list must be complete: a partial order could not be applied without
  -- inventing positions for the missions that were left out.
  select count(*) into v_total
  from public.daily_missions m
  where m.user_id = v_user_id and m.mission_date = p_mission_date;
  if v_total <> v_count then
    raise exception 'The new order must list every mission planned for that day';
  end if;

  update public.daily_missions m
    set position = (ord.idx - 1)::integer
  from unnest(p_ids) with ordinality as ord(id, idx)
  where m.id = ord.id and m.user_id = v_user_id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;
revoke all on function public.reorder_missions(date, uuid[]) from public, anon;
grant execute on function public.reorder_missions(date, uuid[]) to authenticated;

-- `position` is now owned by reorder_missions(), exactly like `status` is owned
-- by set_mission_status(). Without this, a crafted client request could write an
-- arbitrary or duplicated position and the strict contract above would be a
-- suggestion rather than a rule.
revoke update (position) on public.daily_missions from authenticated;
