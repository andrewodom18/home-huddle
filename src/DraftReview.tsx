import { forwardRef } from "react";
import type { HouseholdPlan } from "../shared/contracts";
import { formatPlanDate, planDates } from "./planDate";
import { requirementDescription, requirementSections } from "./requirementDisplay";

type DraftReviewProps = {
  plan: HouseholdPlan;
  sourceMessage: string;
  date: string;
  timeZone: string;
  pending: boolean;
  needsResolution: boolean;
  error?: string;
  onAccept: () => void;
  onCorrect: () => void;
  onKeepDraft: () => void;
  onStartOver: () => void;
};

/** A custom plan is useful only after its interpreted checklist is inspected. */
export const DraftReview = forwardRef<HTMLDivElement, DraftReviewProps>(function DraftReview({
  plan, sourceMessage, date, timeZone, pending, needsResolution, error,
  onAccept, onCorrect, onKeepDraft, onStartOver,
}, ref) {
  const requirements = plan.requirements;
  if (!requirements) return null;
  const dates = planDates(plan, date);
  return (
    <div aria-label="Review draft plan" className="draft-review" ref={ref} role="region" tabIndex={-1}>
      <span className="section-kicker">Before you use this plan</span>
      <h2>Review what Home Huddle understood</h2>
      <p>This is a draft. The schedule was checked against the requirements listed here, not every word of your request. If anything is missing or wrong, correct it before using the plan.</p>
      <div className="draft-review__source">
        <h3>Your request</h3>
        <blockquote>{sourceMessage}</blockquote>
      </div>
      <p className="draft-review__date"><strong>Scheduled dates:</strong> {dates.map(formatPlanDate).join("; ")} · <strong>Time zone:</strong> {timeZone}</p>
      <div className="draft-review__checklist">
        <section>
          <h3>Captured activities</h3>
          <ul>{requirements.tasks.map((task) => <li key={task.id}>{requirementDescription(task, requirements)}</li>)}</ul>
        </section>
        {requirementSections(requirements).filter((section) => section.lines.length > 0).map((section) => (
          <section key={section.id}>
            <h3>{section.label}</h3>
            <ul>{section.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
          </section>
        ))}
      </div>
      {!requirements.assumptions?.length && <p className="draft-review__assumptions">No estimates were labeled as assumptions. Check durations and availability against your request.</p>}
      {needsResolution && <p className="draft-review__warning" role="status">A correction still needs a decision. Resolve it in the conversation, or explicitly return to this earlier draft before using it.</p>}
      {error && <p className="draft-review__warning" role="alert">{error}</p>}
      <div className="draft-review__actions">
        <button disabled={pending || needsResolution} onClick={onAccept} type="button">Use this plan</button>
        <button disabled={pending} onClick={onCorrect} type="button">Add or correct a requirement</button>
        {needsResolution && <button disabled={pending} onClick={onKeepDraft} type="button">Return to previous draft</button>}
        <button disabled={pending} onClick={onStartOver} type="button">Start over</button>
      </div>
      <p className="draft-review__hint">For example: “Add a 20-minute school pickup for Ada at 3 PM.” A correction creates another draft for review.</p>
    </div>
  );
});
