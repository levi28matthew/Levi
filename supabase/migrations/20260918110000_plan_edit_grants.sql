-- ===========================================================================
-- Plan edits vs. state changes — enforced by column privileges, not just policies
--
-- A mission's *state* is owned by set_mission_status(); its *plan* is the user's to
-- edit. Postgres is made to enforce the difference with column-level privileges: the
-- client holds UPDATE only on the plan columns, so a direct `status = 'completed'`
-- write is rejected with `permission denied for column status` before any trigger or
-- policy is even consulted.
--
-- Without this, "Save plan" could not work at all (no UPDATE grant existed on
-- daily_missions), and every mission would have to be re-created to fix a typo.
--
-- The same reasoning tightens `profiles`: a client may set its display name, but the
-- time zone can only move through set_time_zone(), which validates the zone against
-- pg_timezone_names. A plain table update must not be able to bypass that validation.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. daily_missions: plan columns are editable, state columns are not
-- ---------------------------------------------------------------------------
drop policy if exists "missions update own plan" on public.daily_missions;
create policy "missions update own plan" on public.daily_missions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant update (title, priority, estimate_minutes, success_criteria, notes, mission_date, position)
  on public.daily_missions to authenticated;

-- The table-wide UPDATE privilege stays revoked: only the columns above are writable,
-- so `status`, `completed_at`, `outcome`, `user_id`, `id` and `created_at` remain
-- owned by set_mission_status() / reopen_mission().
revoke update on public.daily_missions from anon, public;

-- ---------------------------------------------------------------------------
-- 2. profiles: display_name is editable, time_zone is not
-- ---------------------------------------------------------------------------
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;
