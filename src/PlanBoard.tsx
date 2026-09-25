import { useEffect, useRef, useState } from "react";
import type { HouseholdPlan, ScheduleEdit } from "../shared/contracts";
import { scenarioRequirements } from "../shared/scenarios";
import { DayGrid, type CalendarView } from "./DayGrid";
import { requirementDescription, requirementSections } from "./requirementDisplay";
import { SparkIcon } from "./icons";
import { getAssignmentColor, getParticipantColors, participantColorStyle, SHARED_COLOR } from "./participantColors";
import { isOutdatedExample } from "./planStatus";
import { formatPlanDate, isPastEventStart, isValidPlanDate, todayInZone } from "./planDate";

type PlanBoardProps = {
  plan: HouseholdPlan;
  date?: string;
  timeZone?: string;
  dateError?: string;
  readOnly?: boolean;
  draftPreview?: boolean;
  persistenceUnavailable?: boolean;
  onDateChange?: (date: string) => void;
  dateChangeDisabled?: boolean;
  onCorrectRequirement?: (id: string, label: string) => void;
  onDetailsChange?: (itemId: string, details: string) => void;
  onScheduleChange?: (edit: ScheduleEdit) => void;
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

function formatEndTime(startTime: string, durationMinutes: number): string {
  const start = timeMinutes(startTime);
  if (!Number.isFinite(start)) return "Time unavailable";
  const end = (start + durationMinutes) % (24 * 60);
  const hour = Math.floor(end / 60);
  return `${hour % 12 || 12}:${String(end % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function toTimeInput(value: string): string {
  const valueMinutes = timeMinutes(value);
  if (!Number.isFinite(valueMinutes)) return "";
  return `${String(Math.floor(valueMinutes / 60)).padStart(2, "0")}:${String(valueMinutes % 60).padStart(2, "0")}`;
}

function fromTimeInput(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function inputMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

function endTimeInput(start: string, duration: number): string {
  const startMinutes = inputMinutes(start);
  if (!Number.isFinite(startMinutes) || !Number.isInteger(duration) || duration < 1 || duration > 480 || startMinutes + duration >= 24 * 60) return "";
  const end = startMinutes + duration;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

function selectedPeople(label: string, participants: string[]): string[] {
  if (/^(all|everyone|family|household)$/i.test(label.trim())) return participants;
  const names = label.split(/\s*(?:,|&|\+|\band\b)\s*/i).map((name) => name.toLowerCase());
  return participants.filter((person) => names.includes(person.toLowerCase()));
}

type DatedItem = HouseholdPlan["items"][number] & { date?: string };
type DatedEdit = ScheduleEdit & { date?: string };

function effectiveDate(item: DatedItem, fallback?: string): string {
  return item.date && isValidPlanDate(item.date) ? item.date : fallback && isValidPlanDate(fallback) ? fallback : "";
}

function shortDate(value: string): string {
  return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", weekday: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "Date not set";
}

export function PlanBoard({ plan, date, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", dateError, readOnly = false, draftPreview = false, persistenceUnavailable = false, onDateChange, dateChangeDisabled = false, onCorrectRequirement, onDetailsChange, onScheduleChange }: PlanBoardProps) {
  const viewOnly = readOnly || draftPreview;
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [draftDetails, setDraftDetails] = useState("");
  const [draftStart, setDraftStart] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [draftDuration, setDraftDuration] = useState("");
  const [draftPeople, setDraftPeople] = useState<string[]>([]);
  const [editError, setEditError] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarView, setCalendarView] = useState<CalendarView>(() => window.matchMedia?.("(max-width: 980px)").matches ? "shared" : "people");
  const [compact, setCompact] = useState(() => window.matchMedia?.("(max-width: 980px)").matches ?? false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dayListRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedItem = plan.items.find((item) => item.id === selectedItemId);
  const selectedRequirement = plan.requirements?.tasks.find((task) => task.id === selectedItem?.taskId);
  // An accepted reassignment narrows the displayed checklist to that exact
  // assignee. The editor must still offer everyone allowed by the original
  // example, so the user can change the assignment again or undo it.
  const selectedEligibility = scenarioRequirements(plan.scenarioId, plan.scenarioAnchor)?.tasks.find((task) => task.id === selectedItem?.taskId)
    ?? selectedRequirement;
  const canonicalRequirement = scenarioRequirements(plan.scenarioId, plan.scenarioAnchor)?.tasks.find((task) => task.id === selectedItem?.taskId);
  const fixedCommitment = Boolean(canonicalRequirement?.fixedDate || canonicalRequirement?.fixedStartTime);
  const startedCommitment = selectedItem ? isPastEventStart(effectiveDate(selectedItem, date), selectedItem.startTime, timeZone) : false;
  const canEditDetails = !viewOnly && Boolean(onDetailsChange);
  const canEditSchedule = !viewOnly && !startedCommitment && !fixedCommitment && Boolean(onScheduleChange) && Boolean(selectedItem?.taskId && plan.requirements) && !isOutdatedExample(plan);
  const participantColors = getParticipantColors(plan.participants);
  const dates = [...new Set(plan.items.map((item) => effectiveDate(item, date)))].sort((first, second) => first === "" ? 1 : second === "" ? -1 : first.localeCompare(second));
  const activeDate = selectedDate !== null && dates.includes(selectedDate) ? selectedDate : dates[0] ?? "";
  const dayItems = plan.items.filter((item) => effectiveDate(item, date) === activeDate);
  const activeIndex = dates.indexOf(activeDate);
  const multipleDates = dates.length > 1;

  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 980px)");
    if (!query) return;
    const update = () => setCompact(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const list = dayListRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!list || !active) return;
    const listRect = list.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.left < listRect.left) list.scrollLeft += activeRect.left - listRect.left;
    else if (activeRect.right > listRect.right) list.scrollLeft += activeRect.right - listRect.right;
  }, [activeDate]);

  useEffect(() => {
    if (!selectedItemId) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    closeRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [selectedItemId]);

  function openDetails(itemId: string, trigger: HTMLButtonElement) {
    const item = plan.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    triggerRef.current = trigger;
    setDraftDetails(item.details ?? "");
    setDraftDate(effectiveDate(item, date));
    const start = toTimeInput(item.startTime);
    setDraftStart(start);
    setDraftDuration(String(item.durationMinutes));
    setDraftEnd(endTimeInput(start, item.durationMinutes));
    setDraftPeople(selectedPeople(item.assignee, plan.participants));
    setEditError("");
    setSelectedItemId(itemId);
  }

  function closeDetails() {
    dialogRef.current?.close();
    setSelectedItemId(null);
    triggerRef.current?.focus();
  }

  function saveDetails() {
    if (!selectedItem || !canEditDetails) return;
    if (draftDetails !== (selectedItem.details ?? "")) onDetailsChange?.(selectedItem.id, draftDetails);
    closeDetails();
  }

  function reviewScheduleChange() {
    if (!selectedItem?.taskId || !canEditSchedule || !onScheduleChange) return;
    const startTime = fromTimeInput(draftStart);
    const durationMinutes = Number(draftDuration);
    if (!isValidPlanDate(draftDate)) {
      setEditError("Choose a valid date for this activity.");
      return;
    }
    if (!startTime || !draftEnd || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 480 || endTimeInput(draftStart, durationMinutes) !== draftEnd) {
      setEditError("Choose a valid start and end time on the same day, with a duration of 1–480 minutes.");
      return;
    }
    if (isPastEventStart(draftDate, startTime, timeZone)) {
      setEditError(`You’re trying to schedule “${selectedItem.task}” for ${formatPlanDate(draftDate)} at ${startTime}, which is in the past in ${timeZone}. Choose a future date or time.`);
      return;
    }
    if (draftPeople.length === 0) {
      setEditError("Assign at least one listed person.");
      return;
    }
    if (canonicalRequirement?.fixedDate && draftDate !== effectiveDate(selectedItem, date)) {
      setEditError("This commitment has a fixed date.");
      return;
    }
    if (canonicalRequirement?.fixedStartTime && startTime !== canonicalRequirement.fixedStartTime) {
      setEditError(`This commitment starts at ${canonicalRequirement.fixedStartTime}.`);
      return;
    }
    if (draftPeople.some((person) => selectedEligibility?.allowedParticipants && !selectedEligibility.allowedParticipants.includes(person)
      || selectedEligibility?.forbiddenParticipants?.includes(person))) {
      setEditError("Choose only people allowed for this activity.");
      return;
    }
    const edit: DatedEdit = { taskId: selectedItem.taskId };
    if (draftDate !== effectiveDate(selectedItem, date)) edit.date = draftDate;
    if (startTime !== selectedItem.startTime || durationMinutes !== selectedItem.durationMinutes) edit.startTime = startTime;
    if (durationMinutes !== selectedItem.durationMinutes) edit.durationMinutes = durationMinutes;
    const beforePeople = selectedPeople(selectedItem.assignee, plan.participants);
    if (draftPeople.length !== beforePeople.length || draftPeople.some((person) => !beforePeople.includes(person))) edit.assignees = draftPeople;
    if (!edit.date && !edit.startTime && edit.durationMinutes === undefined && !edit.assignees) {
      setEditError("Change the date, time, or assignment before reviewing.");
      return;
    }
    // Notes are independent of schedule approval. A note entered alongside an
    // edit must survive both a rejected proposal and Keep current.
    if (canEditDetails && draftDetails !== (selectedItem.details ?? "")) onDetailsChange?.(selectedItem.id, draftDetails);
    closeDetails();
    onScheduleChange(edit);
  }

  const orderedItems = [...dayItems].sort((a, b) => timeMinutes(a.startTime) - timeMinutes(b.startTime));
  const outdated = isOutdatedExample(plan);
  const displayDate = date && isValidPlanDate(date) ? formatPlanDate(date) : undefined;
  const dateSummary = multipleDates ? `${shortDate(dates[0])} – ${shortDate(dates[dates.length - 1])}` : activeDate ? formatPlanDate(activeDate) : displayDate;
  return (
    <section
      aria-label="Household plan"
      className="plan-board"
      data-calendar-view={calendarView}
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
      {plan.notes.length > 0 && <div className="plan-notes"><h4>Plan notes — review these</h4><ul>{plan.notes.map((note, index) => <li key={index}>{note}</li>)}</ul><p>Notes are context, not checked schedule constraints.</p></div>}
      {outdated && (
        <p className="outdated-plan" role="status">
          This example was made before the current schedule checks. {readOnly ? "Treat this snapshot as an earlier draft." : "Start a new plan to regenerate it before sharing."}
        </p>
      )}
      {(dateSummary || (!viewOnly && onDateChange && !multipleDates)) && (
        <div className="plan-board__date-row">
          <p className="plan-board__date">{dateSummary ?? "Choose a plan date"}</p>
          {!viewOnly && onDateChange && !multipleDates && (
            <label className="plan-board__date-control">
              <span>Change date</span>
              <input aria-label="Plan date" disabled={dateChangeDisabled} min={todayInZone(timeZone)} onChange={(event) => {
                const nextDate = event.currentTarget.value;
                event.currentTarget.value = activeDate;
                onDateChange(nextDate);
              }} title="Propose a new date for the whole plan" type="date" value={activeDate} />
            </label>
          )}
        </div>
      )}
      {dateError && <p className="plan-board__date-error" role="alert">{dateError}</p>}

      <div aria-label="Participants" className="participant-list">
        {plan.participants.map((participant, index) => (
          <span className="participant" key={participant}>
            <span aria-hidden="true" data-index={index % 4} style={participantColorStyle(participantColors.get(participant) ?? SHARED_COLOR)}>
              {participant.charAt(0).toUpperCase()}
            </span>
            {participant}
          </span>
        ))}
      </div>

      <div aria-label="Calendar view" className="plan-view-switch" role="group">
        <button aria-pressed={calendarView === "people"} onClick={() => setCalendarView("people")} title="Show a separate lane for each person" type="button">By person</button>
        <button aria-pressed={calendarView === "shared"} onClick={() => setCalendarView("shared")} title="Show each activity once on one shared timeline" type="button">Shared</button>
      </div>

      {multipleDates && (
        <nav aria-label="Schedule days" className="plan-days">
          <button aria-label="Previous scheduled day" disabled={activeIndex <= 0} onClick={() => setSelectedDate(dates[activeIndex - 1])} type="button">←</button>
          <div className="plan-days__list" ref={dayListRef}>
            {dates.map((day) => {
              const count = plan.items.filter((item) => effectiveDate(item, date) === day).length;
              return (
                <button aria-pressed={day === activeDate} className={day === activeDate ? "plan-days__day plan-days__day--active" : "plan-days__day"} key={day || "undated"} onClick={() => setSelectedDate(day)} type="button">
                  <span>{shortDate(day)}</span><small>{count} {count === 1 ? "event" : "events"}</small>
                </button>
              );
            })}
          </div>
          <button aria-label="Next scheduled day" disabled={activeIndex >= dates.length - 1} onClick={() => setSelectedDate(dates[activeIndex + 1])} type="button">→</button>
        </nav>
      )}
      {multipleDates && <h4 className="plan-day-heading">{activeDate ? formatPlanDate(activeDate) : "Date not set"}</h4>}
      <DayGrid dayItems={dayItems} onEventClick={openDetails} plan={plan} view={calendarView} />
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
            <button
              aria-label={`Open details for ${item.task}, ${item.startTime}, assigned to ${item.assignee}`}
              className={`plan-task plan-task__button${selectedPeople(item.assignee, plan.participants).length > 1 ? " plan-task__button--shared" : ""}`}
              onClick={(event) => openDetails(item.id, event.currentTarget)}
              style={participantColorStyle(getAssignmentColor(selectedPeople(item.assignee, plan.participants), participantColors))}
              title={`View activity details: ${item.task}, ${item.startTime}, ${item.durationMinutes} minutes`}
              type="button"
            >
              <strong>{item.task}</strong>
              <span>{item.assignee}</span>
              {item.details && <span className="plan-task__note">Has details</span>}
            </button>
          </li>
        ))}
      </ol>

      {compact && calendarView === "people" && <div aria-label="Activities by person" className="plan-people-list" role="group">
        {plan.participants.map((person) => {
          const assigned = orderedItems.filter((item) => selectedPeople(item.assignee, plan.participants).includes(person));
          return (
            <section aria-label={`${person} activities`} className="plan-people-list__person" key={person}>
              <h5>{person}</h5>
              {assigned.length ? <ol>{assigned.map((item) => (
                <li key={item.id}>
                  <button
                    aria-label={`Open details for ${item.task}, ${item.startTime}, assigned to ${item.assignee}`}
                    className="plan-task plan-task__button"
                    onClick={(event) => openDetails(item.id, event.currentTarget)}
                    style={participantColorStyle(getAssignmentColor(selectedPeople(item.assignee, plan.participants), participantColors))}
                    title={`View activity details: ${item.task}, ${item.startTime}, ${item.durationMinutes} minutes`}
                    type="button"
                  >
                    <strong>{item.task}</strong>
                    <span>{item.startTime} · {item.durationMinutes} min · {item.assignee}</span>
                    {item.details && <span className="plan-task__note">Has details</span>}
                  </button>
                </li>
              ))}</ol> : <p>No activities assigned.</p>}
            </section>
          );
        })}
      </div>}

      {selectedItem && (
        <dialog
          aria-labelledby="event-details-title"
          className="event-details"
          onCancel={(event) => { event.preventDefault(); closeDetails(); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeDetails();
            } else if (event.key === "Tab") {
              const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), textarea:not([disabled]), input:not([disabled])"));
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
          ref={dialogRef}
        >
          <div className="event-details__header">
            <div>
              <span className="section-kicker">Activity details</span>
              <h3 id="event-details-title">{selectedItem.task}</h3>
            </div>
            <button aria-label="Close activity details" className="event-details__close" onClick={closeDetails} ref={closeRef} type="button">Close</button>
          </div>
          <dl className="event-details__meta">
            <div><dt>Date</dt><dd>{effectiveDate(selectedItem, date) ? formatPlanDate(effectiveDate(selectedItem, date)) : "Date not set"}</dd></div>
            <div><dt>Time</dt><dd>{selectedItem.startTime}–{formatEndTime(selectedItem.startTime, selectedItem.durationMinutes)}</dd></div>
            <div><dt>Assigned to</dt><dd>{selectedItem.assignee}</dd></div>
          </dl>
          {canEditSchedule && (
            <div className="event-details__edit">
              <h4>Edit schedule</h4>
              <div className="event-details__edit-fields">
                <label>Date
                  <input aria-label="Activity date" min={todayInZone(timeZone)} onChange={(event) => { setDraftDate(event.target.value); setEditError(""); }} type="date" value={draftDate} />
                </label>
                <label>Start time
                  <input aria-label="Activity start time" onChange={(event) => {
                    const value = event.target.value;
                    setDraftStart(value);
                    setDraftEnd(endTimeInput(value, Number(draftDuration)));
                    setEditError("");
                  }} type="time" value={draftStart} />
                </label>
                <label>End time
                  <input aria-label="Activity end time" onChange={(event) => {
                    const value = event.target.value;
                    setDraftEnd(value);
                    const duration = inputMinutes(value) - inputMinutes(draftStart);
                    if (Number.isInteger(duration) && duration >= 1 && duration <= 480) { setDraftDuration(String(duration)); setEditError(""); }
                  }} type="time" value={draftEnd} />
                </label>
                <label>Duration (minutes)
                  <input aria-label="Activity duration in minutes" max={480} min={1} onChange={(event) => {
                    const value = event.target.value;
                    setDraftDuration(value);
                    setDraftEnd(endTimeInput(draftStart, Number(value)));
                    setEditError("");
                  }} type="number" value={draftDuration} />
                </label>
              </div>
              <fieldset className="event-details__people">
                <legend>Assigned people</legend>
                {plan.participants.map((person) => (
                  <label key={person}><input checked={draftPeople.includes(person)} disabled={Boolean(selectedEligibility?.allowedParticipants && !selectedEligibility.allowedParticipants.includes(person)
                    || selectedEligibility?.forbiddenParticipants?.includes(person))} onChange={(event) => { setDraftPeople((current) => event.target.checked ? [...current, person] : current.filter((entry) => entry !== person)); setEditError(""); }} title={selectedEligibility?.allowedParticipants && !selectedEligibility.allowedParticipants.includes(person) || selectedEligibility?.forbiddenParticipants?.includes(person) ? `${person} is not eligible for this activity` : undefined} type="checkbox" />{person}</label>
                ))}
              </fieldset>
              {selectedRequirement && (selectedRequirement.fixedDate || selectedRequirement.fixedStartTime) && !fixedCommitment && <p className="event-details__edit-hint">This is your fixed commitment. An explicit edit updates that requirement only after you review and apply the proposal.</p>}
              <p className="event-details__edit-hint">Change the end time, duration, or people, then review the proposed schedule. Eligibility and other activities are still checked. Notes are saved independently, even if you keep the current schedule.</p>
              {editError && <p className="event-details__edit-error" role="alert">{editError}</p>}
              <div className="event-details__actions"><button onClick={reviewScheduleChange} type="button">Review schedule change</button></div>
            </div>
          )}
          {!viewOnly && !canEditSchedule && <p className="event-details__edit-hint">{startedCommitment ? "This activity has already started. Keep its recorded date, time, duration, and people; you can still update its details." : fixedCommitment ? "This is a fixed commitment in the example. Its date, time, duration, and people stay as stated; start a new plan to change the commitment itself." : "Start a new plan to edit this schedule."}</p>}
          {draftPreview && <p className="event-details__edit-hint">This is a draft preview. Correct its requirements before using the plan, or accept it to edit activities.</p>}
          {canEditDetails ? (
            <div className="event-details__note">
              <label htmlFor="event-details-note">Additional details</label>
              <textarea id="event-details-note" maxLength={500} onChange={(event) => setDraftDetails(event.target.value)} placeholder="Add a note for this activity" rows={3} value={draftDetails} />
              <span>{draftDetails.length}/500 characters</span>
            </div>
          ) : (
            <div className="event-details__note">
              <strong>Additional details</strong>
              <p>{selectedItem.details || "No additional details."}</p>
            </div>
          )}
          {canEditDetails && <div className="event-details__actions"><button onClick={saveDetails} type="button">Save details</button></div>}
        </dialog>
      )}

      {plan.requirements && !draftPreview && (
        <details className="plan-checklist">
          <summary>{outdated ? "Earlier example checklist — regenerate" : plan.scenarioEdits && Object.keys(plan.scenarioEdits).length ? "Customized example checklist" : plan.requirements.source === "scenario" ? "Verified example checklist" : "Interpreted checklist — review it"}</summary>
          <p>
            {outdated
              ? "This saved plan has not passed the current example checks. Start a new plan to regenerate it."
              : plan.scenarioEdits && Object.keys(plan.scenarioEdits).length
              ? "Checked against the example with your edited duration and assignments. The original requirements you changed no longer apply."
              : plan.requirements.source === "scenario"
              ? "Checked against the example’s stated requirements."
              : "These are the requirements the planner captured from your words. Anything missing here was not verified. Correct a checklist item or ask for a revision."}
          </p>
          {requirementSections(plan.requirements).filter((section) => section.lines.length > 0).map((section) => (
            <div className="plan-checklist__section" key={section.id}>
              <h4>{section.label}</h4>
              <ul>{section.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
              {section.id === "window" && plan.requirements?.source === "interpreted" && onCorrectRequirement && (
                <button className="plan-checklist__correct" onClick={() => onCorrectRequirement("window", "time window")} title="Correct the interpreted time window in chat" type="button">Correct</button>
              )}
            </div>
          ))}
          <h4>Activities and assignments</h4>
          <ul>
            {plan.requirements.tasks.map((task) => (
              <li key={task.id}>
                {requirementDescription(task, plan.requirements!)}
                {plan.requirements?.source === "interpreted" && onCorrectRequirement && (
                  <button aria-label={`Correct ${task.label}`} className="plan-checklist__correct" onClick={() => onCorrectRequirement(task.id, task.label)} title={`Correct the interpreted requirement for ${task.label}`} type="button">Correct</button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <footer className="plan-board__footer">
        <span>Updated {formatUpdatedAt(plan.updatedAt)}</span>
        <span>{draftPreview ? "Draft — not yet accepted" : readOnly ? "Read-only snapshot" : persistenceUnavailable ? "In memory for this visit" : "Saved on this device"}</span>
      </footer>
      {!viewOnly && <a className="plan-board__continue" href="#conversation">Back to the conversation ↑</a>}
    </section>
  );
}
