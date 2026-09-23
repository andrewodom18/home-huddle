import { isDeepStrictEqual } from "node:util";
import { planRequirementsSchema, type HouseholdPlan, type PlanRequirements, type RequirementChange } from "../shared/contracts";
import { minutes } from "./scheduleValidation";

/** Validate the checklist itself, independently of the model's schedule. */
export function requirementsIssues(requirements: PlanRequirements, participants: string[]): string[] {
  const issues: string[] = [];
  const people = new Set(participants.map((name) => name.toLowerCase()));
  if (people.size !== participants.length) issues.push("Participants must be unique");
  const ids = new Set(requirements.tasks.map((task) => task.id));
  if (ids.size !== requirements.tasks.length) issues.push("Task IDs must be unique");
  const resources = new Map((requirements.resources ?? []).map((resource) => [resource.id, resource]));
  if (resources.size !== (requirements.resources ?? []).length) issues.push("Resource IDs must be unique");
  const checkPerson = (name: string) => { if (!people.has(name.toLowerCase())) issues.push(`Unknown participant: ${name}`); };
  const checkWindow = (startTime: string, endTime: string, label: string) => {
    const start = minutes(startTime); const end = minutes(endTime);
    if (start === undefined || end === undefined || start >= end) issues.push(`${label}: choose a valid same-day time window`);
  };
  checkWindow(requirements.timeWindow.startTime, requirements.timeWindow.endTime, "Planning window");
  for (const window of requirements.timeWindows ?? []) checkWindow(window.startTime, window.endTime, window.date);
  if (new Set(requirements.timeWindows?.map((window) => window.date)).size !== (requirements.timeWindows?.length ?? 0)) issues.push("Date-specific windows must be unique");
  for (const window of requirements.availability ?? []) {
    checkPerson(window.participant);
    checkWindow(window.startTime, window.endTime, `${window.participant} availability`);
  }
  for (const task of requirements.tasks) {
    for (const field of ["requiredParticipants", "atLeastOneOf", "allowedParticipants", "forbiddenParticipants"] as const) {
      for (const person of task[field] ?? []) checkPerson(person);
    }
    for (const time of [task.fixedStartTime, task.earliestStartTime, task.latestEndTime]) if (time && minutes(time) === undefined) issues.push(`${task.label}: use valid clock times`);
    for (const person of task.requiredParticipants ?? []) {
      if (task.forbiddenParticipants?.some((name) => name.toLowerCase() === person.toLowerCase()) || task.allowedParticipants && !task.allowedParticipants.some((name) => name.toLowerCase() === person.toLowerCase())) issues.push(`${task.label}: ${person} is both required and ineligible`);
    }
    if (task.fixedDate && !task.date) issues.push(`${task.label}: a fixed date requires a date`);
    const used = new Set<string>();
    for (const use of task.resources ?? []) {
      if (used.has(use.resourceId)) issues.push(`${task.label}: list each resource once`);
      used.add(use.resourceId);
      const resource = resources.get(use.resourceId);
      if (!resource) issues.push(`${task.label}: unknown resource ${use.resourceId}`);
      else if (use.units > resource.capacity) issues.push(`${task.label} requires more ${resource.label} capacity than available`);
    }
  }
  const edges = new Map<string, string[]>();
  for (const edge of [...(requirements.ordering ?? []).map((edge) => ({ before: edge.beforeTaskId, after: edge.afterTaskId })), ...(requirements.gaps ?? []).map((edge) => ({ before: edge.afterTaskId, after: edge.beforeTaskId }))]) {
    if (!ids.has(edge.before) || !ids.has(edge.after)) issues.push("A dependency refers to a missing task");
    edges.set(edge.before, [...(edges.get(edge.before) ?? []), edge.after]);
  }
  const visited = new Set<string>(); const visiting = new Set<string>();
  const cycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const result = (edges.get(id) ?? []).some(cycle);
    visiting.delete(id); visited.add(id);
    return result;
  };
  if ([...ids].some(cycle)) issues.push("Task dependencies contain a cycle");
  if (requirements.workload) {
    requirements.workload.participants.forEach(checkPerson);
    if (requirements.workload.minMinutes > requirements.workload.maxMinutes) issues.push("Workload minimum exceeds its maximum");
    for (const id of requirements.workload.excludeTaskIds ?? []) if (!ids.has(id)) issues.push(`Workload refers to unknown task ${id}`);
  }
  return issues;
}

/** A pair of accepted, fixed commitments cannot occupy the same person at once. */
export function fixedCommitmentConflict(requirements: PlanRequirements, defaultDate?: string): string | undefined {
  if (requirements.source !== "interpreted") return undefined;
  const tasks = requirements.tasks;
  for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
    const left = tasks[leftIndex];
    const leftDate = left.date ?? defaultDate;
    const leftStart = left.fixedStartTime ? minutes(left.fixedStartTime) : undefined;
    if (!leftDate || leftStart === undefined || !left.requiredParticipants?.length) continue;
    for (const right of tasks.slice(leftIndex + 1)) {
      const rightDate = right.date ?? defaultDate;
      const rightStart = right.fixedStartTime ? minutes(right.fixedStartTime) : undefined;
      if (rightDate !== leftDate || rightStart === undefined) continue;
      const person = left.requiredParticipants.find((name) => right.requiredParticipants?.some((other) => other.toLowerCase() === name.toLowerCase()));
      if (!person || leftStart + left.durationMinutes <= rightStart || rightStart + right.durationMinutes <= leftStart) continue;
      return `${person} is required for both ${left.label} and ${right.label} on ${leftDate}, but their fixed times overlap. Move one fixed time or change who must attend.`;
    }
  }
  return undefined;
}

/** Apply explicit typed changes atomically; model schedules cannot rewrite the result. */
export function applyRequirementChanges(plan: HouseholdPlan, changes: RequirementChange[]): PlanRequirements {
  if (!plan.requirements) throw new Error("This saved plan needs a requirements checklist before it can be changed.");
  if (plan.scenarioId) throw new Error("Use the event editor for example changes, or start a custom plan to change its checklist.");
  let next = structuredClone(plan.requirements);
  for (const change of changes) {
    if (change.kind === "constraints") {
      const { workload, ...fields } = change.fields;
      next = { ...next, ...fields };
      if (workload === null) delete next.workload;
      else if (workload !== undefined) next.workload = workload;
      for (const field of change.clear ?? []) delete next[field];
      continue;
    }
    if (change.kind === "add_task") {
      if (next.tasks.some((task) => task.id === change.task.id)) throw new Error(`Task ${change.task.id} already exists.`);
      next.tasks.push(change.task);
      continue;
    }
    const task = next.tasks.find((task) => task.id === change.taskId);
    if (!task) throw new Error(`Task ${change.taskId} does not exist.`);
    if (change.kind === "update_task") {
      if (change.task.id !== change.taskId) throw new Error("An updated task must keep its stable ID.");
      next.tasks = next.tasks.map((existing) => existing.id === change.taskId ? change.task : existing);
    } else {
      next.tasks = next.tasks.filter((existing) => existing.id !== change.taskId);
      next.ordering = next.ordering?.filter((edge) => edge.beforeTaskId !== change.taskId && edge.afterTaskId !== change.taskId);
      next.gaps = next.gaps?.filter((edge) => edge.beforeTaskId !== change.taskId && edge.afterTaskId !== change.taskId);
      if (next.workload) next.workload.excludeTaskIds = next.workload.excludeTaskIds?.filter((id) => id !== change.taskId);
    }
  }
  next.source = "interpreted";
  const parsed = planRequirementsSchema.safeParse(next);
  if (!parsed.success) throw new Error("Keep at least one activity and valid bounded requirements in the plan.");
  const issues = requirementsIssues(parsed.data, plan.participants);
  if (issues.length) throw new Error(issues[0]);
  if (isDeepStrictEqual(parsed.data, plan.requirements)) throw new Error("The requested requirements are already in this plan.");
  return parsed.data;
}

/** Bound model-extracted deltas to the user's independently recognizable request. */
export function naturalChangeIssues(plan: HouseholdPlan, changes: RequirementChange[], message: string): string[] {
  const issues: string[] = [];
  const text = ` ${message.toLowerCase().replace(/[_-]/g, " ").replace(/[“”"'’.,!?]/g, " ").replace(/\s+/g, " ")} `;
  const named = (task: PlanRequirements["tasks"][number]) => [task.id, task.label].some((value) => {
    const target = value.toLowerCase().replace(/[_-]/g, " ").replace(/[“”"'’.,!?]/g, " ").replace(/\s+/g, " ").trim();
    return text.includes(` ${target} `);
  });
  const effectiveTasks = [...(plan.requirements?.tasks ?? []), ...changes.flatMap((change) => change.kind === "add_task" ? [change.task] : [])];
  const permittedFields = new Set<string>();
  if (/\b(?:availability|available|unavailable|busy|free)\b/i.test(message)) permittedFields.add("availability");
  if (/\b(?:time|planning) window\b/i.test(message)) { permittedFields.add("timeWindow"); permittedFields.add("timeWindows"); }
  if (/\b(?:resource|capacity|equipment)\b/i.test(message)) permittedFields.add("resources");
  if (/\b(?:workload|fair|fairly|balance|balanced)\b/i.test(message)) permittedFields.add("workload");
  if (/\b(?:order|ordering|dependency|dependencies|before|after)\b/i.test(message)) permittedFields.add("ordering");
  if (/\b(?:gap|buffer|transition)\b|\bminutes? between\b/i.test(message)) permittedFields.add("gaps");
  if (/\b(?:prefer|preference|prioritize|priority)\b/i.test(message)) permittedFields.add("preferences");
  if (/\bassumption\b/i.test(message)) permittedFields.add("assumptions");
  for (const change of changes) {
    if (change.kind === "add_task") {
      if (!/\b(?:add|include|also|need)\b/i.test(message)) issues.push("Do not add an activity without an explicit addition request.");
    } else if (change.kind === "remove_task") {
      if (!/\b(?:remove|cancel|delete|drop|skip)\b/i.test(message)) issues.push("Do not cancel an activity without an explicit cancellation request.");
      const task = plan.requirements?.tasks.find((task) => task.id === change.taskId);
      if (task && !named(task)) issues.push(`Name the activity to cancel unambiguously: ${task.label}.`);
    } else if (change.kind === "update_task") {
      const prior = plan.requirements?.tasks.find((task) => task.id === change.taskId);
      if (!prior || !named(prior) || !/\b(?:change|update|correct|make|move|reschedule|rename|assign)\b/i.test(message)) {
        issues.push("Only update an existing activity when the user explicitly names it and requests its change.");
        continue;
      }
      const allowed = new Set<string>();
      if (/\b(?:duration|minutes?|hours?|takes?|last)\b/i.test(message)) allowed.add("durationMinutes");
      if (/\b(?:date|day|tomorrow|today)\b|\d{4}-\d{2}-\d{2}/i.test(message)) { allowed.add("date"); allowed.add("fixedDate"); }
      if (/\b(?:start|time|earlier|later)\b/i.test(message)) allowed.add("fixedStartTime");
      if (/\b(?:earliest|not before|start after|available after)\b/i.test(message)) allowed.add("earliestStartTime");
      if (/\b(?:latest|finish by|end by|deadline)\b/i.test(message)) allowed.add("latestEndTime");
      if (/\b(?:assign|reassign|participant|people|person|handle|help)\b/i.test(message)) for (const key of ["requiredParticipants", "atLeastOneOf", "allowedParticipants", "forbiddenParticipants"]) allowed.add(key);
      if (permittedFields.has("resources")) allowed.add("resources");
      if (/\b(?:rename|label)\b/i.test(message)) allowed.add("label");
      for (const field of new Set([...Object.keys(prior), ...Object.keys(change.task)])) {
        const key = field as keyof typeof prior;
        if (!isDeepStrictEqual(prior[key], change.task[key]) && !allowed.has(field)) issues.push(`${prior.label}: preserve unrelated ${field}.`);
      }
    } else {
      for (const field of [...Object.keys(change.fields), ...(change.clear ?? [])]) {
        const key = field as keyof typeof change.fields;
        if (!isDeepStrictEqual(plan.requirements?.[key], change.fields[key]) && !permittedFields.has(field)) issues.push(`The request did not authorize changing ${field}.`);
      }
      const allPeople = /\b(?:everyone|everybody|all participants|whole household)\b/i.test(message);
      const namedPerson = (name: string) => allPeople || text.includes(` ${name.toLowerCase()} `);
      const changedAvailability = change.fields.availability ?? (change.clear?.includes("availability") ? [] : undefined);
      if (changedAvailability) {
        const prior = plan.requirements?.availability ?? [];
        const changedRows = [...prior.filter((row) => !changedAvailability.some((other) => isDeepStrictEqual(row, other))), ...changedAvailability.filter((row) => !prior.some((other) => isDeepStrictEqual(row, other)))];
        const requestedDates: string[] = message.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
        for (const row of changedRows) {
          if (!namedPerson(row.participant)) issues.push(`Preserve ${row.participant}'s unrelated availability.`);
          if (requestedDates.length && row.date && !requestedDates.includes(row.date)) issues.push(`Preserve availability on unrelated date ${row.date}.`);
        }
      }
      const changedWindows = change.fields.timeWindows ?? (change.clear?.includes("timeWindows") ? [] : undefined);
      if (changedWindows) {
        const prior = plan.requirements?.timeWindows ?? [];
        const changedRows = [...prior.filter((row) => !changedWindows.some((other) => isDeepStrictEqual(row, other))), ...changedWindows.filter((row) => !prior.some((other) => isDeepStrictEqual(row, other)))];
        const requestedDates: string[] = message.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
        for (const row of changedRows) if (!/\b(?:all days|every day|all dates)\b/i.test(message) && !requestedDates.includes(row.date)) issues.push(`Preserve the unrelated planning window on ${row.date}; specify its date to change it.`);
      }
      const changedResources = change.fields.resources ?? (change.clear?.includes("resources") ? [] : undefined);
      if (changedResources) {
        const prior = plan.requirements?.resources ?? [];
        const changedRows = [...prior.filter((row) => !changedResources.some((other) => isDeepStrictEqual(row, other))), ...changedResources.filter((row) => !prior.some((other) => isDeepStrictEqual(row, other)))];
        for (const row of changedRows) if (!/\ball resources\b/i.test(message) && !text.includes(` ${row.label.toLowerCase()} `) && !text.includes(` ${row.id.replace(/[_-]/g, " ").toLowerCase()} `)) issues.push(`Preserve unrelated resource ${row.label}.`);
      }
      for (const field of ["gaps", "ordering"] as const) {
        const replacement = change.fields[field] ?? (change.clear?.includes(field) ? [] : undefined);
        if (!replacement) continue;
        const prior = plan.requirements?.[field] ?? [];
        const changedRows = [...prior.filter((row) => !replacement.some((other) => isDeepStrictEqual(row, other))), ...replacement.filter((row) => !prior.some((other) => isDeepStrictEqual(row, other)))];
        for (const row of changedRows) {
          const before = effectiveTasks.find((task) => task.id === row.beforeTaskId);
          const after = effectiveTasks.find((task) => task.id === row.afterTaskId);
          const onlyGap = field === "gaps" && prior.length === 1 && replacement.length <= 1;
          if (!onlyGap && !/\ball (?:gaps|buffers|dependencies|ordering)\b/i.test(message) && (!before || !after || !named(before) || !named(after))) issues.push(`Name both activities for the ${field} change; preserve unrelated relationships.`);
        }
      }
      if (change.fields.workload !== undefined || change.clear?.includes("workload")) {
        for (const person of new Set([...(plan.requirements?.workload?.participants ?? []), ...(change.fields.workload?.participants ?? [])])) if (!namedPerson(person)) issues.push(`Preserve ${person}'s unrelated workload limits or explicitly change the whole household workload.`);
      }
    }
  }
  return issues;
}

/** Capture a directly stated, single-person daily availability window without
 * asking a model to rewrite unrelated task or household requirements. */
export function explicitAvailabilityChanges(plan: HouseholdPlan, message: string): RequirementChange[] | undefined {
  const parts = message.trim().split(/[.!?]\s+/);
  const clock = "(\\d{1,2}(?::\\d{2})?\\s*[AP]M)";
  const match = new RegExp(`^(.+?)\\s+is\\s+(?:now\\s+)?available\\s+only\\s+from\\s+${clock}\\s+to\\s+${clock}[.!?]?$`, "i").exec(parts[0]);
  if (!match || !plan.requirements) return undefined;
  const participant = plan.participants.find((person) => person.toLowerCase() === match[1].trim().toLowerCase());
  if (!participant) return undefined;
  // The exact window is only one instruction. Never discard a second requested
  // mutation merely because the first sentence was easy to recognize.
  for (const extra of parts.slice(1)) {
    if (!/^(?:keep|preserve|reschedule)\b/i.test(extra)) return undefined;
    const remaining = extra.replace(/\b(?:within|that|this|his|her|their)\s+(?:that\s+|this\s+)?availability\b/gi, "");
    if (/\d|\b(?:add|remove|cancel|delete|assign|reassign|change|set|available|availability|capacity|resource|duration)\b/i.test(remaining)) return undefined;
  }
  const canonicalTime = (input: string) => input.trim().replace(/^(\d{1,2})(?=\s*[AP]M$)/i, "$1:00").replace(/\s*([AP]M)$/i, " $1").toUpperCase();
  const startTime = canonicalTime(match[2]); const endTime = canonicalTime(match[3]);
  if (minutes(startTime) === undefined || minutes(endTime) === undefined || minutes(startTime)! >= minutes(endTime)!) return undefined;
  const prior = plan.requirements.availability ?? [];
  // A date-specific exception needs an explicit date decision; do not erase it.
  if (prior.some((window) => window.participant.toLowerCase() === participant.toLowerCase() && window.date)) return undefined;
  const availability = [...prior.filter((window) => window.participant.toLowerCase() !== participant.toLowerCase()), { participant, startTime, endTime }];
  if (isDeepStrictEqual(availability, prior)) return undefined;
  return [{ kind: "constraints", fields: { availability } }];
}
