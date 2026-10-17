# LEVI OS — Feature Status

Honest, per-feature status. **Statuses:** ✅ verified · 🟡 partial · ⏭ not started.
"Verified" means there is a command or route that was actually exercised — not that the
code merely exists.

_Last verified: 2026-10-18. Commands: `npm run lint` · `npm run typecheck` · `npm test`
(58 passed) · `npm run db:test` (7 migrations, 69 assertions) · `npm run build`._

## Foundation

| Feature | Status | Evidence / notes |
| --- | --- | --- |
| Next.js 16 App Router + TypeScript | ✅ | `npm run build` succeeds |
| Tailwind v4 + design tokens | ✅ | `src/app/globals.css` (dark-first, light counterpart, reduced-motion) |
| Supabase client/server adapters | ✅ | `src/lib/supabase/{client,server}.ts` |
| Magic-link auth | ✅ | `src/app/login/page.tsx`, `/auth/callback`; session-guarded layout |
| Sign out | ✅ | `POST /auth/signout` → redirect `/login` (POST only, never GET) |
| Unconfigured setup notice | ✅ | `ConfigurationNotice` instead of a crash |
| Error boundary + retry | ✅ | `src/app/(app)/error.tsx` |
| Loading skeleton | ✅ | `src/app/(app)/loading.tsx` |

## Progression

| Feature | Status | Evidence / notes |
| --- | --- | --- |
| XP ledger (append-only) | ✅ | assertions: _"the XP ledger is append-only"_, _"clients cannot insert XP ledger rows"_ |
| Idempotent awards | ✅ | `unique (user_id, source, source_id)`; _"completing twice never double-awards"_ |
| Auditable corrections | ✅ | balanced adjustments; _"the reopen appends an auditable adjustment instead of deleting history"_ |
| Level formula (TS + SQL) | ✅ | `progression.test.ts`; _"player stats level is 3 at 1250 XP"_ |
| XP history view | ✅ | `level_history`; rendered on the Command Center |
| Achievements | ✅ | `sync_achievements`; _"re-running achievement sync unlocks nothing new"_ |
| Canonical player stats | ✅ | `player_stats`; _"a new user starts at 0 XP"_ |

## Quests

| Feature | Status | Evidence / notes |
| --- | --- | --- |
| Main quests / subquests / steps | ✅ | `/quests` |
| Evidence-backed step completion | ✅ | `complete_quest_step` (previously broken — see audit §4.1) |
| Rewards on completion | ✅ | 250 XP subquest, 1000 XP main quest |
| Derived progress + status | ✅ | `quest_progress` (security_invoker), read-only in the UI |
| Replayable migrations | ✅ | `db:test` applies all seven in order (previously failed — audit §4.2) |

## Daily loop

| Feature | Status | Evidence / notes |
| --- | --- | --- |
| Daily missions with priorities/estimates | ✅ | `/missions` |
| State machine via RPC only | ✅ | no table-wide `update` on `daily_missions`; plan columns are granted per column |
| Edit a mission plan | ✅ | column-level grant; _"a client can edit a planned mission"_ |
| Reasons required to skip/block | ✅ | constraint + action validation |
| Mission XP (+50) and reversal | ✅ | reopen removes, re-complete restores (audit §4.3) |
| Habits with weekday schedules | ✅ | `/habits` |
| Habit logs (SELECT-only for clients) | ✅ | `log_habit` RPC; _"clients cannot write habit logs directly"_ |
| Streaks (current/longest) | ✅ | `habit_summary`; Mon/Wed/Fri case asserted |
| 30-day consistency | ✅ | `src/lib/habits.ts`; shown on each habit card |
| Archive / restore habit | ✅ | `archived_at`, history and XP preserved |
| Undo a logged day | ✅ | "Undo today" action; XP removed, not duplicated |

## Command Center

| Feature | Status | Evidence / notes |
| --- | --- | --- |
| Real XP / level / progress | ✅ | `/dashboard` (dynamic route) |
| Today's missions + carried-over work | ✅ | `/dashboard`, `/missions` |
| Habits due vs logged today | ✅ | local-date aware |
| Active quests with progress | ✅ | from `quest_progress` |
| Recent XP ledger entries | ✅ | from `level_history` |
| Achievement gallery | ✅ | from `achievements` + `player_achievements` |
| No mock/preview data anywhere | ✅ | app routes build as `ƒ`; empty states used |

## Settings

| Feature | Status | Evidence / notes |
| --- | --- | --- |
| Display name | ✅ | `saveDisplayName` |
| Time zone (validated server-side) | ✅ | `set_time_zone` against `pg_timezone_names`; a direct `profiles.time_zone` write is rejected by privilege |
| Local "today" shown | ✅ | from `getSessionContext()` |

## Prepared but not wired

| Feature | Status | Notes |
| --- | --- | --- |
| Money engine | 🟡 | `src/lib/finance.ts` tested (11 tests); **no table or screen yet** |
| Domain aliases (`src/types/domain.ts`) | 🟡 | legacy duplicate of schema types; safe to retire when unused |

## Not started (roadmap — see `docs/IMPLEMENTATION_PLAN.md`)

| Feature | Status |
| --- | --- |
| Undo/redo for skipped/blocked missions | ⏭ |
| Day review screen | ⏭ |
| Habit backfill UI | ⏭ |
| Focus sessions / timer | ⏭ |
| Manual mission ordering | ⏭ |
| Finance (accounts, transactions, budgets) | ⏭ |
| Journal, weekly/monthly reviews | ⏭ |
| Read-only AI advisor | ⏭ |

## Known limitations

- The Supabase migrations have **not** been applied to the remote project; the remote
  schema is unknown. Nothing here asserts the remote state.
- Auth email delivery depends on the Supabase project's configuration and cannot be
  verified from the repository.
- `AGENTS.md` / `CLAUDE.md` are generated/maintained tooling notes at the repo root and
  are not part of LEVI OS runtime behaviour.
