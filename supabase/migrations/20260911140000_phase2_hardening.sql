-- Phase 2 hardening: close step/XP bypasses, serialize awards, and lock validation in Postgres.
-- Existing awarded XP rows are preserved. This migration does not delete ledger history.

-- ---------------------------------------------------------------------------
-- Integrity: titles, evidence length, steps only on subquests
-- ---------------------------------------------------------------------------
alter table public.quest_steps
  drop constraint if exists quest_steps_title_check;
alter table public.quest_steps
  add constraint quest_steps_title_check check (char_length(trim(title)) between 1 and 240);

alter table public.quest_steps
  drop constraint if exists quest_steps_completed_evidence_check;
alter table public.quest_steps
  add constraint quest_steps_completed_evidence_check check (
    (completed_at is null and evidence_type is null and evidence_value is null)
    or (
      completed_at is not null
      and evidence_type is not null
      and char_length(trim(coalesce(evidence_value, ''))) between 1 and 4000
    )
  );

create or replace function public.assert_step_on_subquest()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.quests q
    where q.id = new.quest_id and q.kind = 'subquest'
  ) then
    raise exception 'Steps can only be attached to subquests';
  end if;
  return new;
end;
$$;

drop trigger if exists quest_steps_require_subquest on public.quest_steps;
create trigger quest_steps_require_subquest
  before insert or update of quest_id on public.quest_steps
  for each row execute procedure public.assert_step_on_subquest();

-- Serialize step inserts against the parent quest row and recover position collisions.
create or replace function public.lock_quest_for_step_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.quests where id = new.quest_id for update;
  if exists (
    select 1 from public.quest_steps
    where quest_id = new.quest_id and position = new.position and id is distinct from new.id
  ) then
    new.position := coalesce((select max(position) from public.quest_steps where quest_id = new.quest_id), -1) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists quest_steps_lock_quest on public.quest_steps;
create trigger quest_steps_lock_quest
  before insert on public.quest_steps
  for each row execute procedure public.lock_quest_for_step_write();

-- ---------------------------------------------------------------------------
-- Immutable identity / completed state
-- ---------------------------------------------------------------------------
create or replace function public.assert_quest_identity_immutable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.kind is distinct from old.kind
    or new.parent_quest_id is distinct from old.parent_quest_id then
    raise exception 'Quest ownership and kind cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists quests_identity_immutable on public.quests;
create trigger quests_identity_immutable
  before update on public.quests
  for each row execute procedure public.assert_quest_identity_immutable();

create or replace function public.assert_step_completion_controlled()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.quest_id is distinct from old.quest_id then
      raise exception 'A step cannot move to another quest';
    end if;
    if old.completed_at is not null then
      raise exception 'Completed steps cannot be changed';
    end if;
    if (new.completed_at is not null or new.evidence_type is not null or new.evidence_value is not null)
      and current_setting('levi.allow_step_completion', true) is distinct from 'on' then
      raise exception 'Step completion must go through complete_quest_step';
    end if;
  elsif tg_op = 'DELETE' then
    if old.completed_at is not null then
      raise exception 'Completed steps cannot be deleted';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists quest_steps_completion_controlled on public.quest_steps;
create trigger quest_steps_completion_controlled
  before update or delete on public.quest_steps
  for each row execute procedure public.assert_step_completion_controlled();

-- ---------------------------------------------------------------------------
-- XP farming: block delete/recreate; freeze awarded quest structure
-- ---------------------------------------------------------------------------
create or replace function public.quest_has_completion_xp(p_quest_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.xp_ledger
    where source = 'quest_completion' and source_id = p_quest_id
  ) or exists (
    select 1
    from public.quests child
    join public.xp_ledger x on x.source = 'quest_completion' and x.source_id = child.id
    where child.parent_quest_id = p_quest_id
  );
$$;
revoke all on function public.quest_has_completion_xp(uuid) from public, anon, authenticated;

create or replace function public.assert_awarded_quests_not_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.quest_has_completion_xp(old.id) then
    raise exception 'Cannot delete a quest that has awarded completion XP';
  end if;
  return old;
end;
$$;

drop trigger if exists quests_block_awarded_delete on public.quests;
create trigger quests_block_awarded_delete
  before delete on public.quests
  for each row execute procedure public.assert_awarded_quests_not_deleted();

create or replace function public.assert_awarded_quest_structure_frozen()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'quests' then
    if new.kind = 'subquest' and public.quest_has_completion_xp(new.parent_quest_id) then
      raise exception 'Cannot add a subquest to a quest that has awarded completion XP';
    end if;
  elsif tg_table_name = 'quest_steps' then
    if public.quest_has_completion_xp(new.quest_id) then
      raise exception 'Cannot add a step to a quest that has awarded completion XP';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists quests_freeze_after_award on public.quests;
create trigger quests_freeze_after_award
  before insert on public.quests
  for each row execute procedure public.assert_awarded_quest_structure_frozen();

drop trigger if exists quest_steps_freeze_after_award on public.quest_steps;
create trigger quest_steps_freeze_after_award
  before insert on public.quest_steps
  for each row execute procedure public.assert_awarded_quest_structure_frozen();

create or replace function public.maybe_award_after_incomplete_step_removed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_parent uuid;
begin
  select user_id, parent_quest_id into v_user_id, v_parent
  from public.quests where id = old.quest_id;
  if v_user_id is null then return old; end if;
  perform public.award_completed_quest_xp(old.quest_id, v_user_id);
  if v_parent is not null then
    perform public.award_completed_quest_xp(v_parent, v_user_id);
  end if;
  return old;
end;
$$;

drop trigger if exists quest_steps_award_after_delete on public.quest_steps;
create trigger quest_steps_award_after_delete
  after delete on public.quest_steps
  for each row execute procedure public.maybe_award_after_incomplete_step_removed();

-- Ledger history is append-only for clients and for table owners in this schema.
create or replace function public.assert_xp_ledger_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'XP ledger rows cannot be updated or deleted';
end;
$$;

drop trigger if exists xp_ledger_immutable on public.xp_ledger;
create trigger xp_ledger_immutable
  before update or delete on public.xp_ledger
  for each row execute procedure public.assert_xp_ledger_immutable();

-- ---------------------------------------------------------------------------
-- RLS: clients may mutate incomplete steps only; completion is RPC-only
-- ---------------------------------------------------------------------------
drop policy if exists "quests are private" on public.quests;
drop policy if exists "steps follow owned quests" on public.quest_steps;

create policy "quests select own" on public.quests
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "quests insert own" on public.quests
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "quests update own" on public.quests
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "quests delete own" on public.quests
  for delete to authenticated
  using ((select auth.uid()) = user_id and not public.quest_has_completion_xp(id));

create policy "steps select owned" on public.quest_steps
  for select to authenticated
  using (exists (select 1 from public.quests q where q.id = quest_id and q.user_id = (select auth.uid())));
create policy "steps insert incomplete owned" on public.quest_steps
  for insert to authenticated
  with check (
    completed_at is null and evidence_type is null and evidence_value is null
    and exists (select 1 from public.quests q where q.id = quest_id and q.user_id = (select auth.uid()) and q.kind = 'subquest')
  );
create policy "steps update incomplete owned" on public.quest_steps
  for update to authenticated
  using (
    completed_at is null
    and exists (select 1 from public.quests q where q.id = quest_id and q.user_id = (select auth.uid()))
  )
  with check (
    completed_at is null and evidence_type is null and evidence_value is null
    and exists (select 1 from public.quests q where q.id = quest_id and q.user_id = (select auth.uid()))
  );
create policy "steps delete incomplete owned" on public.quest_steps
  for delete to authenticated
  using (
    completed_at is null
    and exists (select 1 from public.quests q where q.id = quest_id and q.user_id = (select auth.uid()))
  );

revoke insert, update, delete on public.xp_ledger from public, anon, authenticated;
grant select on public.xp_ledger to authenticated;
grant select, insert, update, delete on public.quests, public.quest_steps to authenticated;

-- ---------------------------------------------------------------------------
-- Canonical progress view (unchanged rounding rules; restated as the only engine)
-- Subquest: round(completed/total * 100). Main: round(avg of unrounded child ratios).
-- Status: 0 => not_started, 100 => done, else in_progress.
-- ---------------------------------------------------------------------------
create or replace view public.quest_progress with (security_invoker = true) as
with step_counts as (
  select q.id as quest_id,
    count(s.id)::integer as total_steps,
    count(s.id) filter (where s.completed_at is not null)::integer as completed_steps
  from public.quests q
  left join public.quest_steps s on s.quest_id = q.id
  group by q.id
), computed as (
  select q.id, q.user_id, q.parent_quest_id, q.title, q.kind, q.due_date, q.created_at, q.updated_at,
    case when q.kind = 'subquest' then
      case when sc.total_steps = 0 then 0 else round((sc.completed_steps::numeric / sc.total_steps) * 100)::integer end
    else coalesce((
      select round(avg(case when child_steps.total_steps = 0 then 0
        else (child_steps.completed_steps::numeric / child_steps.total_steps) * 100 end))::integer
      from public.quests child
      join step_counts child_steps on child_steps.quest_id = child.id
      where child.parent_quest_id = q.id
    ), 0) end as progress_percent
  from public.quests q
  join step_counts sc on sc.quest_id = q.id
)
select *, case when progress_percent = 0 then 'not_started' when progress_percent = 100 then 'done' else 'in_progress' end::text as status
from computed;
grant select on public.quest_progress to authenticated;

-- ---------------------------------------------------------------------------
-- XP award + completion: lock parent then child so concurrent last-steps serialize
-- ---------------------------------------------------------------------------
create or replace function public.award_completed_quest_xp(p_quest_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_kind public.quest_kind;
  v_parent_id uuid;
  v_amount integer;
  v_inserted integer;
begin
  select kind, parent_quest_id into v_kind, v_parent_id
  from public.quests where id = p_quest_id and user_id = p_user_id
  for update;
  if not found then return false; end if;

  if v_kind = 'subquest' then
    if not exists (select 1 from public.quest_steps where quest_id = p_quest_id)
      or exists (select 1 from public.quest_steps where quest_id = p_quest_id and completed_at is null) then
      return false;
    end if;
    v_amount := 250;
  else
    if not exists (select 1 from public.quests where parent_quest_id = p_quest_id)
      or exists (
        select 1 from public.quests child
        where child.parent_quest_id = p_quest_id
          and (
            not exists (select 1 from public.quest_steps where quest_id = child.id)
            or exists (select 1 from public.quest_steps where quest_id = child.id and completed_at is null)
          )
      ) then
      return false;
    end if;
    v_amount := 1000;
  end if;

  insert into public.xp_ledger (user_id, source, source_id, amount, note)
  values (p_user_id, 'quest_completion', p_quest_id, v_amount, 'Awarded from computed quest completion')
  on conflict (user_id, source, source_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;
revoke all on function public.award_completed_quest_xp(uuid, uuid) from public, anon, authenticated;

create or replace function public.complete_quest_step(
  p_step_id uuid, p_evidence_type public.evidence_type, p_evidence_value text
)
returns table (step_id uuid, completed_at timestamptz, xp_awarded boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_quest_id uuid;
  v_parent_quest_id uuid;
  v_completed_at timestamptz;
  v_xp_awarded boolean := false;
  v_evidence text := trim(both from coalesce(p_evidence_value, ''));
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;
  if char_length(v_evidence) < 1 or char_length(v_evidence) > 4000 then
    raise exception 'Completion requires evidence between 1 and 4,000 characters';
  end if;

  select s.quest_id, q.parent_quest_id, s.completed_at
    into v_quest_id, v_parent_quest_id, v_completed_at
  from public.quest_steps s
  join public.quests q on q.id = s.quest_id
  where s.id = p_step_id and q.user_id = v_user_id;
  if not found then raise exception 'Quest step not found'; end if;

  -- Lock ancestor first to avoid deadlocks when sibling subquests finish together.
  if v_parent_quest_id is not null then
    perform 1 from public.quests where id = v_parent_quest_id for update;
  end if;
  perform 1 from public.quests where id = v_quest_id for update;
  select s.completed_at into v_completed_at from public.quest_steps s where s.id = p_step_id for update;

  if v_completed_at is null then
    perform set_config('levi.allow_step_completion', 'on', true);
    update public.quest_steps
      set completed_at = now(), evidence_type = p_evidence_type, evidence_value = v_evidence
      where id = p_step_id;
    select s.completed_at into v_completed_at from public.quest_steps s where s.id = p_step_id;
  end if;

  v_xp_awarded := public.award_completed_quest_xp(v_quest_id, v_user_id);
  if v_parent_quest_id is not null then
    v_xp_awarded := public.award_completed_quest_xp(v_parent_quest_id, v_user_id) or v_xp_awarded;
  end if;
  return query select p_step_id, v_completed_at, v_xp_awarded;
end;
$$;
revoke all on function public.complete_quest_step(uuid, public.evidence_type, text) from public, anon;
grant execute on function public.complete_quest_step(uuid, public.evidence_type, text) to authenticated;
