import type { HouseholdPlan } from "../shared/contracts";
import { scenarioRequirements } from "../shared/scenarios";

function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((entry, index) => sameValue(entry, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const first = Object.keys(left).filter((key) => (left as Record<string, unknown>)[key] !== undefined).sort();
    const second = Object.keys(right).filter((key) => (right as Record<string, unknown>)[key] !== undefined).sort();
    return sameValue(first, second) && first.every((key) => sameValue(
      (left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key],
    ));
  }
  return left === right;
}

export function isOutdatedExample(plan: HouseholdPlan): boolean {
  // Compare against the dates chosen when this example began, not today's
  // rolling dates. Older saved plans have no anchor and retain the legacy set.
  const current = scenarioRequirements(plan.scenarioId, plan.scenarioAnchor);
  if (!current) return false;
  const saved = plan.requirements;
  const edits = plan.scenarioEdits ?? {};
  if (Object.keys(edits).length && saved?.source !== "interpreted") return true;
  for (const [id, edit] of Object.entries(edits)) {
    const base = current.tasks.find((task) => task.id === id);
    const item = plan.items.find((candidate) => candidate.taskId === id);
    if (!base || !item || base.fixedDate || base.fixedStartTime) return true;
    if (edit.durationMinutes === undefined && !edit.assignees) return true;
    if (edit.durationMinutes !== undefined && item.durationMinutes !== edit.durationMinutes) return true;
    if (edit.assignees) {
      if (edit.assignees.some((person) => !plan.participants.includes(person)
        || base.allowedParticipants && !base.allowedParticipants.includes(person)
        || base.forbiddenParticipants?.includes(person))) return true;
      const assigned = item.assignee.split(/\s*(?:,|&|\+|\band\b)\s*/i).filter(Boolean);
      if (assigned.length !== edit.assignees.length || edit.assignees.some((person) => !assigned.includes(person))) return true;
    }
  }
  // A revision may add interpreted constraints while retaining every
  // server-owned example constraint, so provenance alone does not age it out.
  if (!saved || !sameValue(saved.timeWindow, current.timeWindow)) return true;
  if (current.timeWindows && !sameValue(saved.timeWindows, current.timeWindows)) return true;
  if (current.workload && !sameValue(saved.workload, current.workload)) return true;
  if (current.tasks.some((task) => !saved.tasks.some((candidate) => {
    if (candidate.id !== task.id) return false;
    const edit = edits[task.id];
    let expected = task;
    if (edit?.assignees) {
      expected = { ...expected, requiredParticipants: edit.assignees, allowedParticipants: edit.assignees };
      delete expected.atLeastOneOf;
    }
    if (edit?.durationMinutes !== undefined) expected = { ...expected, durationMinutes: edit.durationMinutes };
    // Scenario dates are initial placements unless explicitly fixed. A validated
    // revision can move one activity and update its displayed checklist date.
    if (!task.fixedDate) {
      if (task.date && !candidate.date) return false;
      return sameValue({ ...candidate, date: undefined }, { ...expected, date: undefined });
    }
    return sameValue(candidate, expected);
  }))) return true;
  for (const field of ["ordering", "gaps"] as const) {
    if ((current[field] ?? []).some((relation) => !(saved[field] ?? []).some((candidate) => sameValue(candidate, relation)))) return true;
  }
  return false;
}
