# LEVI OS — Project Audit

_Last verified: 2026-10-18 · Next.js 16.3.4 (Turbopack) · Node 22 · stage A (undo/redo, day
review, habit backfill) included._

## 1. Purpose and scope

LEVI OS is a personal Life Operating System. Its promise is narrow and testable:

> every number shown on screen is derived from a record the user actually saved.

This audit records what the repository contained, what was broken, how each defect was
proven, what was changed, and what remains unknown. It is deliberately conservative:
anything that could not be executed or verified is listed as unverified.

## 2. What the repository contained before this work

A Next.js App Router + TypeScript + Tailwind v4 + Supabase foundation with:

| Area | Files |
| --- | --- |
| Entry | `src/app/page.tsx`, `src/app/login/page.tsx`, `src/app/auth/callback/route.ts` |
| Legacy app routes | `src/app/dashboard/page.tsx` (preview), `src/app/quests/page.tsx` + `actions.ts` |
| Data access | `src/lib/supabase/{client,server}.ts`, `src/lib/utils.ts`, `src/lib/quest-validation.ts` |
| Domain (pure) | `src/lib/progress.ts`, `src/types/{database,domain}.ts` |
| Schema | `supabase/migrations/202609110001_initial_core.sql`, `…_quest_engine.sql`, `…phase2_hardening.sql`, `…phase2_reconciliation.sql` |
| Tests | `src/lib/progress.test.ts`, `src/lib/quest-validation.test.ts` |
| CI | `.github/workflows/ci.yml` (lint, typecheck, test, build) |

Pre-existing scope: authentication, quest → subquest → step modelling, evidence-backed
step completion, derived quest progress, and an append-only `xp_ledger`.

## 3. Method

1. Establish a green baseline by running the real repository scripts.
2. Read every migration and every route; treat "compiles" as unproven until exercised.
3. Build a throwaway PostgreSQL harness (`scripts/db-verify.mjs`, `npm run db:test`)
   that applies **all** migrations in order to an empty database and then runs
   assertions written from the documented intent.
4. Fix what the harness proved broken, and keep the assertion that would catch it again.
5. Centralise arithmetic (XP, levels, progress, money) in one tested module per concern,
   mirrored in SQL where the database is authoritative.
6. Re-run every script and record the real output.

## 4. Defects found, with evidence

### 4.1 The only XP path in the app failed at runtime — **critical**

`complete_quest_step()` raised `column reference "completed_at" is ambiguous` on every
call, because the parameter-less `for update` select and the final `return query`
referenced `completed_at` from two joinable relations (`quest_steps` and `quests`).

- **Effect:** no user could ever complete a step, so no quest XP was reachable.
- **How it was proven:** the `db:test` harness executed the function; it errored every time.
- **Fix:** `complete_quest_step` is redefined in
  `supabase/migrations/20260911140000_phase2_hardening.sql` with every column reference
  qualified through the `quest_steps` alias. Regression coverage lives in
  `supabase/tests/10_engine_assertions.sql`.

### 4.2 The migration sequence was not replayable — **high**

`phase2_hardening.sql` followed by `phase2_reconciliation.sql` failed with
`policy … already exists`: both files created policies with the same names, so applying
the sequence to a fresh database (or to a new environment) broke.

- **How it was proven:** the harness applies migrations strictly in timestamp order to an
  empty database; the sequence failed to apply.
- **Fix:** `phase2_reconciliation.sql` now drops every policy name it is about to create
  before creating it, making the whole sequence idempotent and replayable.

### 4.3 Re-completing a reopened mission did not restore XP — **high**

Once a mission was reopened, its XP was removed. Completing it again found the existing
award row, but nothing restored the balance — the mission ended up complete with 0 XP.

- **Fix:** `set_mission_status` now inspects the adjustment balance of an existing award
  and applies a balancing adjustment when a completion is restored. Assertions:
  _"re-completing restores exactly 50 XP"_, _"restoring XP is recorded as a second
  adjustment, never as a new award"_, _"completing twice never double-awards"_.

### 4.4 The Command Center rendered invented data — **high**

`src/app/dashboard/page.tsx` was a static component that hard-coded `xp = 0` and a
`previewQuests` list, and `/dashboard` built as a **static** route (`○`) — proof it never
touched the database. The README even documented a "preview dashboard".

- **Fix:** every module page now reads real, RLS-scoped records; `/dashboard`, `/missions`,
  `/habits`, `/quests` and `/settings` build as **dynamic** routes (`ƒ`). Empty states are
  shown instead of sample data.

### 4.5 No authoritative level or streak engine — **medium**

Levels existed only as a helper with no documented formula, no database counterpart and
no shared awards table; habit streaks did not exist at all.

- **Fix:** one documented formula in TypeScript (`src/lib/progression.ts`) mirrored
  exactly in Postgres (`xp_for_level` / `level_for_xp`), and one documented streak rule in
  both `src/lib/habits.ts` and the SQL `habit_summary` function.

### 4.6 Editing a mission plan was impossible, and the time zone was bypassable — **medium**

Wiring the real screens exposed two gaps in the database privileges:

- `daily_missions` had **no** `UPDATE` grant and no update policy, so the new "Save plan"
  control would have failed with `permission denied` — a typo in a mission title could
  only be fixed by deleting and re-creating the mission.
- `profiles` granted a table-wide `UPDATE`, so a client could write `profiles.time_zone`
  directly and bypass the server-side validation in `set_time_zone()`.

- **Fix:** `supabase/migrations/20260918110000_plan_edit_grants.sql` adds an update policy
  and a **column-level** grant on `daily_missions` (plan columns only) and restricts
  `profiles` to `display_name`. State columns (`status`, `completed_at`, `outcome`) remain
  unwritable by clients.
- **Evidence:** six new assertions, including _"a client can edit a planned mission"_,
  _"a mission cannot be completed outside set_mission_status"_ and _"the time zone can
  only change through set_time_zone"_.

### 4.7 A habit day could be logged in the future — **medium**

`log_habit` accepted **any** date. A future day is not evidence of work, so a user (or a
script) could pre-log tomorrow — or next year — and collect 20 XP for each day that had not
happened yet. The streak rules hid the effect, but the ledger kept the XP.

There was also no way to ask what happened on a *past* day: the Command Center could only
describe now, and the missions page could only report its own rows.

- **Fix:** `supabase/migrations/20260918120000_day_review_backfill.sql`:
  - `log_habit` now rejects a **future** date, computed from the caller's stored IANA zone
    (never the server's UTC date), and a missing date. Backfilling a past day still awards
    its 20 XP exactly once.
  - `day_summary(p_date, p_time_zone)` is the single read model for one local calendar day
    (XP awarded/adjusted/net, missions by status, habits logged vs expected, achievements
    unlocked), and the new `/review?date=` screen renders it verbatim.
- **Evidence:** 15 new assertions, including _"a future habit day is rejected"_, _"backfill
  records the work on the past day but never rewrites that day's XP"_, _"logging the same
  past day twice still awards XP exactly once"_ and _"another user's day summary is empty"_.
- **Also corrected in passing:** the SQL fixtures treated the database's UTC `current_date`
  as "today" while the profile had been switched to `America/Los_Angeles` earlier in the
  suite. The fixtures now set the zone back to UTC explicitly, and the local-date
  interaction is asserted in its own section, so the suite no longer depends on the time of
  day it runs at.

## 5. Unknowns and risks (do not assume)

| Item | Detail |
| --- | --- |
| **Remote Supabase state** | `supabase/.temp/` shows the repo is linked to a remote project, but **no migration was pushed**. The remote schema is unknown and may not match `supabase/migrations`. |
| **Applying migrations** | Must be done deliberately by the project owner. Nothing in this work touches the remote database. |
| **No service-role key** | Only the publishable key is used; all privileged writes go through `security definer` RPCs. |
| **Auth provider** | Login is magic-link (`signInWithOtp`); delivery depends on the Supabase project's email configuration, which cannot be verified from the repository. |
| **Finance module** | `src/lib/finance.ts` is complete and tested but **not yet wired** to any table, action or screen. |

## 6. Baseline verification (real output)

_Stage A (undo/redo, day review, backfill guard) re-ran every script. Numbers below are the
current, real output._

| Command | Result |
| --- | --- |
| `npm run lint` | 0 errors, 0 warnings |
| `npm run typecheck` | clean (`tsc --noEmit`) |
| `npm test` | **62 passed** (8 files) |
| `npm run db:test` | **8 migrations applied, 84 assertions held** |
| `npm run build` | success; app routes are dynamic (`ƒ`), including `/review` |

See `docs/FEATURE_STATUS.md` for a per-feature status table, `docs/ARCHITECTURE.md` for
the design and invariants, and `docs/IMPLEMENTATION_PLAN.md` for the ordered roadmap.
