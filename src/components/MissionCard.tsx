import { ActionButton, ActionForm } from "@/components/ActionForm";
import { Badge } from "@/components/ui";
import { deleteMission, moveMission, reopenMission, setMissionStatus, updateMissionPlan } from "@/app/(app)/missions/actions";
import type { MissionRow } from "@/lib/queries";

function formatMinutes(minutes: number | null): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * One mission with every action that is legal for its current state.
 *
 * The state machine is explicit: a planned mission can be started; a skipped or
 * blocked one can be *undone* back to the plan (which retracts the reason, because the
 * mission was not really skipped); a completed one can be reopened, which withdraws
 * its XP instead of duplicating it. Nothing is silently dropped.
 *
 * When `canMoveUp`/`canMoveDown` are provided, the card also carries the two order
 * controls. They only exist for open missions on the day's plan: the server decides
 * what a move means, the client only says which way.
 */
export function MissionCard({
  mission,
  today,
  questTitle,
  showDate = false,
  canMoveUp,
  canMoveDown,
}: {
  mission: MissionRow;
  today: string;
  questTitle?: string | null;
  showDate?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const estimate = formatMinutes(mission.estimate_minutes);
  const overdue = mission.mission_date < today && (mission.status === "planned" || mission.status === "active");
  const reorderable = canMoveUp !== undefined || canMoveDown !== undefined;

  return (
    <article className="item">
      <div className="row-between" style={{ alignItems: "flex-start" }}>
        <div className="stack-sm" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="item-title">{mission.title}</span>
            <Badge tone={mission.status}>{mission.status}</Badge>
            <Badge tone={mission.priority}>{mission.priority}</Badge>
            {overdue ? <Badge tone="blocked">overdue · {mission.mission_date}</Badge> : null}
            {showDate && !overdue ? <Badge>{mission.mission_date}</Badge> : null}
          </div>
          <p className="faint">
            {[
              estimate ? `est. ${estimate}` : null,
              questTitle ? `quest: ${questTitle}` : null,
              mission.success_criteria ? `done when: ${mission.success_criteria}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "No estimate or success criteria recorded."}
          </p>
          {mission.outcome ? <p className="muted">Outcome: {mission.outcome}</p> : null}
          {mission.notes ? <p className="muted">{mission.notes}</p> : null}
        </div>
      </div>

      <div className="item-actions">
        {reorderable ? (
          <span className="row" style={{ gap: 4 }} title="Your saved order for this day">
            <ActionButton
              action={moveMission}
              label="↑"
              fields={{ missionId: mission.id, missionDate: mission.mission_date, direction: "up" }}
              variant="ghost"
              disabled={!canMoveUp}
              ariaLabel={`Move “${mission.title}” earlier in the day`}
              title="Move earlier in the day"
              pendingLabel="…"
            />
            <ActionButton
              action={moveMission}
              label="↓"
              fields={{ missionId: mission.id, missionDate: mission.mission_date, direction: "down" }}
              variant="ghost"
              disabled={!canMoveDown}
              ariaLabel={`Move “${mission.title}” later in the day`}
              title="Move later in the day"
              pendingLabel="…"
            />
          </span>
        ) : null}
        {mission.status === "planned" ? (
          <ActionButton action={setMissionStatus} label="Start" fields={{ missionId: mission.id, status: "active" }} />
        ) : null}
        {mission.status !== "completed" && mission.status !== "skipped" ? (
          <ActionButton
            action={setMissionStatus}
            label="Complete"
            fields={{ missionId: mission.id, status: "completed", outcome: mission.outcome ?? "" }}
          />
        ) : null}
        {mission.status === "completed" ? (
          <ActionButton
            action={reopenMission}
            label="Reopen"
            fields={{ missionId: mission.id }}
            variant="ghost"
            pendingLabel="Reopening…"
          />
        ) : null}
        {mission.status === "skipped" || mission.status === "blocked" ? (
          <ActionButton
            action={setMissionStatus}
            label="Undo"
            fields={{ missionId: mission.id, status: "planned" }}
            variant="ghost"
            pendingLabel="Undoing…"
          />
        ) : null}
      </div>

      <details className="utility">
        <summary>Record a different outcome, edit the plan, or delete</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          <div className="field-row">
            <ActionForm
              action={setMissionStatus}
              submitLabel="Mark skipped"
              submitClassName="button secondary tiny"
              hidden={{ missionId: mission.id, status: "skipped" }}
              resetOnSuccess={false}
            >
              <div className="field">
                <label htmlFor={`skip-${mission.id}`}>Why was this skipped?</label>
                <input
                  id={`skip-${mission.id}`}
                  name="outcome"
                  required
                  maxLength={2000}
                  placeholder="e.g. lost the day to an interview"
                />
              </div>
            </ActionForm>
            <ActionForm
              action={setMissionStatus}
              submitLabel="Mark blocked"
              submitClassName="button secondary tiny"
              hidden={{ missionId: mission.id, status: "blocked" }}
              resetOnSuccess={false}
            >
              <div className="field">
                <label htmlFor={`block-${mission.id}`}>What is blocking this?</label>
                <input
                  id={`block-${mission.id}`}
                  name="outcome"
                  required
                  maxLength={2000}
                  placeholder="e.g. waiting on the recruiter"
                />
              </div>
            </ActionForm>
          </div>

          <ActionForm
            action={updateMissionPlan}
            submitLabel="Save plan"
            submitClassName="button secondary tiny"
            hidden={{ missionId: mission.id }}
            resetOnSuccess={false}
          >
            <div className="field-row">
              <div className="field">
                <label htmlFor={`title-${mission.id}`}>Title</label>
                <input id={`title-${mission.id}`} name="title" defaultValue={mission.title} required maxLength={200} />
              </div>
              <div className="field">
                <label htmlFor={`date-${mission.id}`}>Date</label>
                <input id={`date-${mission.id}`} name="missionDate" type="date" defaultValue={mission.mission_date} required />
              </div>
              <div className="field">
                <label htmlFor={`priority-${mission.id}`}>Priority</label>
                <select id={`priority-${mission.id}`} name="priority" defaultValue={mission.priority}>
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={`estimate-${mission.id}`}>Estimate (minutes)</label>
                <input
                  id={`estimate-${mission.id}`}
                  name="estimateMinutes"
                  inputMode="numeric"
                  defaultValue={mission.estimate_minutes ?? ""}
                  placeholder="45"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor={`criteria-${mission.id}`}>Done when</label>
              <input
                id={`criteria-${mission.id}`}
                name="successCriteria"
                defaultValue={mission.success_criteria ?? ""}
                maxLength={500}
                placeholder="What observable result means this is finished?"
              />
            </div>
            <div className="field">
              <label htmlFor={`notes-${mission.id}`}>Notes</label>
              <textarea id={`notes-${mission.id}`} name="notes" defaultValue={mission.notes ?? ""} maxLength={4000} />
            </div>
          </ActionForm>

          <div className="row">
            <ActionButton
              action={deleteMission}
              label="Delete permanently"
              fields={{ missionId: mission.id }}
              variant="danger"
              confirm="yes"
            />
            <span className="faint">
              Missions that already awarded XP cannot be deleted; reopen or skip them instead.
            </span>
          </div>
        </div>
      </details>
    </article>
  );
}
