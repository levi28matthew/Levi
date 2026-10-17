# LEVI OS — Implementation Plan

An ordered, executable roadmap. Each item states the outcome, the evidence that it is
done, and where relevant the migration/screen it touches. Items marked ✅ are complete
and verified in this repository; items marked ⏭ are not started.

> **Before any ⏭ item ships:** the migrations must be applied to the Supabase project
> deliberately (see `README.md`). The remote schema is currently unknown — see
> `docs/PROJECT_AUDIT.md` §5.

---

## Phase 0 — Verification foundation ✅

| Item | Outcome | Evidence |
| --- | --- | --- |
| Green baseline | lint, typecheck, tests and build all pass | command output recorded in `docs/PROJECT_AUDIT.md` §6 |
| SQL harness | every migration is applied to an empty Postgres and asserted | `scripts/db-verify.mjs`, `npm run db:test` → 7 migrations / 69 assertions |
| CI | the same checks run on every push/PR | `.github/workflows/ci.yml` |

## Phase 1 — Canonical arithmetic ✅

| Item | Outcome | Evidence |
| --- | --- | --- |
| Levels | one documented formula in TS **and** SQL | `src/lib/progression.ts`, `xp_for_level`/`level_for_xp` |
| XP awards | one table of amounts | `XP_AWARDS` in `progression.ts` |
| Streaks/consistency | one documented rule in TS **and** SQL | `src/lib/habits.ts`, `habit_summary` |
| Calendar dates | all "today" values are local dates | `src/lib/dates.ts`, `profiles.time_zone` |
| Money | exact integer minor units | `src/lib/finance.ts` |
| Input cleaning | every server action validates at the boundary | `src/lib/input-validation.ts` |

## Phase 2 — Quest engine ✅ (hardened)

| Item | Outcome | Evidence |
| --- | --- | --- |
| Quest CRUD | main quests, subquests, steps | `/quests`, `src/app/(app)/quests/actions.ts` |
| Evidenced completion | a step cannot complete without evidence | `complete_quest_step` + assertion |
| Derived progress | `quest_progress` view; status is read-only | assertion _"the progress view still exposes both quests"_ |
| Runtime fix | the ambiguity that broke every completion is gone | `phase2_hardening.sql`, assertion |
| Replayable migrations | the full sequence applies to an empty database | `db:test` applies all six in order |

## Phase 3 — Core daily loop ✅

| Item | Outcome | Evidence |
| --- | --- | --- |
| Daily missions | planned → active → completed/skipped/blocked with reasons | `daily_missions`, `set_mission_status`, `/missions` |
| XP for missions | +50 on completion, 0 for skipped/blocked | assertions on award and skip |
| Reversal-safe XP | reopen removes, re-complete restores, never duplicates | three dedicated assertions |
| Habits | scheduled weekdays, per-day logs, archive/restore | `habits`, `habit_logs`, `/habits` |
| Habit XP | +20 per logged day, idempotent | assertions |
| Streaks | current/longest computed in SQL | assertions incl. Mon/Wed/Fri case |
| Achievements | idempotent sweep, deterministic awards | `sync_achievements`, assertions |
| Player stats | one canonical snapshot view | `player_stats` + assertions |

## Phase 4 — Real-data Command Center ✅

| Item | Outcome | Evidence |
| --- | --- | --- |
| Command Center | levels, today's missions, habits, quests, XP history, achievements | `src/app/(app)/dashboard/page.tsx` |
| No mock data | pages render empty states instead of samples | `/dashboard` builds dynamic (`ƒ`), not static |
| Honest failures | error boundary + retry, setup notice when unconfigured | `(app)/error.tsx`, `ConfigurationNotice` |
| Feedback | every mutation reports success or a reason | `ActionForm`, `src/lib/action-result.ts` |

## Phase 5 — Harden the daily loop ⏭

Ordered by value; each is small and independently shippable.

1. **Undo/redo for missions, not just reopen.** Reuse `reopen_mission` per status so
   "undo skip" and "undo block" are one click. _Evidence:_ mission card shows an undo
   action; `db:test` asserts XP stays balanced across a skip→undo cycle.
2. **Day review.** A read-only `/review?date=` summary (completed / skipped / blocked /
   logged habits / XP earned) computed from the same views. _Evidence:_ new route renders
   only persisted rows; no new tables.
3. **Habit notes and backfill UI.** `log_habit` already accepts a note and any date; add a
   small "log another day" control. _Evidence:_ action test + manual check.
4. **Focus sessions.** A `focus_sessions` table (`started_at`, `ended_at`, `mission_id`)
   with a partial unique index so only one session is open at a time; a timer component.
   _Evidence:_ migration + assertions (only one open session; ending is idempotent).
5. **Mission ordering.** Persist drag-order via the existing `position` column behind an
   RPC, so manual order survives without breaking the priority sort.

## Phase 6 — Finance (wire the tested engine) ⏭

1. Tables: `accounts`, `transactions` (`amount_minor bigint`, `currency char(3)`,
   `category`, `occurred_on date`), `budgets`. Enforce `char_length(currency) = 3` and
   `amount_minor <> 0` in the schema.
2. Balances are **derived** (a `security_invoker` view summing by account/currency), never
   stored. _Evidence:_ assertion that the view equals the sum of rows.
3. Budget usage uses `budgetUsage()`; no floating point anywhere. _Evidence:_ unit tests
   plus a SQL cross-check on a fixture.

## Phase 7 — Journal, reviews, and read-only AI ⏭

1. Journal entries keyed to a local date, private by RLS.
2. Weekly/monthly reviews that snapshot the derived stats (a review is a note attached to
   real numbers, not a new source of truth).
3. AI as a **read-only advisor**: it may read a stats snapshot and produce prose; it must
   never write XP, missions or habits. Any suggestion becomes a draft the user confirms.

---

## Cross-cutting rules for every new phase

- A new rule that matters ships as a constraint/trigger/RPC **and** an assertion in
  `supabase/tests/10_engine_assertions.sql`.
- New arithmetic lives in a pure module with unit tests, never inline in a component.
- A page either shows real records or an explicit empty state — never sample data.
- Destructive operations (delete) stay blocked wherever XP or history would be lost.
