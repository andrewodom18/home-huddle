import type { HouseholdPlan } from "../shared/contracts";
import { SparkIcon } from "./icons";

type PlanBoardProps = {
  plan: HouseholdPlan;
};

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function PlanBoard({ plan }: PlanBoardProps) {
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

      <ol className="plan-timeline">
        {plan.items.map((item) => (
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
        <span>Saved on this device</span>
      </footer>
      <a className="plan-board__continue" href="#conversation">Back to the conversation ↑</a>
    </section>
  );
}
