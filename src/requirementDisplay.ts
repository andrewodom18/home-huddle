import type { PlanRequirements } from "../shared/contracts";

type Task = PlanRequirements["tasks"][number];
export function requirementDescription(task: Task, requirements: PlanRequirements): string {
  const resourceNames = new Map(requirements.resources?.map((resource) => [resource.id, resource.label]) ?? []);
  return [
    task.label,
    `${task.durationMinutes} min`,
    task.kind && task.kind !== "task" && task.kind,
    task.date && `${task.fixedDate ? "fixed date" : "on"} ${task.date}`,
    task.fixedDate && !task.date && "fixed date",
    task.fixedStartTime && `fixed at ${task.fixedStartTime}`,
    task.earliestStartTime && `no earlier than ${task.earliestStartTime}`,
    task.latestEndTime && `finish by ${task.latestEndTime}`,
    task.requiredParticipants?.length && `with ${task.requiredParticipants.join(", ")}`,
    task.atLeastOneOf?.length && `at least one of ${task.atLeastOneOf.join(" or ")}`,
    task.allowedParticipants?.length && `allowed: ${task.allowedParticipants.join(", ")}`,
    task.forbiddenParticipants?.length && `not assigned: ${task.forbiddenParticipants.join(", ")}`,
    task.resources?.length && `uses ${task.resources.map((resource) => `${resourceNames.get(resource.resourceId) ?? resource.resourceId} (${resource.units})`).join(", ")}`,
  ].filter(Boolean).join(" · ");
}

export function requirementSections(requirements: PlanRequirements): Array<{ id: string; label: string; lines: string[] }> {
  const names = new Map(requirements.tasks.map((task) => [task.id, task.label]));
  const name = (id: string) => names.get(id) ?? id;
  const workload = requirements.workload;
  return [
    { id: "window", label: "Time window", lines: [`${requirements.timeWindow.startTime}–${requirements.timeWindow.endTime}`] },
    { id: "dates", label: "Dated windows", lines: requirements.timeWindows?.map((window) => `${window.date}: ${window.startTime}–${window.endTime}`) ?? [] },
    { id: "ordering", label: "Order", lines: requirements.ordering?.map((relation) => `${name(relation.beforeTaskId)} before ${name(relation.afterTaskId)}`) ?? [] },
    { id: "gaps", label: "Transition time", lines: requirements.gaps?.map((gap) => `At least ${gap.minMinutes} min between ${name(gap.afterTaskId)} and ${name(gap.beforeTaskId)}`) ?? [] },
    { id: "workload", label: "Workload", lines: workload ? [`Each of ${workload.participants.join(", ")}: ${workload.minMinutes}–${workload.maxMinutes} min${workload.excludeTaskIds?.length ? `, excluding ${workload.excludeTaskIds.map(name).join(", ")}` : ""}`] : [] },
    { id: "availability", label: "Availability", lines: requirements.availability?.map((entry) => `${entry.participant}${entry.date ? ` on ${entry.date}` : " on each day"}: ${entry.startTime}–${entry.endTime}`) ?? [] },
    { id: "resources", label: "Shared resources", lines: requirements.resources?.map((resource) => `${resource.label}: capacity ${resource.capacity}`) ?? [] },
    { id: "preferences", label: "Preferences", lines: requirements.preferences?.map((preference) => `${preference.description} (${preference.kind.replaceAll("_", " ")})`) ?? [] },
    { id: "assumptions", label: "Assumptions — please check", lines: requirements.assumptions ?? [] },
  ];
}
