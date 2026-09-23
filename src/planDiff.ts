import type { ReviewChange } from "conversation-display-kit";
import type { HouseholdPlan } from "../shared/contracts";
import { requirementDescription, requirementSections } from "./requirementDisplay";

function identity(item: HouseholdPlan["items"][number]) {
  return item.taskId ?? item.id;
}

function description(item: HouseholdPlan["items"][number]) {
  return `${item.task} · ${item.date ? `${item.date} · ` : ""}${item.startTime} · ${item.durationMinutes} min · ${item.assignee}${item.details ? ` · Details: ${item.details}` : ""}`;
}
const setText = (values: string[]) => [...values].sort().join("; ");
function taskText(task: NonNullable<HouseholdPlan["requirements"]>["tasks"][number], requirements: NonNullable<HouseholdPlan["requirements"]>) {
  return requirementDescription({
    ...task,
    requiredParticipants: task.requiredParticipants && [...task.requiredParticipants].sort(),
    atLeastOneOf: task.atLeastOneOf && [...task.atLeastOneOf].sort(),
    allowedParticipants: task.allowedParticipants && [...task.allowedParticipants].sort(),
    forbiddenParticipants: task.forbiddenParticipants && [...task.forbiddenParticipants].sort(),
    resources: task.resources && [...task.resources].sort((a, b) => a.resourceId.localeCompare(b.resourceId)),
  }, requirements);
}

/** Every accepted content change is visible, including removed requirements. */
export function reviewChanges(current: HouseholdPlan, proposal: HouseholdPlan): ReviewChange[] {
  const changes: ReviewChange[] = [];
  const add = (id: string, label: string, before: string, after: string) => {
    if (before !== after) changes.push({ id, label, before: before || "None", after: after || "None" });
  };
  add("title", "Plan title", current.title, proposal.title);
  add("objective", "Plan objective", current.objective, proposal.objective);
  add("participants", "Participants", setText(current.participants), setText(proposal.participants));
  add("notes", "Plan notes", current.notes.join("; "), proposal.notes.join("; "));
  const oldItems = new Map(current.items.map((item) => [identity(item), item]));
  for (const item of proposal.items) {
    const previous = oldItems.get(identity(item));
    add(`event-${identity(item)}`, item.task, previous ? description(previous) : "New task", description(item));
    oldItems.delete(identity(item));
  }
  for (const item of oldItems.values()) add(`removed-${identity(item)}`, item.task, description(item), "Removed");
  const beforeRequirements = current.requirements;
  const afterRequirements = proposal.requirements;
  const previousTasks = new Map(beforeRequirements?.tasks.map((task) => [task.id, task]) ?? []);
  for (const task of afterRequirements?.tasks ?? []) {
    const previous = previousTasks.get(task.id);
    add(`checklist-${task.id}`, `Checklist: ${task.label}`, previous && beforeRequirements ? taskText(previous, beforeRequirements) : "New requirement", taskText(task, afterRequirements!));
    previousTasks.delete(task.id);
  }
  for (const task of previousTasks.values()) add(`checklist-removed-${task.id}`, `Checklist: ${task.label}`, taskText(task, beforeRequirements!), "Removed requirement");
  const oldSections = new Map((beforeRequirements ? requirementSections(beforeRequirements) : []).map((section) => [section.id, section]));
  for (const section of afterRequirements ? requirementSections(afterRequirements) : []) {
    const previous = oldSections.get(section.id);
    add(`checklist-${section.id}`, `Checklist: ${section.label.toLowerCase()}`, setText(previous?.lines ?? []), setText(section.lines));
    oldSections.delete(section.id);
  }
  for (const section of oldSections.values()) add(`checklist-${section.id}`, `Checklist: ${section.label.toLowerCase()}`, setText(section.lines), "");
  return changes;
}

export function preservedFixedCommitments(current: HouseholdPlan, proposal: HouseholdPlan): string[] {
  const fixed = current.requirements?.tasks.filter((task) => task.fixedStartTime || task.fixedDate) ?? [];
  return fixed.filter((task) => {
    const before = current.items.find((item) => item.taskId === task.id);
    const after = proposal.items.find((item) => item.taskId === task.id);
    return before && after && after.startTime === before.startTime && after.date === before.date && after.durationMinutes === before.durationMinutes && after.assignee === before.assignee;
  }).map((task) => `${task.label}${task.date ? ` on ${task.date}` : ""}${task.fixedStartTime ? ` at ${task.fixedStartTime}` : ""}`);
}
