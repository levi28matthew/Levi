# LEVI OS — Architecture

This document explains **why** the system is shaped the way it is. The invariant behind
every rule is the same:

> state is derived from records, and records are append-only where money or XP is
> involved. Anything a user can see must be traceable to something they saved.

## 1. Layering

```
┌─────────────────────────────────────────────────────────────────┐
│ Server Components (src/app/(app)/**)                            │
│   read-only: call queries.ts, render UI, never mutate           │
├─────────────────────────────────────────────────────────────────┤
│ Server Actions ("use server")                                   │
│   validate input → call an RPC or a scoped insert/update        │
│   → revalidate → return an ActionResult for the form to show    │
├─────────────────────────────────────────────────────────────────┤
│ Data access (src/lib/queries.ts, src/lib/auth.ts)               │
│   the only place that talks to Supabase                         │
├─────────────────────────────────────────────────────────────────┤
│ Domain engines (pure, tested)                                   │
│   progression.ts · habits.ts · finance.ts · dates.ts            │
│   input-validation.ts · quest-validation.ts                     │
├─────────────────────────────────────────────────────────────────┤
│ PostgreSQL (supabase/migrations/**)                             │
│   constraints + RLS + security-definer RPCs are the last word   │
└─────────────────────────────────────────────────────────────────┘
```

Rules that keep the layering honest:

- **Clients never compute authoritative values.** The UI may format, but XP, levels,
  progress and streaks come from records (and, for streaks, from SQL).
- **The browser is never trusted.** Every server action re-validates its input with the
  shared cleaners in `src/lib/input-validation.ts`, and Postgres validates again with
  real constraints.
- **The database is the final authority.** A rule that matters (XP cannot be
  double-awarded, a habit log cannot be forged, a mission cannot be completed without an
  XP event) is enforced by a constraint, a trigger or an RPC — not only by the UI.

## 2. The XP ledger

`public.xp_ledger` is append-only. Every row has `(user_id, source, source_id, amount)`,
and `unique (user_id, source, source_id)` makes every award **idempotent**: the same
event can be retried any number of times and still awards once.

### Corrections without mutation

Un-checking a habit or reopening a mission must remove XP, but nothing may be deleted or
rewritten. Corrections are therefore **adjustment rows**:

- an adjustment has `reversal_of = <award id>`, `source` inherited from the award, a
  fresh `source_id` (so the award's unique key is untouched) and a negative or positive
  `amount`;
- a trigger (`validate_xp_adjustment`) keeps the balance
  `award.amount + Σ(adjustments) ∈ {0, award.amount}`. XP can be removed and restored,
  but it can never be counted twice or drift to a third value;
- an adjustment can never point at another adjustment.

This is why "log the same habit day twice" is safe, and why "reopen then re-complete"
restores exactly the original award.

### Award amounts (single source of truth)

Defined in `src/lib/progression.ts` (mirrored by the SQL callers):

| Event | XP |
| --- | --- |
| Daily mission completed | 50 |
| Habit day logged | 20 |
| Subquest completed (all steps evidenced) | 250 |
| Main quest completed (all subquests complete) | 1000 |
| Achievement | per definition (25–500) |

Mission _skipped_ and _blocked_ award 0 XP; they are recorded honestly with a required
reason.

## 3. Levels

One formula, implemented identically in TypeScript and SQL:

```
xp_for_level(L) = 250 * (L - 1) * L / 2      -- cumulative XP to *reach* level L
```

| Level | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- |
| XP to reach | 0 | 250 | 750 | 1500 | 2500 | 3750 |

Progress inside a level is always derived from the ledger total — never stored — so it
cannot drift from the events that produced it. The SQL view `player_stats` exposes
`total_xp`, `level`, `xp_into_level`, `xp_for_next_level` and `xp_to_next_level`; the TS
`levelProgress()` returns the same numbers. Both are covered by tests
(`src/lib/progression.test.ts`, `10_engine_assertions.sql`).

## 4. The daily loop

### Missions (`daily_missions`)

- **Create:** `create_mission(...)` RPC, or a direct insert that RLS restricts to
  `status in ('planned','active')` with no `completed_at` and no `outcome`.
- **Change state:** only `set_mission_status(...)` / `reopen_mission(...)`. There is no
  table-wide `update` grant on `daily_missions`; the client holds a **column-level** grant
  on the plan columns only (`title`, `priority`, `estimate_minutes`, `success_criteria`,
  `notes`, `mission_date`, `position`). A direct `status = 'completed'` write is rejected
  by Postgres itself, so a mission cannot be marked complete without the matching XP event.
- **Delete:** allowed only while the mission has never awarded XP (enforced by trigger);
  otherwise reopen or skip it.
- **Invariant:** `daily_missions_state_check` requires a `completed_at` for completed
  missions and a non-empty `outcome` for skipped/blocked ones.

### Habits (`habits`, `habit_logs`)

- A habit day is one row per habit per **local calendar date** (`unique (habit_id, log_date)`).
- `habit_logs` is **SELECT-only** for clients; writes go through `log_habit(...)`, which is
  idempotent and moves the XP to match the row's state.
- Archiving (`archived_at`) hides a habit without deleting its history or its XP.

## 5. The one streak rule

Implemented twice on purpose — once for display (`src/lib/habits.ts`) and once as the
authority (`habit_summary` in SQL) — with the same documented rule:

1. If today was explicitly logged as **not** completed → streak is **0** (the scheduled
   day was failed, not merely pending).
2. If today **is** completed → the streak ends today.
3. Otherwise today is still open → the streak is measured up to the most recent
   **scheduled** occurrence before today.

A day the habit was not scheduled for never breaks a streak. `habit_summary` uses
gaps-and-islands over *scheduled occurrences* (via `row_number()`), so a Mon/Wed/Fri habit
keeps its streak across unscheduled days instead of being reset every Tuesday.

## 6. Calendar dates and time zones

`profiles.time_zone` holds an IANA zone, validated server-side against
`pg_timezone_names` by the `set_time_zone(...)` RPC — a typo is rejected rather than
silently shifting every day.

Everything the user experiences is a **local calendar date** (`YYYY-MM-DD`):
`src/lib/dates.ts` converts an instant with `Intl` (`toCalendarDate`) and all date
arithmetic is done on date strings (`addDays`, `daysBetween`, `eachDate`, `isoWeekday`).
The client supplies `mission_date` / `log_date`, so work never lands on the wrong day
because the server runs in UTC. Pages resolve "today" once, in
`getSessionContext()`.

## 7. Authorization

- Every table used by a user is protected by **row level security** tied to `auth.uid()`.
- `player_stats`, `level_history` and `quest_progress` are `security_invoker` views: they
  run with the caller's own permissions, so RLS still applies. Their counts are
  correlated to `profiles.id` (not `auth.uid()`) so they are correct both under RLS and
  inside a `security definer` function.
- Privileged operations are `security definer` functions with an explicit
  `search_path = public`; `execute` is granted to `authenticated` only.
- Where a client genuinely edits rows (a mission plan, a quest title, a display name),
  the permission is granted **per column**, so the columns that carry meaning (`status`,
  `completed_at`, `outcome`, `time_zone`, `user_id`) stay writable only through the
  routines that own them.

## 8. Achievements

`sync_achievements()` is idempotent and re-runnable. It reads the canonical
`player_stats` snapshot, inserts any newly earned rows into `player_achievements`
(`on conflict do nothing`), and awards XP through `award_xp` keyed on a **deterministic**
`source_id` (`deterministic_uuid(user:achievement)`), so a re-run can never double-award.
The TS catalogue in `src/lib/progression.ts` is display metadata; the SQL function is the
authority.

## 9. Money (prepared, not yet wired)

`src/lib/finance.ts` stores money as **integer minor units + ISO-4217 code** and never
uses binary floating point. `parseMoney`/`toDecimalString` are exact, currency exponents
(JPY = 0, KWD = 3 …) are honoured, and `budgetUsage` avoids divide-by-zero. The matching
SQL storage convention is `numeric`/`bigint` minor units. No table or screen uses it yet.

## 10. Testing strategy

| Layer | How it is verified |
| --- | --- |
| Pure domain | Vitest unit tests (`src/lib/*.test.ts`) |
| SQL engine | `npm run db:test` — all migrations applied to a throwaway Postgres container, then `supabase/tests/*.sql` assertions |
| Integration | `npm run build` must succeed and app routes must build as dynamic |
| Lint/types | `npm run lint`, `npm run typecheck` |

The SQL harness is the important one: it is what caught the broken
`complete_quest_step`, the non-replayable migration sequence and the missing XP restore.
New SQL behaviour is expected to arrive with an assertion in
`supabase/tests/10_engine_assertions.sql`.
