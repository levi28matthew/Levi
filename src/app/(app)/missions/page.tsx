import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { MissionCard } from "@/components/MissionCard";
import { ConfigurationNotice, EmptyState, Field, PageHeader, Panel, SignedOutState } from "@/components/ui";
import { addDays, isValidDateString } from "@/lib/dates";
import {
  countByStatus,
  getBlockedMissions,
  getMissionsForDate,
  getOverdueMissions,
  getQuestOverview,
  getSessionContext,
  isSupabaseConfigured,
} from "@/lib/queries";
import { createMission } from "./actions";

export const metadata: Metadata = { title: "Missions · LEVI OS" };

/**
 * The daily loop, one calendar date at a time.
 *
 * The date lives in the URL (`?date=YYYY-MM-DD`) so a plan can be reviewed without
 * any client state, and every "today" is the user's own local date — never the
 * server's UTC date.
 */
export default async function MissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  if (!isSupabaseConfigured()) return <ConfigurationNotice />;
  const session = await getSessionContext();
  if (!session) return <SignedOutState module="Daily missions" />;
  const { supabase, today } = session;

  const params = await searchParams;
  const requested = typeof params.date === "string" ? params.date : undefined;
  const date = requested && isValidDateString(requested) ? requested : today;
  const isToday = date === today;

  const [missions, overdue, blocked, quests] = await Promise.all([
    getMissionsForDate(supabase, date),
    isToday ? getOverdueMissions(supabase, today) : Promise.resolve([]),
    getBlockedMissions(supabase),
    getQuestOverview(supabase),
  ]);

  const counts = countByStatus(missions);
  // The plan is shown in the order the user saved, never in a computed one:
  // priority is a label, the order is theirs. `getMissionsForDate` already sorts by
  // (position, created_at), so this filter keeps the stored order intact.
  const open = missions.filter((mission) => mission.status === "planned" || mission.status === "active");
  const resolved = missions.filter((mission) => mission.status === "skipped" || mission.status === "blocked");
  const done = missions.filter((mission) => mission.status === "completed");
  const questTitles = new Map(quests.map((quest) => [quest.id, quest.title]));
  const xpPotential = open.length * 50;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHeader
        eyebrow="Daily missions"
        title={isToday ? "Today's execution" : `Plan for ${date}`}
        description="One mission is one concrete outcome. Completing one records 50 XP in the append-only ledger; skipping or blocking one records why instead."
        actions={
          <>
            <Link className="button secondary" href={{ pathname: "/missions", query: { date: addDays(date, -1) } }}>
              ← Previous day
            </Link>
            {!isToday ? (
              <Link className="button secondary" href="/missions">
                Today
              </Link>
            ) : null}
            <Link className="button secondary" href={{ pathname: "/missions", query: { date: addDays(date, 1) } }}>
              Next day →
            </Link>
          </>
        }
      />

      <Panel>
        <div className="row-between" style={{ alignItems: "flex-end" }}>
          <div className="stack-sm">
            <p className="eyebrow">Plan a different day</p>
            <p className="muted">Pick any calendar date to plan ahead or review what happened.</p>
          </div>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <form method="get" className="row" style={{ alignItems: "flex-end" }}>
              <div className="field">
                <label htmlFor="mission-date">Date</label>
                <input id="mission-date" type="date" name="date" defaultValue={date} required />
              </div>
              <button className="button secondary" type="submit">
                View day
              </button>
            </form>
            <Link className="button secondary" href={{ pathname: "/review", query: { date } }}>
              Review this day
            </Link>
          </div>
        </div>
      </Panel>

      <div className="grid">
        <Panel>
          <p className="stat-label">Open</p>
          <p className="stat-value">{open.length}</p>
          <p className="faint">{xpPotential > 0 ? `${xpPotential} XP available if all are completed` : "Nothing open"}</p>
        </Panel>
        <Panel>
          <p className="stat-label">Completed</p>
          <p className="stat-value">{counts.completed}</p>
          <p className="faint">{counts.completed * 50} XP earned on this day</p>
        </Panel>
        <Panel>
          <p className="stat-label">Resolved honestly</p>
          <p className="stat-value">
            {counts.skipped + counts.blocked}
            <small> / {missions.length}</small>
          </p>
          <p className="faint">
            {counts.skipped} skipped · {counts.blocked} blocked
          </p>
        </Panel>
      </div>

      <Panel>
        <div className="stack-sm">
          <p className="eyebrow">Add</p>
          <h2>New mission for {date}</h2>
          <ActionForm action={createMission} submitLabel="Add mission" hidden={{ missionDate: date }}>
            <Field label="Title" htmlFor="new-mission-title" hint="The outcome, not the activity: “Send the invoice”, not “Do admin”.">
              <input id="new-mission-title" name="title" required maxLength={200} placeholder="e.g. Finish the LeetCode blind-75 set" />
            </Field>
            <div className="field-row">
              <Field label="Priority" htmlFor="new-mission-priority">
                <select id="new-mission-priority" name="priority" defaultValue="normal">
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
              </Field>
              <Field label="Estimate (minutes)" htmlFor="new-mission-estimate" hint="Optional. A rough number forces honesty about the day.">
                <input id="new-mission-estimate" name="estimateMinutes" inputMode="numeric" placeholder="45" />
              </Field>
            </div>
            <Field label="Done when" htmlFor="new-mission-criteria" hint="The observable result that means this is finished.">
              <input id="new-mission-criteria" name="successCriteria" maxLength={500} placeholder="e.g. all 75 problems submitted and reviewed" />
            </Field>
            {quests.length > 0 ? (
              <Field label="Link to a quest" htmlFor="new-mission-quest" hint="Optional. Linking keeps daily work tied to a real outcome.">
                <select id="new-mission-quest" name="questId" defaultValue="">
                  <option value="">Not linked to a quest</option>
                  {quests.map((quest) => (
                    <option key={quest.id} value={quest.id}>
                      {quest.kind === "main" ? "★ " : "↳ "}
                      {quest.title}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="Notes" htmlFor="new-mission-notes">
              <textarea id="new-mission-notes" name="notes" maxLength={4000} placeholder="Anything worth remembering when this is picked up again." />
            </Field>
          </ActionForm>
        </div>
      </Panel>

      <Panel>
        <div className="stack-sm">
          <p className="eyebrow">In play</p>
          <h2>Open missions</h2>
          <p className="muted">
            Ordered by you, not by priority: ↑ and ↓ move a mission one place and the order is saved in the
            database, so it is the same after a refresh or on another device. Resolved missions keep their
            place in the record underneath.
          </p>
          {open.length === 0 ? (
            <EmptyState title="Nothing open for this day" description="Add a mission above, or pick another date if this day is already finished." />
          ) : (
            <div className="items">
              {open.map((mission, index) => (
                <MissionCard
                  key={mission.id}
                  mission={mission}
                  today={today}
                  questTitle={mission.quest_id ? questTitles.get(mission.quest_id) ?? null : null}
                  canMoveUp={index > 0}
                  canMoveDown={index < open.length - 1}
                />
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel>
        <div className="stack-sm">
          <p className="eyebrow">Record</p>
          <h2>Completed, skipped and blocked</h2>
          {done.length === 0 && resolved.length === 0 ? (
            <p className="muted">Nothing has been resolved for this day yet.</p>
          ) : (
            <div className="items">
              {[...done, ...resolved].map((mission) => (
                <MissionCard
                  key={mission.id}
                  mission={mission}
                  today={today}
                  questTitle={mission.quest_id ? questTitles.get(mission.quest_id) ?? null : null}
                />
              ))}
            </div>
          )}
        </div>
      </Panel>

      {isToday && overdue.length > 0 ? (
        <Panel>
          <div className="stack-sm">
            <p className="eyebrow">Carried over</p>
            <h2>Unresolved from earlier days</h2>
            <p className="muted">
              Complete it, or record honestly why it was skipped or blocked. Leaving it open is the default that
              hides the truth.
            </p>
            <div className="items">
              {overdue.map((mission) => (
                <MissionCard
                  key={mission.id}
                  mission={mission}
                  today={today}
                  questTitle={mission.quest_id ? questTitles.get(mission.quest_id) ?? null : null}
                  showDate
                />
              ))}
            </div>
          </div>
        </Panel>
      ) : null}

      {blocked.length > 0 ? (
        <Panel>
          <div className="stack-sm">
            <p className="eyebrow">Blockers</p>
            <h2>Everything currently blocked</h2>
            <p className="muted">
              A blockage is a real record. Reopen a mission once its blocker is cleared — reopening removes the
              XP it had awarded rather than duplicating it.
            </p>
            <div className="items">
              {blocked.map((mission) => (
                <MissionCard
                  key={mission.id}
                  mission={mission}
                  today={today}
                  questTitle={mission.quest_id ? questTitles.get(mission.quest_id) ?? null : null}
                  showDate
                />
              ))}
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
