import type { Metadata } from "next";
import { ActionForm } from "@/components/ActionForm";
import { HabitCard } from "@/components/HabitCard";
import { ConfigurationNotice, EmptyState, Field, PageHeader, Panel, SignedOutState } from "@/components/ui";
import { addDays } from "@/lib/dates";
import { consistency, isScheduledOn, scheduleFromWeekdays, type HabitLogRecord } from "@/lib/habits";
import {
  getArchivedHabits,
  getHabitLogsBetween,
  getHabitSummaries,
  getSessionContext,
  isSupabaseConfigured,
} from "@/lib/queries";
import { createHabit, setHabitArchived } from "./actions";

export const metadata: Metadata = { title: "Habits · LEVI OS" };

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Habits are judged against the days they are actually expected.
 *
 * Streaks and totals come from `habit_summary` in the database (so they can never
 * drift from the logs), while the 30-day consistency figure is computed by the shared
 * `src/lib/habits.ts` engine — the same rules, verified by tests on both sides.
 */
export default async function HabitsPage() {
  if (!isSupabaseConfigured()) return <ConfigurationNotice />;
  const session = await getSessionContext();
  if (!session) return <SignedOutState module="Habits" />;
  const { supabase, today } = session;

  const windowStart = addDays(today, -29);
  const [summaries, logs, archived] = await Promise.all([
    getHabitSummaries(supabase, today),
    getHabitLogsBetween(supabase, windowStart, today),
    getArchivedHabits(supabase),
  ]);

  const logsByHabit = new Map<string, HabitLogRecord[]>();
  for (const log of logs) {
    const records = logsByHabit.get(log.habit_id) ?? [];
    records.push({ date: log.log_date, completed: log.completed });
    logsByHabit.set(log.habit_id, records);
  }

  const dueToday = summaries.filter((habit) => isScheduledOn(scheduleFromWeekdays(habit.schedule_weekdays), today));
  const loggedToday = summaries.filter((habit) =>
    (logsByHabit.get(habit.habit_id) ?? []).some((log) => log.date === today && log.completed),
  );

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHeader
        eyebrow="Habits"
        title="Repeatable behaviour, measured truthfully"
        description={`Streaks and consistency are computed from your saved logs for ${today}. A day a habit was not expected never counts as a miss, and logging a day records 20 XP.`}
      />

      <div className="grid">
        <Panel>
          <p className="stat-label">Tracked habits</p>
          <p className="stat-value">{summaries.length}</p>
          <p className="faint">{archived.length} archived</p>
        </Panel>
        <Panel>
          <p className="stat-label">Due today</p>
          <p className="stat-value">
            {loggedToday.filter((habit) => dueToday.includes(habit)).length}
            <small> / {dueToday.length}</small>
          </p>
          <p className="faint">Habits expected on this weekday</p>
        </Panel>
        <Panel>
          <p className="stat-label">Best current streak</p>
          <p className="stat-value">{summaries.reduce((best, habit) => Math.max(best, habit.current_streak), 0)}</p>
          <p className="faint">Longest active run of scheduled days</p>
        </Panel>
      </div>

      <Panel>
        <div className="stack-sm">
          <p className="eyebrow">Add</p>
          <h2>New habit</h2>
          <ActionForm action={createHabit} submitLabel="Create habit">
            <div className="field-row">
              <Field label="Name" htmlFor="new-habit-name">
                <input id="new-habit-name" name="name" required maxLength={120} placeholder="e.g. Deep work before email" />
              </Field>
              <Field label="Category" htmlFor="new-habit-category" hint="Optional, for grouping on the card.">
                <input id="new-habit-category" name="category" maxLength={60} placeholder="fitness, faith, learning…" />
              </Field>
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="faint" style={{ padding: 0 }}>
                Expected days (leave all unchecked for every day)
              </legend>
              <div className="check-chips" style={{ marginTop: 6 }}>
                {WEEKDAY_LABELS.map((label, index) => (
                  <label className="check-chip" key={label}>
                    <input type="checkbox" name="weekdays" value={index + 1} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </ActionForm>
        </div>
      </Panel>

      <Panel>
        <div className="stack-sm">
          <p className="eyebrow">Today</p>
          <h2>Your habits</h2>
          {summaries.length === 0 ? (
            <EmptyState
              title="No habits tracked yet"
              description="Start with one small, repeatable action. Streaks, consistency and XP all follow automatically from logging it honestly."
            />
          ) : (
            <div className="items">
              {summaries.map((habit) => {
                const records = logsByHabit.get(habit.habit_id) ?? [];
                const schedule = scheduleFromWeekdays(habit.schedule_weekdays);
                const report = consistency(records, schedule, windowStart, today);
                return (
                  <HabitCard
                    key={habit.habit_id}
                    habit={habit}
                    today={today}
                    completedToday={records.some((log) => log.date === today && log.completed)}
                    consistencyPercent={report.consistencyPercent}
                    completedThisWindow={records.filter((log) => log.completed).length}
                  />
                );
              })}
            </div>
          )}
        </div>
      </Panel>

      {archived.length > 0 ? (
        <Panel>
          <details className="utility">
            <summary>Archived habits ({archived.length})</summary>
            <div className="stack" style={{ marginTop: 10 }}>
              <p className="muted">
                Archiving hides a habit from today&apos;s list but keeps every log and every point of XP it earned.
                Restoring it brings the full history straight back.
              </p>
              <div className="items">
                {archived.map((habit) => (
                  <article className="item" key={habit.id}>
                    <div className="row-between">
                      <span className="item-title">{habit.name}</span>
                      <ActionForm
                        action={setHabitArchived}
                        submitLabel="Restore"
                        submitClassName="button secondary tiny"
                        hidden={{ habitId: habit.id, archived: "false" }}
                      >
                        <span className="faint">Archived {habit.archived_at?.slice(0, 10)}</span>
                      </ActionForm>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </details>
        </Panel>
      ) : null}
    </div>
  );
}
