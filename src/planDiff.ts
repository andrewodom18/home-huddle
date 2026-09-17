import type { ReviewChange } from "conversation-display-kit";
import type { HouseholdPlan } from "../shared/contracts";

function identity(item: HouseholdPlan["items"][number]) {
  return item.taskId ?? item.task.trim().toLowerCase();
}

function description(item: HouseholdPlan["items"][number]) {
  return `${item.startTime} · ${item.assignee}`;
}

function requirementDescription(task: NonNullable<HouseholdPlan["requirements"]>["tasks"][number]) {
  return [
    `${task.durationMinutes} min`,
    task.fixedStartTime && `fixed ${task.fixedStartTime}`,
    task.requiredParticipants?.length && `with ${task.requiredParticipants.join(", ")}`,
    task.allowedParticipants?.length && `allowed ${task.allowedParticipants.join(", ")}`,
    task.forbiddenParticipants?.length && `not ${task.forbiddenParticipants.join(", ")}`,
  ].filter(Boolean).join(" · ");
}

export function reviewChanges(current: HouseholdPlan, proposal: HouseholdPlan): ReviewChange[] {
  const oldItems = new Map(current.items.map((item) => [identity(item), item]));
  const changes: ReviewChange[] = [];
  for (const item of proposal.items) {
    const previous = oldItems.get(identity(item));
    if (!previous || previous.startTime !== item.startTime || previous.assignee !== item.assignee || previous.durationMinutes !== item.durationMinutes) {
      changes.push({
        id: identity(item),
        label: item.task,
        before: previous ? `${description(previous)} · ${previous.durationMinutes} min` : "New task",
        after: `${description(item)} · ${item.durationMinutes} min`,
      });
    }
    oldItems.delete(identity(item));
  }
  for (const item of oldItems.values()) {
    changes.push({ id: `removed-${identity(item)}`, label: item.task, before: description(item), after: "Removed" });
  }
  if (current.requirements && proposal.requirements) {
    const beforeWindow = current.requirements.timeWindow;
    const afterWindow = proposal.requirements.timeWindow;
    if (beforeWindow.startTime !== afterWindow.startTime || beforeWindow.endTime !== afterWindow.endTime) {
      changes.push({ id: "checklist-window", label: "Checklist: time window", before: `${beforeWindow.startTime}–${beforeWindow.endTime}`, after: `${afterWindow.startTime}–${afterWindow.endTime}` });
    }
    for (const next of proposal.requirements.tasks) {
      const prior = current.requirements.tasks.find((task) => task.id === next.id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(next)) {
        changes.push({ id: `checklist-${next.id}`, label: `Checklist: ${next.label}`, before: requirementDescription(prior), after: requirementDescription(next) });
      }
    }
  }
  return changes;
}

export function preservedFixedCommitments(current: HouseholdPlan, proposal: HouseholdPlan): string[] {
  const fixed = current.requirements?.tasks.filter((task) => task.fixedStartTime) ?? [];
  return fixed.filter((task) => proposal.items.some((item) => item.taskId === task.id && item.startTime === task.fixedStartTime))
    .map((task) => `${task.label} at ${task.fixedStartTime}`);
}
