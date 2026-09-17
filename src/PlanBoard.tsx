import type { HouseholdPlan } from "../shared/contracts";
import { DayGrid } from "./DayGrid";
import { SparkIcon } from "./icons";

type PlanBoardProps = {
  plan: HouseholdPlan;
  date?: string;
  readOnly?: boolean;
  onCorrectRequirement?: (id: string, label: string) => void;
};

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function timeMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value);
  if (!match) return Number.POSITIVE_INFINITY;
  return (Number(match[1]) % 12) * 60 + Number(match[2]) + (match[3].toUpperCase() === "PM" ? 720 : 0);
}

export function PlanBoard({ plan, date, readOnly = false, onCorrectRequirement }: PlanBoardProps) {
  const orderedItems = [...plan.items].sort((a, b) => timeMinutes(a.startTime) - timeMinutes(b.startTime));
  const displayDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))
    : undefined;
  return (
    <section
      aria-label="Household plan"
      className="plan-board"
    >
      <div className="plan-board__header">
        <div>
          <span className="section-kicker">Shared schedule</span>
          <h3>{plan.title}</h3>
        </div>
        <div className="plan-version">
          <SparkIcon size={15} />
          <span>Plan v{plan.version}</span>
        </div>
      </div>

      <p className="plan-objective">{plan.objective}</p>
      {displayDate && <p className="plan-board__date">{displayDate}</p>}

      <div aria-label="Participants" className="participant-list">
        {plan.participants.map((participant, index) => (
          <span className="participant" key={participant}>
            <span aria-hidden="true" data-index={index % 4}>
              {participant.charAt(0).toUpperCase()}
            </span>
            {participant}
          </span>
        ))}
      </div>

      <DayGrid plan={plan} />
      <ol aria-label="Activities in time order" className="plan-timeline">
        {orderedItems.map((item) => (
          <li key={item.id}>
            <div className="plan-time">
              <strong>{item.startTime}</strong>
              <span>{item.durationMinutes} min</span>
            </div>
            <div className="plan-marker" aria-hidden="true">
              <span />
            </div>
            <div className="plan-task">
              <strong>{item.task}</strong>
              <span>{item.assignee}</span>
            </div>
          </li>
        ))}
      </ol>

      {plan.requirements && (
        <details className="plan-checklist">
          <summary>{plan.requirements.source === "scenario" ? "Verified example checklist" : "Interpreted checklist — review it"}</summary>
          <p>
            {plan.requirements.source === "scenario"
              ? "Checked against the example’s stated requirements."
              : "These are the requirements the planner captured from your words. Anything missing here was not verified. Correct a checklist item or ask for a revision."}
          </p>
          <p>
            Time window: {plan.requirements.timeWindow.startTime}–{plan.requirements.timeWindow.endTime}
            {plan.requirements.source === "interpreted" && onCorrectRequirement && (
              <button className="plan-checklist__correct" onClick={() => onCorrectRequirement("window", "time window")} title="Correct the interpreted time window in chat" type="button">Correct</button>
            )}
          </p>
          <ul>
            {plan.requirements.tasks.map((task) => (
              <li key={task.id}>
                <strong>{task.label}</strong> · {task.durationMinutes} min
                {task.fixedStartTime && ` · fixed at ${task.fixedStartTime}`}
                {task.requiredParticipants?.length ? ` · with ${task.requiredParticipants.join(", ")}` : ""}
                {task.allowedParticipants?.length ? ` · allowed: ${task.allowedParticipants.join(", ")}` : ""}
                {task.forbiddenParticipants?.length ? ` · not assigned: ${task.forbiddenParticipants.join(", ")}` : ""}
                {plan.requirements?.source === "interpreted" && onCorrectRequirement && (
                  <button className="plan-checklist__correct" onClick={() => onCorrectRequirement(task.id, task.label)} title={`Correct the interpreted requirement for ${task.label}`} type="button">Correct</button>
                )}
              </li>
            ))}
          </ul>
          {plan.requirements.gaps?.map((gap) => (
            <p key={`${gap.afterTaskId}-${gap.beforeTaskId}`}>
              At least {gap.minMinutes} min between {gap.afterTaskId} and {gap.beforeTaskId}.
            </p>
          ))}
        </details>
      )}

      {plan.notes.length > 0 && (
        <div className="plan-notes">
          <strong>Good to know</strong>
          <ul>
            {plan.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      <footer className="plan-board__footer">
        <span>Updated {formatUpdatedAt(plan.updatedAt)}</span>
        <span>{readOnly ? "Read-only snapshot" : "Saved on this device"}</span>
      </footer>
      {!readOnly && <a className="plan-board__continue" href="#conversation">Back to the conversation ↑</a>}
    </section>
  );
}
