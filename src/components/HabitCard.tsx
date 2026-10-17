import { ActionButton, ActionForm } from "@/components/ActionForm";
import { Badge, ProgressBar } from "@/components/ui";
import { logHabit, setHabitArchived, updateHabit } from "@/app/(app)/habits/actions";
import type { HabitSummary } from "@/lib/queries";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function scheduleLabel(weekdays: readonly number[] | null): string {
  if (!weekdays || weekdays.length === 0 || weekdays.length === 7) return "Every day";
  return weekdays.map((day) => WEEKDAY_LABELS[day - 1]).join(" · ");
}

function isScheduled(weekdays: readonly number[] | null, date: string): boolean {
  if (!weekdays || weekdays.length === 0) return true;
  const isoDay = new Date(`${date}T12:00:00Z`).getUTCDay();
  return weekdays.includes(isoDay === 0 ? 7 : isoDay);
}

/**
 * One habit with today's toggle, its real streak from the saved logs, and the
 * edit/archive controls. Streaks are never typed in by the user.
 */
export function HabitCard({
  habit,
  today,
  completedToday,
  consistencyPercent,
  completedThisWindow,
}: {
  habit: HabitSummary;
  today: string;
  completedToday: boolean;
  consistencyPercent: number;
  completedThisWindow: number;
}) {
  const scheduledToday = isScheduled(habit.schedule_weekdays, today);

  return (
    <article className="item">
      <div className="row-between" style={{ alignItems: "flex-start" }}>
        <div className="stack-sm" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="item-title">{habit.name}</span>
            {habit.category ? <Badge>{habit.category}</Badge> : null}
            <Badge tone={habit.current_streak > 0 ? "active" : undefined}>
              {habit.current_streak} day streak
            </Badge>
            {habit.longest_streak > habit.current_streak ? (
              <Badge>best {habit.longest_streak}</Badge>
            ) : null}
            {!scheduledToday ? <Badge>not due today</Badge> : null}
            {scheduledToday && !completedToday ? <Badge tone="high">due today</Badge> : null}
          </div>
          <p className="faint">
            {scheduleLabel(habit.schedule_weekdays)} · {completedThisWindow} logged in the last 30 days ·{" "}
            {habit.total_completed} all time
          </p>
        </div>
      </div>

      <div className="stack-sm">
        <div className="row-between">
          <span className="faint">30-day consistency</span>
          <span className="faint numeric">{consistencyPercent}%</span>
        </div>
        <ProgressBar
          value={consistencyPercent}
          label={`${habit.name} consistency over 30 days`}
          tone={consistencyPercent >= 80 ? "success" : consistencyPercent >= 40 ? undefined : "warning"}
        />
      </div>

      <div className="item-actions">
        {completedToday ? (
          <ActionButton
            action={logHabit}
            label="Undo today"
            fields={{ habitId: habit.habit_id, logDate: today, completed: "false" }}
            pendingLabel="Updating…"
          />
        ) : (
          <ActionButton
            action={logHabit}
            label={scheduledToday ? "Log today" : "Log today (extra)"}
            fields={{ habitId: habit.habit_id, logDate: today, completed: "true" }}
            pendingLabel="Logging…"
          />
        )}
      </div>

      <details className="utility">
        <summary>Edit schedule or archive</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          <ActionForm
            action={updateHabit}
            submitLabel="Save habit"
            submitClassName="button secondary tiny"
            hidden={{ habitId: habit.habit_id }}
            resetOnSuccess={false}
          >
            <div className="field-row">
              <div className="field">
                <label htmlFor={`habit-name-${habit.habit_id}`}>Name</label>
                <input id={`habit-name-${habit.habit_id}`} name="name" defaultValue={habit.name} required maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor={`habit-category-${habit.habit_id}`}>Category</label>
                <input
                  id={`habit-category-${habit.habit_id}`}
                  name="category"
                  defaultValue={habit.category ?? ""}
                  maxLength={60}
                  placeholder="fitness, faith, learning…"
                />
              </div>
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="faint" style={{ padding: 0 }}>
                Expected days (leave all unchecked for every day)
              </legend>
              <div className="check-chips" style={{ marginTop: 6 }}>
                {WEEKDAY_LABELS.map((label, index) => (
                  <label className="check-chip" key={label}>
                    <input
                      type="checkbox"
                      name="weekdays"
                      value={index + 1}
                      defaultChecked={(habit.schedule_weekdays ?? []).includes(index + 1)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </ActionForm>

          <ActionForm
            action={setHabitArchived}
            submitLabel="Archive habit"
            submitClassName="button danger tiny"
            hidden={{ habitId: habit.habit_id, archived: "true" }}
          >
            <p className="faint">
              Archiving hides the habit from today&apos;s list but keeps every log and every point of XP it
              earned.
            </p>
          </ActionForm>
        </div>
      </details>
    </article>
  );
}
