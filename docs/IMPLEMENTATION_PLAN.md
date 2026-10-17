# LEVI OS — Implementation Plan

An ordered, executable roadmap for finishing LEVI OS — **not** replacing it.

**Statuses:** ✅ verified (a command or route was actually exercised) · 🟡 partial
(something real exists, something real is missing) · ⏭ not started · 🔒 needs the project
owner (credentials, cost, or a production write).

_Last verified: 2026-10-18 · `npm run lint` · `npm run typecheck` · `npm test` (62 passed)
· `npm run db:test` (8 migrations, 84 assertions) · `npm run build`._

---

## Status at a glance — the twelve capabilities of the finished vision

| # | Capability | Status | One-line truth |
| --- | --- | --- | --- |
| 1 | Remote Supabase integration & production verification | 🔒 ⏭ | Migrations are proven on a throwaway Postgres, never on the project. |
| 2 | Mission undo/redo + historical day reviews | ✅ | Undo for skip/block, reopen for complete, `/review?date=` read-only. |
| 3 | Habit backfill | ✅ | Past days can be logged; the future is rejected by the database. |
| 4 | Focus sessions | ⏭ | No table, no timer. Design ready (Stage B). |
| 5 | Persistent mission ordering | 🟡 | `position` exists and is honoured, but nothing lets the user set it. |
| 6 | Finance tracking (DB + UI) | 🟡 | Exact money engine is tested; no table, action or screen. |
| 7 | Journaling and weekly reviews | ⏭ | Nothing stored; the quest engine is not a journal. |
| 8 | Career and learning management | 🟡 | Modelable on the quest engine today; no module of its own. |
| 9 | Knowledge library | ⏭ | Nothing stored. |
| 10 | Scripture and prayer journal | ⏭ | Only as a habit schedule ("every Mon/Wed/Fri"); no entries. |
| 11 | Read-only AI advisor | ⏭ | No code, no key. Constraints are already decided (Part 2.11). |
| 12 | Advanced analytics and personalization | 🟡 | `player_stats`, `level_history`, `day_summary`, streaks; no trends. |

---

## Part 1 — What is already verified (do not rebuild)

| Phase | Outcome | Evidence |
| --- | --- | --- |
| 0 — Verification foundation ✅ | every migration applied to an empty Postgres, then asserted; CI runs it | `scripts/db-verify.mjs`, `npm run db:test` → **8 migrations / 84 assertions**, `.github/workflows/ci.yml` |
| 1 — Canonical arithmetic ✅ | one formula per concern, in TS **and** SQL: levels, XP awards, streaks/consistency, calendar dates, money, input cleaning | `src/lib/{progression,habits,finance,dates,input-validation}.ts` + `src/lib/*.test.ts` (62 tests) |
| 2 — Quest engine ✅ | main quests → subquests → evidenced steps; derived progress; the runtime ambiguity is fixed | `complete_quest_step`, `quest_progress`, assertions |
| 3 — Core daily loop ✅ | missions (planned → active → completed/skipped/blocked, reasons required) and habits (scheduled weekdays, per-day logs, streaks, archive) | `set_mission_status`, `log_habit`, `habit_summary`, assertions |
| 4 — Real-data Command Center ✅ | every screen reads RLS-scoped records (or shows an empty state); no mock data | `/dashboard`, `/missions`, `/habits`, `/quests`, `/settings`, `/review` all build as `ƒ` |
| 5 — Daily loop completed ✅ | undo/redo, historical day review, backfill guard | Part 2.2, 2.3 below; 15 new assertions |

**Phase 5 detail (delivered in this stage):**

- **Undo.** A skipped or blocked mission now offers *Undo* → back to `planned`
  (`setMissionStatus` with `status: planned`). The retracted reason is cleared, because
  the mission was not really skipped. A completed mission still offers *Reopen*, which
  withdraws its XP without duplicating it.
- **Historical day review.** `/review?date=YYYY-MM-DD` renders one finished day:
  XP recorded (awarded / adjusted / net), missions by status, habits logged vs expected,
  achievements unlocked. Every number comes from the new `day_summary(date, time_zone)`
  SQL function — the UI computes nothing. A future date is clamped to today
  (`src/lib/review.ts`, unit-tested).
- **Habit backfill.** Each habit card has a "Backfill another day" control (date + result).
  `log_habit` now rejects a **future** calendar date (using the caller's stored IANA zone)
  and a missing date; backfilling a past day still awards its 20 XP exactly once.

---

## Part 2 — The remaining work, area by area

### 2.1 Remote Supabase integration and production verification 🔒

- **Exists:** 8 migrations that apply cleanly, in order, to an empty Postgres; a fully
  asserted engine; a linked project ref in `supabase/.temp/`.
- **Missing:** the migrations have never been applied to the project; the remote schema and
  data are unknown; auth email delivery is unverified; no deployed smoke test exists.
- **Evidence required:** a rehearsal (`supabase db push --dry-run`), a backup (`pg_dump`),
  the push itself, then the checklist in Part 4 executed against the real project.
- **Rule:** nothing in this repository writes to the remote database. This step is
  owner-run, once, deliberately.

### 2.2 Mission undo/redo and historical day reviews ✅

- **Exists:** undo (skip/block → planned), reopen (complete → active, XP withdrawn),
  `day_summary` + `/review`, date navigation, XP-attribution honesty ("XP belongs to the day
  it was recorded").
- **Missing (deliberate):** an *action history* ("undo my last three edits") and a
  multi-day weekly review. The ledger already answers "what happened when"; a multi-step
  undo would need a new append-only `action_log` and is scheduled as Stage C+.
- **Evidence:** assertions _"a backfilled day reports the log…"_, _"the XP net of a day
  always equals its awards plus its adjustments"_, _"another user's day summary is empty"_;
  `src/lib/review.test.ts`.

### 2.3 Habit backfill ✅

- **Exists:** the control on every habit card, a database-side future-date guard, one XP
  award per day, and an explicit "Not done (breaks the streak)" option so a miss can be
  recorded honestly.
- **Missing:** nothing functional. A calendar heat-map of logged days would make backfill
  more usable — that belongs to 2.12.

### 2.4 Focus sessions ⏭

- **Missing:** everything. Suggested shape (Stage B, repo-only):
  `focus_sessions(id, user_id, mission_id, habit_id, started_at, ended_at, minutes,
  note)`; a **partial unique index** `unique (user_id) where ended_at is null` so only one
  session is open at a time; `start_focus_session` / `end_focus_session` RPCs (idempotent:
  ending an ended session changes nothing); minutes derived from the timestamps, never typed
  in; XP only for *recorded* minutes (e.g. 1 XP per completed 10 minutes, capped), so the
  ledger stays honest.
- **Evidence required:** assertions for "only one open session", "ending twice does not
  double-award", "a session cannot end before it started"; a timer UI that works without
  JavaScript to *start*/*stop* (a plain form), enhanced client-side afterwards.

### 2.5 Persistent mission ordering 🟡

- **Exists:** `daily_missions.position`, assigned as `max + 1` by `create_mission`, exposed
  as a column-level update grant, ordered by in `getMissionsForDate`.
- **Missing:** the UI sorts open missions by priority (`missionSortKey`) and the user cannot
  set the order; two missions created out of order can only be reordered by editing their
  dates.
- **Next step (Stage B):** a `reorder_missions(p_date, p_ids uuid[])` RPC that rewrites
  `position` for the caller's own rows in one transaction (asserted: the order round-trips,
  foreign ids are rejected), plus ▲/▼ buttons that work without drag-and-drop. Explain in the
  UI that manual order wins over the priority sort.

### 2.6 Finance tracking with database integration and UI 🟡

- **Exists:** `src/lib/finance.ts` — exact integer minor units, ISO-4217 exponents,
  `budgetUsage`, 11 unit tests. **No table, action or screen.**
- **Missing (Stage F):** `accounts`, `transactions(amount_minor bigint, currency char(3),
  occurred_on date, category, note)`, `budgets`. Balances must be **derived** views, never
  stored columns. Constraints in the schema: `char_length(currency) = 3`,
  `amount_minor <> 0`, `budget period` ∈ a closed set.
- **Evidence required:** an assertion that the balance view equals the sum of its rows after
  inserts, edits and deletions; unit tests reused unchanged; a screen that shows only real
  rows.

### 2.7 Journaling and weekly reviews ⏭

- **Missing (Stage D):** `journal_entries(id, user_id, entry_date date, kind, title, body,
  tags text[], created_at)` with RLS and one entry per (user, date, kind) if a daily log is
  wanted; weekly reviews as a **derived snapshot** (the numbers come from
  `day_summary`/`player_stats`, the prose is the user's).
- **Rule:** a review note is a record attached to real numbers; it must never become a
  second source of truth for XP, streaks or missions.
- **Evidence required:** assertions for "a private entry is invisible to another user" and
  "a weekly review cites the same totals the ledger reports".

### 2.8 Career and learning management 🟡

- **Exists:** the quest engine already models the shape ("Become Job Ready" → subquests →
  evidenced steps) and `/quests` renders it with derived progress.
- **Missing (Stage E):** a module that names the career/learning concepts rather than
  adding a parallel progression system: applications (company, stage, next action, date),
  skills with a self-rated level and evidence links, and study sessions that reuse focus
  sessions and habits instead of a new XP source.
- **Rule:** no new XP source without a decision recorded in `docs/ARCHITECTURE.md` §2.

### 2.9 Knowledge library ⏭

- **Missing (Stage E):** `resources(id, user_id, title, url, kind, status, tags text[],
  notes, quest_id, created_at)` with RLS; a capture → triage → apply loop where "applied"
  links to a quest step or journal entry. Search can start as an `ilike` filter; no
  embeddings, no new dependency.

### 2.10 Scripture and prayer journal ⏭

- **Exists:** a habit can already schedule scripture reading (e.g. Mon/Wed/Fri) and its
  streak is real.
- **Missing (Stage D):** entries with `kind in ('scripture','prayer','reflection')`, an
  optional passage reference, and private RLS. This is the journal table from 2.7 with a
  kind — do not build a second one.
- **Rule:** reading is not a performance metric; a journal entry awards no XP. Only a
  habit day (already modelled) does.

### 2.11 Read-only AI advisor ⏭

- **Missing:** everything, including a provider key (owner action) — so this is
  **partially blocked**, though the read-only half can be built first.
- **Already decided:** the advisor may **read** a stats snapshot (`player_stats`,
  `day_summary`, recent missions and habits) and produce prose; it must **never** write XP,
  missions, habits or journal entries. Its suggestions are drafts the user confirms
  explicitly, and the prompt/response pair is stored as a record so advice is auditable.
- **Safe order:** build the snapshot + a "draft a plan for tomorrow" action that stores a
  *draft* (no side effects), then add the provider call behind an env var. Without the key
  the feature degrades to an empty state, exactly like `ConfigurationNotice`.

### 2.12 Advanced analytics and personalization 🟡

- **Exists:** `player_stats` (counts, level, XP into level), `level_history`, `day_summary`
  (per-day XP/missions/habits/achievements), streaks and 30-day consistency per habit.
- **Missing (Stage C):** trends over time — XP per local day for the last N days, completion
  rate per day, habit heat-map — and personalisation (which missions you actually finish,
  when you skip). Build them as SQL read models next to `day_summary` and render with the
  existing CSS (bar/sparkline), so no charting dependency and no client-side arithmetic is
  introduced.

---

## Part 3 — The safest order of work

Ordered by **safety and verifiability**, not by ambition. Each stage is additive, fully
testable from the repository, and leaves the application working.

| Stage | Work | Why it is safe | Verification |
| --- | --- | --- | --- |
| **A** ✅ **done** | 2.2 undo/redo + day review, 2.3 backfill guard | additive migration; no existing table altered destructively; no new dependency | `db:test` 8 / 84, `npm test` 62, build |
| **B** *(next)* | 2.4 focus sessions, 2.5 mission ordering | new table + RPCs; ordering only touches `position`, which is already granted and already ordered by | new assertions for one-open-session, idempotent end, order round-trip |
| **C** | 2.12 analytics foundation, 2.2 action history | read-only views/RPCs next to `day_summary`; no schema churn | assertions that each trend equals the sum of its rows |
| **D** | 2.7 journal + weekly review, 2.10 scripture/prayer as journal kinds | one new table, RLS, no XP path | assertions for privacy and "review cites ledger totals" |
| **E** | 2.8 career/learning, 2.9 knowledge library | new tables that link to existing quests; no new XP source | assertions for ownership + link integrity |
| **F** 🔒 | 2.6 finance, 2.11 AI advisor | finance needs the owner's real data to be useful; the advisor needs a key | finance: balance-view assertions; advisor: no-write assertion |
| **G** 🔒 | 2.1 remote integration + production smoke test | **only** step that touches the live project and cannot be undone by a `git checkout` | Part 4 checklist, run against the project |

**Why remote integration is last, not first.** It has the highest *impact* but the lowest
*safety*: it is the only step that writes to the live database, it needs credentials this
session does not have, and it cannot be re-run blindly. Every extra migration also increases
what has to be applied in one go — so the honest sequence is: finish the schema the product
needs **or** apply the current, already-asserted 8 migrations deliberately and then keep
shipping additively. Both are safe; the unsafe version is pushing migrations while nobody is
watching the production data. Part 4 makes either choice verifiable.

---

## Part 4 — Production verification checklist (owner-run, once)

The repository cannot prove the remote state. This is the smallest checklist that does.

**Before**

1. `supabase link --project-ref <ref>` (already linked per `supabase/.temp/`).
2. `supabase db push --dry-run` — inspect that exactly the 8 migrations in
   `supabase/migrations/` will be applied, in timestamp order.
3. Back up: `pg_dump "$DATABASE_URL" > levi-backup-<date>.sql` (schema + data).
4. Confirm the two public env vars are set in the deployment
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`).

**Apply**

5. `supabase db push` (or paste the files in the SQL editor in the same order).

**Smoke test on the deployed app (each line is one real action)**

6. Magic link sign-in lands on `/dashboard` with level 1 and 0 XP.
7. `/missions` — create a mission, Start, Complete → `+50 XP`; Reopen → XP removed; Complete
   again → exactly `+50 XP` (not 100).
8. `/missions` — skip a mission with a reason, then **Undo** it back to `planned`.
9. `/habits` — create a habit, Log today (+20), Undo today (−20), Log today again (+20).
10. `/habits` — "Backfill another day" for yesterday → the log lands on yesterday; choosing a
    date in the future is refused by the database.
11. `/review` — today and yesterday both render; a future `?date=` clamps to today; the XP
    line matches the ledger entries you just created.
12. `/quests` — complete a step (evidence required), then a whole subquest → `+250 XP`.
13. `/settings` — change the time zone; an invalid zone is rejected.
14. Sign out → `/auth/signout` is POST-only and redirects to `/login`.
15. Second account: it must see **none** of the first account's missions, habits, XP or
    `/review` data.

**After**

16. Record the output of steps 6–15 in this file (or `docs/FEATURE_STATUS.md`) with a date.
    Anything not executed stays ⏭ — never marked verified from inspection.

---

## Part 5 — Cross-cutting rules for every new phase

- A new rule that matters ships as a constraint/trigger/RPC **and** an assertion in
  `supabase/tests/10_engine_assertions.sql`.
- New arithmetic lives in a pure module with unit tests, never inline in a component, and is
  mirrored in SQL where the database is the authority.
- A page either shows real records or an explicit empty state — never sample data.
- Destructive operations stay blocked wherever XP or history would be lost; corrections are
  appended, not rewritten.
- No new dependency is added for something the platform and the existing CSS can already do.
