import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ConfigurationNotice, EmptyState, PageHeader, Panel, ProgressBar, SignedOutState, StatTile } from "@/components/ui";
import { toCalendarDate } from "@/lib/dates";
import { isScheduledOn, scheduleFromWeekdays } from "@/lib/habits";
import {
  countByStatus,
  getAchievements,
  getHabitLogsBetween,
  getHabitSummaries,
  getLevelHistory,
  getMissionsForDate,
  getOverdueMissions,
  getPlayerStats,
  getQuestOverview,
  getSessionContext,
  isSupabaseConfigured,
  type PlayerStats,
} from "@/lib/queries";
import { missionSortKey } from "@/components/MissionCard";
import { formatXp } from "@/lib/utils";

export const metadata: Metadata = { title: "Command Center · LEVI OS" };

const XP_SOURCE_LABELS: Record<string, string> = {
  quest_completion: "Quest completed",
  daily_mission: "Daily mission",
  habit: "Habit logged",
  milestone: "Milestone",
  bonus: "Bonus",
  achievement: "Achievement",
};

const EMPTY_STATS: PlayerStats = {
  user_id: "",
  total_xp: 0,
  level: 1,
  current_level_floor_xp: 0,
  xp_into_level: 0,
  xp_for_next_level: 250,
  xp_to_next_level: 250,
  quests_completed: 0,
  subquests_completed: 0,
  missions_completed: 0,
  missions_skipped: 0,
  missions_blocked: 0,
  habits_logged: 0,
  steps_completed: 0,
};

function percent(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 100);
}

function signedXp(amount: number): string {
  return `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${formatXp(Math.abs(amount))}`;
}

export default async function DashboardPage() {
  if (!isSupabaseConfigured()) return <ConfigurationNotice />;
  const session = await getSessionContext();
  if (!session) return <SignedOutState module="Command center" />;
  const { supabase, today, timeZone, displayName } = session;

  const [statsRow, missions, overdue, habits, todayLogs, quests, history, achievements] = await Promise.all([
    getPlayerStats(supabase),
    getMissionsForDate(supabase, today),
    getOverdueMissions(supabase, today),
    getHabitSummaries(supabase, today),
    getHabitLogsBetween(supabase, today, today),
    getQuestOverview(supabase),
    getLevelHistory(supabase, 6),
    getAchievements(supabase),
  ]);

  const stats = statsRow ?? EMPTY_STATS;
  const counts = countByStatus(missions);
  const resolvedToday = counts.completed + counts.skipped;
  const openMissions = missions
    .filter((mission) => mission.status === "planned" || mission.status === "active")
    .sort((a, b) => missionSortKey(a) - missionSortKey(b));
  const primary = openMissions[0] ?? null;

  const doneToday = new Set(todayLogs.filter((log) => log.completed).map((log) => log.habit_id));
  const habitsDue = habits.filter((habit) => isScheduledOn(scheduleFromWeekdays(habit.schedule_weekdays), today));
  const habitsDone = habitsDue.filter((habit) => doneToday.has(habit.habit_id)).length;

  const activeQuests = quests.filter((quest) => quest.status !== "done");
  const unlocked = achievements.filter((achievement) => achievement.unlockedAt !== null);
  const levelProgressPercent = percent(stats.xp_into_level, stats.xp_for_next_level);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHeader
        eyebrow="Command center"
        title={displayName ? `What matters right now, ${displayName}?` : "What matters right now?"}
        description={`Today is ${today} in ${timeZone}. Every number below is derived from records you saved — nothing is estimated.`}
        actions={
          <>
            <Link className="button secondary" href="/missions">
              Plan today
            </Link>
            <Link className="button secondary" href="/review">
              Review today
            </Link>
            <Link className="button" href="/quests">
              Quests
            </Link>
          </>
        }
      />

      <div className="grid">
        <Panel>
          <StatTile
            label={`Level ${stats.level}`}
            value={
              <>
                {formatXp(stats.total_xp)} <small>XP lifetime</small>
              </>
            }
            progress={levelProgressPercent}
            hint={
              stats.xp_to_next_level > 0
                ? `${formatXp(stats.xp_into_level)} of ${formatXp(stats.xp_for_next_level)} into this level · ${formatXp(
                    stats.xp_to_next_level,
                  )} XP to level ${stats.level + 1}`
                : "Maximum tracked level reached."
            }
          />
        </Panel>

        <Panel>
          <StatTile
            label="Missions today"
            value={
              <>
                {counts.completed}
                <small> / {missions.length} completed</small>
              </>
            }
            progress={percent(counts.completed, missions.length)}
            hint={
              missions.length === 0
                ? "Nothing planned for today yet."
                : `${counts.planned + counts.active} open · ${resolvedToday} resolved · ${counts.blocked} blocked`
            }
          />
        </Panel>

        <Panel>
          <StatTile
            label="Habits due today"
            value={
              <>
                {habitsDone}
                <small> / {habitsDue.length} logged</small>
              </>
            }
            progress={percent(habitsDone, habitsDue.length)}
            hint={
              habits.length === 0
                ? "No habits tracked yet."
                : `${stats.habits_logged} completions all time across ${habits.length} habit(s).`
            }
          />
        </Panel>

        <Panel>
          <StatTile
            label="Quests"
            value={
              <>
                {stats.quests_completed}
                <small> main completed</small>
              </>
            }
            progress={percent(stats.quests_completed, stats.quests_completed + activeQuests.filter((q) => q.kind === "main").length)}
            hint={`${activeQuests.length} active · ${stats.subquests_completed} subquests closed · ${stats.steps_completed} steps with evidence`}
          />
        </Panel>
      </div>

      <div className="grid-wide">
        <div className="stack" style={{ gap: 18 }}>
          <Panel>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <div>
                <p className="eyebrow">Today</p>
                <h2 style={{ marginTop: 4 }}>Today&apos;s missions</h2>
              </div>
              <Link className="button secondary tiny" href="/missions">
                Open missions
              </Link>
            </div>

            {missions.length === 0 ? (
              <EmptyState
                title="Nothing planned for today"
                description="A mission is one concrete outcome. Add it in Missions and it lands on today's list."
                action={
                  <Link className="button tiny" href="/missions">
                    Plan a mission
                  </Link>
                }
              />
            ) : (
              <div className="items">
                {missions.map((mission) => (
                  <article className="item" key={mission.id}>
                    <div className="row-between" style={{ alignItems: "flex-start" }}>
                      <div className="stack-sm" style={{ minWidth: 0 }}>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="item-title">{mission.title}</span>
                          <Badge tone={mission.status}>{mission.status}</Badge>
                          <Badge tone={mission.priority}>{mission.priority}</Badge>
                          {mission.id === primary?.id ? <Badge tone="active">next up</Badge> : null}
                        </div>
                        {mission.success_criteria ? (
                          <p className="faint">done when: {mission.success_criteria}</p>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Panel>

          {overdue.length > 0 ? (
            <Panel>
              <div className="stack-sm">
                <p className="eyebrow">Carried over</p>
                <h2>
                  {overdue.length} unresolved mission{overdue.length === 1 ? "" : "s"} from earlier days
                </h2>
                <p className="muted">
                  These were planned for a previous day and never completed, skipped or blocked. Resolve them
                  honestly — carried work is the fastest way to lose trust in the plan.
                </p>
                <div className="items">
                  {overdue.slice(0, 5).map((mission) => (
                    <article className="item" key={mission.id}>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="item-title">{mission.title}</span>
                        <Badge tone="blocked">{mission.mission_date}</Badge>
                        <Badge tone={mission.priority}>{mission.priority}</Badge>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="row">
                  <Link className="button secondary tiny" href="/missions">
                    Resolve in missions
                  </Link>
                </div>
              </div>
            </Panel>
          ) : null}

          <Panel>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <div>
                <p className="eyebrow">Trajectory</p>
                <h2 style={{ marginTop: 4 }}>Active quests</h2>
              </div>
              <Link className="button secondary tiny" href="/quests">
                Open quests
              </Link>
            </div>
            {activeQuests.length === 0 ? (
              <EmptyState
                title="No quests in play"
                description="Quests are the outcomes worth months of work. Create one, then break it into subquests and evidenced steps."
                action={
                  <Link className="button tiny" href="/quests">
                    Create a quest
                  </Link>
                }
              />
            ) : (
              <div className="stack">
                {activeQuests.map((quest) => (
                  <div className="stack-sm" key={quest.id}>
                    <div className="row-between">
                      <span className="row" style={{ gap: 8 }}>
                        <span className="item-title">{quest.title}</span>
                        <Badge>{quest.kind}</Badge>
                        {quest.due_date ? <Badge>due {quest.due_date}</Badge> : null}
                      </span>
                      <span className="faint numeric">{quest.progress_percent}%</span>
                    </div>
                    <ProgressBar
                      value={quest.progress_percent}
                      label={`${quest.title} progress`}
                      tone={quest.progress_percent >= 100 ? "success" : undefined}
                    />
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="stack" style={{ gap: 18 }}>
          <Panel>
            <div className="stack-sm">
              <p className="eyebrow">Ledger</p>
              <h2>Recent XP</h2>
              {history.length === 0 ? (
                <p className="muted">
                  No XP recorded yet. Completing a mission, logging a habit or closing a quest writes an
                  append-only entry here.
                </p>
              ) : (
                <div className="items">
                  {history.map((event) => (
                    <article className="item" key={event.event_id}>
                      <div className="row-between">
                        <div className="stack-sm">
                          <span className="item-title">
                            {XP_SOURCE_LABELS[event.source] ?? event.source}
                          </span>
                          <span className="faint">
                            {toCalendarDate(event.awarded_at, timeZone)} · level {event.level_after}
                          </span>
                        </div>
                        <span className="badge" title="XP change">
                          {signedXp(event.amount)} XP
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </Panel>

          <Panel>
            <div className="stack-sm">
              <p className="eyebrow">Achievements</p>
              <h2>
                {unlocked.length} of {achievements.length} unlocked
              </h2>
              <ProgressBar
                value={percent(unlocked.length, achievements.length)}
                label="Achievements unlocked"
                tone={unlocked.length === achievements.length ? "success" : undefined}
              />
              <div className="items">
                {achievements.map((achievement) => {
                  const isUnlocked = achievement.unlockedAt !== null;
                  return (
                    <article className="item" key={achievement.id}>
                      <div className="row-between">
                        <div className="stack-sm">
                          <span className="item-title">{achievement.title}</span>
                          <span className="faint">{achievement.description}</span>
                        </div>
                        <Badge tone={isUnlocked ? "completed" : undefined}>
                          {isUnlocked ? "unlocked" : `+${achievement.xp} XP`}
                        </Badge>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
