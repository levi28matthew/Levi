import type { Metadata } from "next";
import { Badge, ConfigurationNotice, EmptyState, Field, PageHeader, Panel, ProgressBar, SignedOutState } from "@/components/ui";
import { getQuestOverview, getQuestSteps, getSessionContext, isSupabaseConfigured } from "@/lib/queries";
import { completeQuestStep, createQuest, createQuestStep, deleteQuest, updateQuest } from "./actions";

export const metadata: Metadata = { title: "Quests · LEVI OS" };

/**
 * Quests are the long arc: a main quest is an outcome, a subquest is a milestone and a
 * step is a verifiable action. Progress is derived from evidenced steps in the database
 * — it can be read but never typed in, exactly like XP.
 */
export default async function QuestsPage() {
  if (!isSupabaseConfigured()) return <ConfigurationNotice />;
  const session = await getSessionContext();
  if (!session) return <SignedOutState module="Quest engine" />;
  const { supabase } = session;

  const [quests, steps] = await Promise.all([getQuestOverview(supabase), getQuestSteps(supabase)]);
  const mainQuests = quests.filter((quest) => quest.kind === "main");
  const stepsByQuest = new Map<string, typeof steps>();
  for (const step of steps) {
    const list = stepsByQuest.get(step.quest_id) ?? [];
    list.push(step);
    stepsByQuest.set(step.quest_id, list);
  }

  const totalSteps = steps.length;
  const doneSteps = steps.filter((step) => step.completed_at !== null).length;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHeader
        eyebrow="Quest engine"
        title="Make progress provable"
        description="A completed step requires evidence, and 250 XP is awarded only when every step of a subquest is done. Progress is derived from those records — it cannot be edited directly."
      />

      <div className="grid">
        <Panel>
          <p className="stat-label">Main quests</p>
          <p className="stat-value">{mainQuests.length}</p>
          <p className="faint">{mainQuests.filter((quest) => quest.status === "done").length} finished end to end</p>
        </Panel>
        <Panel>
          <p className="stat-label">Subquests</p>
          <p className="stat-value">{quests.filter((quest) => quest.kind === "subquest").length}</p>
          <p className="faint">{quests.filter((quest) => quest.kind === "subquest" && quest.status === "done").length} closed with evidence</p>
        </Panel>
        <Panel>
          <p className="stat-label">Steps evidenced</p>
          <p className="stat-value">
            {doneSteps}
            <small> / {totalSteps}</small>
          </p>
          <p className="faint">{totalSteps === 0 ? "No steps yet" : "Each completed step proves a subquest"}</p>
        </Panel>
      </div>

      <Panel>
        <div className="stack-sm">
          <p className="eyebrow">Add</p>
          <h2>New main quest</h2>
          <p className="muted">Start with a real outcome, not a vague category.</p>
          <form action={createQuest} className="row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="kind" value="main" />
            <div className="field" style={{ flex: "1 1 260px" }}>
              <label htmlFor="main-quest-title">Outcome</label>
              <input id="main-quest-title" name="title" required maxLength={160} placeholder="e.g. Become job ready" />
            </div>
            <div className="field">
              <label htmlFor="main-quest-due">Target date</label>
              <input id="main-quest-due" name="dueDate" type="date" />
            </div>
            <button className="button" type="submit">
              Create main quest
            </button>
          </form>
        </div>
      </Panel>

      {mainQuests.length === 0 ? (
        <Panel>
          <EmptyState
            title="No quests yet"
            description="A main quest is a months-long outcome. Create one above, then break it into subquests, and break those into steps you can evidence."
          />
        </Panel>
      ) : (
        mainQuests.map((mainQuest) => {
          const subquests = quests.filter((quest) => quest.parent_quest_id === mainQuest.id);
          return (
            <Panel key={mainQuest.id}>
              <div className="stack" style={{ gap: 14 }}>
                <QuestHeader quest={mainQuest} highlight />

                <form action={createQuest} className="row" style={{ alignItems: "flex-end" }}>
                  <input type="hidden" name="kind" value="subquest" />
                  <input type="hidden" name="parentQuestId" value={mainQuest.id} />
                  <div className="field" style={{ flex: "1 1 240px" }}>
                    <label htmlFor={`subquest-${mainQuest.id}`}>Add a concrete subquest</label>
                    <input id={`subquest-${mainQuest.id}`} name="title" required maxLength={160} placeholder="e.g. Pass 20 interviews" />
                  </div>
                  <button className="button secondary" type="submit">
                    Add subquest
                  </button>
                </form>

                {subquests.length === 0 ? (
                  <p className="muted">No subquests yet. Split this outcome into the 2–4 milestones that would prove it.</p>
                ) : (
                  <div className="items">
                    {subquests.map((subquest) => {
                      const subquestSteps = stepsByQuest.get(subquest.id) ?? [];
                      const completed = subquestSteps.filter((step) => step.completed_at !== null).length;
                      return (
                        <article className="item" key={subquest.id} style={{ gap: 12 }}>
                          <QuestHeader quest={subquest} />
                          <p className="faint">
                            {completed} of {subquestSteps.length} steps evidenced
                            {subquestSteps.length > 0 && completed === subquestSteps.length
                              ? " · subquest complete (+250 XP)"
                              : ""}
                          </p>

                          {subquestSteps.map((step) => (
                            <div key={step.id} className="stack-sm" style={{ borderTop: "1px solid var(--edge)", paddingTop: 10 }}>
                              <div className="row" style={{ gap: 8 }}>
                                <span className="item-title">{step.title}</span>
                                {step.completed_at ? <Badge tone="completed">evidenced</Badge> : <Badge>open</Badge>}
                              </div>
                              {step.completed_at ? (
                                <p className="muted">
                                  Completed with {step.evidence_type} evidence: {step.evidence_value}
                                </p>
                              ) : (
                                <details className="utility">
                                  <summary>Complete with evidence</summary>
                                  <form action={completeQuestStep} className="stack-sm" style={{ marginTop: 8 }}>
                                    <input type="hidden" name="stepId" value={step.id} />
                                    <Field label="Evidence type" htmlFor={`evidence-type-${step.id}`}>
                                      <select id={`evidence-type-${step.id}`} name="evidenceType" defaultValue="note">
                                        <option value="note">Note</option>
                                        <option value="url">URL</option>
                                        <option value="file">File reference</option>
                                        <option value="metric">Metric</option>
                                      </select>
                                    </Field>
                                    <Field label="What proves this step is complete?" htmlFor={`evidence-value-${step.id}`}>
                                      <textarea
                                        id={`evidence-value-${step.id}`}
                                        name="evidenceValue"
                                        required
                                        maxLength={4000}
                                        placeholder="A link, a number, or a short note that would convince a sceptic."
                                      />
                                    </Field>
                                    <button className="button tiny" type="submit" style={{ justifySelf: "start" }}>
                                      Record completion
                                    </button>
                                  </form>
                                </details>
                              )}
                            </div>
                          ))}

                          <form action={createQuestStep} className="row" style={{ alignItems: "flex-end" }}>
                            <input type="hidden" name="questId" value={subquest.id} />
                            <div className="field" style={{ flex: "1 1 240px" }}>
                              <label htmlFor={`step-${subquest.id}`}>Add the next verifiable step</label>
                              <input id={`step-${subquest.id}`} name="title" required maxLength={240} placeholder="e.g. Solve 5 medium problems under time" />
                            </div>
                            <button className="button secondary tiny" type="submit">
                              Add step
                            </button>
                          </form>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </Panel>
          );
        })
      )}
    </div>
  );
}

function QuestHeader({
  quest,
  highlight = false,
}: {
  quest: { id: string; title: string; due_date: string | null; progress_percent: number; status: string; kind: string };
  highlight?: boolean;
}) {
  return (
    <div className="stack-sm">
      <div className="row-between" style={{ alignItems: "flex-start" }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="item-title" style={highlight ? { fontSize: "1.05rem" } : undefined}>
            {quest.title}
          </span>
          <Badge tone={quest.status === "done" ? "completed" : quest.status === "in_progress" ? "active" : undefined}>
            {quest.status.replace("_", " ")}
          </Badge>
          {quest.due_date ? <Badge>due {quest.due_date}</Badge> : null}
        </div>
        <details className="utility">
          <summary>Edit</summary>
          <div className="stack" style={{ marginTop: 8, minWidth: 240 }}>
            <form action={updateQuest} className="stack-sm">
              <input type="hidden" name="id" value={quest.id} />
              <Field label="Title" htmlFor={`quest-title-${quest.id}`}>
                <input id={`quest-title-${quest.id}`} name="title" required defaultValue={quest.title} maxLength={160} />
              </Field>
              <Field label="Target date" htmlFor={`quest-due-${quest.id}`}>
                <input id={`quest-due-${quest.id}`} name="dueDate" type="date" defaultValue={quest.due_date ?? ""} />
              </Field>
              <button className="button secondary tiny" type="submit" style={{ justifySelf: "start" }}>
                Save
              </button>
            </form>
            <form action={deleteQuest}>
              <input type="hidden" name="id" value={quest.id} />
              <button className="button danger tiny" type="submit">
                Delete quest
              </button>
            </form>
            <p className="faint">Deleting a quest also removes the steps planned under it. Evidence already recorded in the XP ledger stays on the record.</p>
          </div>
        </details>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <ProgressBar
            value={quest.progress_percent}
            label={`${quest.title} progress`}
            tone={quest.status === "done" ? "success" : undefined}
          />
        </div>
        <span className="faint numeric">{quest.progress_percent}%</span>
      </div>
    </div>
  );
}
