-- ===========================================================================
-- Historical day review + honest habit backfill
--
-- Two gaps this closes:
--
--  1. There was no way to ask "what actually happened on <date>". The Command
--     Center could only describe *now*. `day_summary` answers the historical
--     question in one place, in the database, using the same local-calendar
--     rules as the rest of the engine (never the server's UTC date).
--
--  2. `log_habit` accepted any date, including future ones. A future log is
--     not evidence of work done, so it could farm XP that had not been earned.
--     Backfill (past days) is still allowed — its log belongs to that day, while
--     its XP is recorded on the day the log is written — and the future is now
--     rejected.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Habit logging: reject a missing or future calendar date
--
--    Everything else about the RPC is unchanged: one row per habit per local
--    day, and the XP follows the row state (award -> adjust -> restore).
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
  v_zone text;
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;

  if p_log_date is null then
    raise exception 'A habit log needs a calendar date';
  end if;

  -- "Today" is the caller's local date. An unknown or stale stored zone falls
  -- back to UTC rather than breaking logging entirely.
  select case
           when exists (select 1 from pg_timezone_names z where z.name = p.time_zone) then p.time_zone
           else 'UTC'
         end
    into v_zone
  from public.profiles p where p.id = v_user_id;
  if v_zone is null then v_zone := 'UTC'; end if;

  if p_log_date > (now() at time zone v_zone)::date then
    raise exception 'A habit cannot be logged for a future calendar date';
  end if;

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
-- 2. day_summary(date, time_zone) — everything that happened on one local day
--
--    One row per call. Every figure is a count of stored rows for the caller:
--      * missions_*        daily_missions with that mission_date
--      * habits_expected   habits that existed and were scheduled that day
--                          (reconstructed from created_at/archived_at)
--      * habits_logged     habit_logs marked completed for that calendar day
--      * xp_awarded/adjusted/net
--                          the append-only ledger, bucketed by the *local*
--                          date of `awarded_at` — the day the entry was
--                          written. Backfilled work therefore shows its log on
--                          the past day and its XP on the day it was recorded.
--                          History is never retroactively rewritten.
--      * achievements_unlocked  player_achievements unlocked that local day
--
--    A day with no records is a real answer (zeros), never an error.
--    An unrecognised time zone is an error, so a typo cannot silently report
--    the wrong day.
-- ---------------------------------------------------------------------------
create or replace function public.day_summary(p_date date, p_time_zone text)
returns table (
  missions_total integer,
  missions_completed integer,
  missions_skipped integer,
  missions_blocked integer,
  missions_open integer,
  habits_expected integer,
  habits_logged integer,
  xp_awarded bigint,
  xp_adjusted bigint,
  xp_net bigint,
  achievements_unlocked integer
)
language plpgsql stable set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
begin
  if p_date is null then
    raise exception 'A day summary needs a calendar date';
  end if;

  if p_time_zone is null or not exists (select 1 from pg_timezone_names z where z.name = p_time_zone) then
    raise exception '"%" is not a recognized IANA time zone', coalesce(p_time_zone, 'null');
  end if;

  -- No session: no rows to summarise.
  if v_user_id is null then
    return;
  end if;

  return query
  with missions as (
    select
      count(*)::integer as total,
      count(*) filter (where m.status = 'completed')::integer as completed,
      count(*) filter (where m.status = 'skipped')::integer as skipped,
      count(*) filter (where m.status = 'blocked')::integer as blocked,
      count(*) filter (where m.status in ('planned', 'active'))::integer as open
    from public.daily_missions m
    where m.user_id = v_user_id
      and m.mission_date = p_date
  ), expected as (
    select count(*)::integer as total
    from public.habits h
    where h.user_id = v_user_id
      and (h.created_at at time zone p_time_zone)::date <= p_date
      and (h.archived_at is null or (h.archived_at at time zone p_time_zone)::date > p_date)
      and (h.schedule_weekdays is null
           or extract(isodow from p_date)::smallint = any(h.schedule_weekdays))
  ), logged as (
    select count(*)::integer as total
    from public.habit_logs l
    join public.habits h on h.id = l.habit_id
    where h.user_id = v_user_id
      and l.log_date = p_date
      and l.completed
  ), xp as (
    select
      coalesce(sum(x.amount) filter (where x.amount > 0), 0)::bigint as awarded,
      coalesce(sum(x.amount) filter (where x.amount < 0), 0)::bigint as adjusted,
      coalesce(sum(x.amount), 0)::bigint as net
    from public.xp_ledger x
    where x.user_id = v_user_id
      and (x.awarded_at at time zone p_time_zone)::date = p_date
  ), unlocked as (
    select count(*)::integer as total
    from public.player_achievements pa
    where pa.user_id = v_user_id
      and (pa.unlocked_at at time zone p_time_zone)::date = p_date
  )
  select m.total, m.completed, m.skipped, m.blocked, m.open,
         e.total, l.total,
         x.awarded, x.adjusted, x.net,
         u.total
  from missions m, expected e, logged l, xp x, unlocked u;
end;
$$;
revoke all on function public.day_summary(date, text) from public, anon;
grant execute on function public.day_summary(date, text) to authenticated;
