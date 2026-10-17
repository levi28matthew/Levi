# LEVI OS

An evidence-based personal operating system. Every number on screen is derived from a
record you actually saved — XP is an append-only ledger, levels and streaks are computed
from it, and nothing is ever hard-coded or sampled.

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/PROJECT_AUDIT.md`](docs/PROJECT_AUDIT.md) | what the repo contained, defects found (with evidence), risks |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | layering, the XP model, the level formula, the streak rule, RLS |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | the ordered roadmap (done ✅ and next ⏭) |
| [`docs/FEATURE_STATUS.md`](docs/FEATURE_STATUS.md) | per-feature status with verification evidence |

## What works today

- **Auth** — passwordless magic link, session-guarded app shell.
- **Command Center** (`/dashboard`) — level, XP progress, today's missions, habits due,
  active quests, recent XP and achievements, all from real records.
- **Missions** (`/missions`) — plan any calendar day; complete, skip or block with a
  reason; carried-over work is surfaced.
- **Habits** (`/habits`) — weekday schedules, per-day logging, real streaks and 30-day
  consistency, archive/restore that keeps history, and backfill for a past day.
- **Quests** (`/quests`) — main quest → subquest → evidenced step, with derived progress.
- **Day review** (`/review?date=`) — a read-only record of one finished day: XP recorded,
  missions by status, habits logged vs expected, achievements unlocked.
- **Settings** (`/settings`) — display name and a server-validated IANA time zone.

## Local setup

1. **Environment.** Copy `.env.example` to `.env.local` and set
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the publishable
   key only — never a service-role key).
2. **Database.** Apply every file in `supabase/migrations/` to your Supabase project in
   timestamp order. Migrations are additive and replayable; the sequence has been applied
   from empty and asserted by `npm run db:test`.
   > The migrations in this repository have **not** been pushed to any remote project.
   > Confirm the target project's current schema before applying them.
3. **Install and run.** `npm install` then `npm run dev`.

> On PowerShell, use `npm.cmd run <script>` if the execution policy blocks `npm.ps1`.

## Verification

Run these before trusting any change; they are exactly what CI runs.

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # Vitest unit tests (pure domain engines)
npm run db:test     # applies ALL migrations to a throwaway Postgres + 84 SQL assertions
npm run build       # production build; app routes must be dynamic (ƒ)
```

`npm run db:test` needs Docker (it pulls `postgres:17-alpine`, uses a tmpfs data dir,
reads no credentials and removes the container afterwards). It is the check that proves
the SQL layer — including the XP ledger rules — actually behaves as documented.

## Project layout

```
src/app/(app)/        signed-in shell + dashboard, missions, habits, quests, review, settings
src/app/(auth|login)  auth callback, sign out, magic-link login
src/components/       UI building blocks (ui.tsx, ActionForm, MissionCard, HabitCard, nav)
src/lib/              pure engines (progression, habits, finance, dates, validation)
                      + data access (queries, auth) and action results
src/types/database.ts hand-written Supabase types checked against the migrations
supabase/migrations/  the schema and the XP engine
supabase/tests/       SQL assertions run by `npm run db:test`
scripts/db-verify.mjs the ephemeral-database harness
```

## Heritage

The original repository contained a single standalone `Index.html` (an interactive
birthday-message site). It is preserved as a legacy artifact and is not part of the LEVI OS
runtime.
