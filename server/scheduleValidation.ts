import type { ChatRequest, PlanDraft, PlanRequirements } from "../shared/contracts";

export function minutes(time: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return undefined;
  return (hour % 12) * 60 + minute + (match[3].toUpperCase() === "PM" ? 720 : 0);
}

function assignedPeople(assignee: string, participants: string[]): string[] {
  if (/^(all|everyone|family|household)$/i.test(assignee.trim())) return participants;
  const names = assignee.split(/\s*(?:,|&|\+|\band\b)\s*/i).filter(Boolean);
  const resolved = names.map((name) => participants.find((person) => person.toLowerCase() === name.toLowerCase()));
  return resolved.every(Boolean) ? [...new Set(resolved as string[])] : [];
}

export function scheduleIssues(
  draft: PlanDraft,
  request: Pick<ChatRequest, "history" | "message">,
  requirements: PlanRequirements | undefined = draft.requirements,
): string[] {
  const issues: string[] = [];
  const slots = draft.items.map((item) => ({
    item,
    start: minutes(item.startTime),
    people: assignedPeople(item.assignee, draft.participants),
  }));

  if (new Set(draft.participants.map((person) => person.toLowerCase())).size !== draft.participants.length) {
    issues.push("Participants must be unique");
  }
  for (const slot of slots) {
    if (slot.start === undefined) issues.push(`${slot.item.task}: use a valid start time such as 6:30 PM`);
    if (slot.people.length === 0) issues.push(`${slot.item.task}: assign at least one listed participant`);
  }

  for (let left = 0; left < slots.length; left += 1) {
    for (let right = left + 1; right < slots.length; right += 1) {
      const a = slots[left];
      const b = slots[right];
      if (a.start === undefined || b.start === undefined) continue;
      const samePeople = a.people.filter((person) => b.people.includes(person));
      if (samePeople.length > 0 && a.start < b.start + b.item.durationMinutes && b.start < a.start + a.item.durationMinutes) {
        issues.push(`${a.item.task} and ${b.item.task} overlap for ${samePeople.join(", ")}`);
      }
    }
  }

  if (requirements) {
    const windowStart = minutes(requirements.timeWindow.startTime);
    const windowEnd = minutes(requirements.timeWindow.endTime);
    if (windowStart === undefined || windowEnd === undefined || windowEnd <= windowStart) {
      issues.push("The planning time window must have valid start and end times on the same day");
    }
    const requirementIds = new Set<string>();
    const itemIds = new Set<string>();
    for (const requirement of requirements.tasks) {
      if (requirementIds.has(requirement.id)) issues.push(`Duplicate requirement ID: ${requirement.id}`);
      requirementIds.add(requirement.id);
      const matched = slots.filter((slot) => slot.item.taskId === requirement.id);
      if (matched.length !== 1) {
        issues.push(`${requirement.label}: schedule exactly once with task ID ${requirement.id}`);
        continue;
      }
      const slot = matched[0];
      if (slot.item.durationMinutes !== requirement.durationMinutes) {
        issues.push(`${requirement.label}: keep the required ${requirement.durationMinutes}-minute duration`);
      }
      for (const person of requirement.requiredParticipants ?? []) {
        if (!slot.people.some((assigned) => assigned.toLowerCase() === person.toLowerCase())) issues.push(`${requirement.label}: include ${person}`);
      }
      if (requirement.atLeastOneOf?.length && !requirement.atLeastOneOf.some((person) => slot.people.some((assigned) => assigned.toLowerCase() === person.toLowerCase()))) {
        issues.push(`${requirement.label}: include one of ${requirement.atLeastOneOf.join(", ")}`);
      }
      for (const person of slot.people) {
        if (requirement.allowedParticipants && !requirement.allowedParticipants.some((allowed) => allowed.toLowerCase() === person.toLowerCase())) issues.push(`${requirement.label}: ${person} is not an allowed assignee`);
        if (requirement.forbiddenParticipants?.some((forbidden) => forbidden.toLowerCase() === person.toLowerCase())) issues.push(`${requirement.label}: do not assign ${person}`);
      }
      if (requirement.fixedStartTime && slot.start !== minutes(requirement.fixedStartTime)) issues.push(`${requirement.label}: keep the fixed start at ${requirement.fixedStartTime}`);
    }
    for (const slot of slots) {
      if (!slot.item.taskId) issues.push(`${slot.item.task}: include a stable task ID`);
      else {
        if (itemIds.has(slot.item.taskId)) issues.push(`Duplicate scheduled task ID: ${slot.item.taskId}`);
        itemIds.add(slot.item.taskId);
        if (!requirementIds.has(slot.item.taskId)) issues.push(`${slot.item.task}: add this task to the displayed requirements checklist`);
      }
      if (windowStart !== undefined && slot.start !== undefined && slot.start < windowStart) issues.push(`${slot.item.task}: starts before ${requirements.timeWindow.startTime}`);
      if (windowEnd !== undefined && slot.start !== undefined && slot.start + slot.item.durationMinutes > windowEnd) issues.push(`${slot.item.task}: must finish by ${requirements.timeWindow.endTime}`);
    }
    const taskSlot = (id: string) => slots.find((slot) => slot.item.taskId === id);
    for (const relation of requirements.ordering ?? []) {
      const before = taskSlot(relation.beforeTaskId);
      const after = taskSlot(relation.afterTaskId);
      if (!before || !after) issues.push(`Ordering refers to a missing task: ${relation.beforeTaskId} or ${relation.afterTaskId}`);
      else if (before.start !== undefined && after.start !== undefined && before.start + before.item.durationMinutes > after.start) issues.push(`${before.item.task} must finish before ${after.item.task}`);
    }
    for (const gap of requirements.gaps ?? []) {
      const before = taskSlot(gap.afterTaskId);
      const after = taskSlot(gap.beforeTaskId);
      if (!before || !after) issues.push(`Gap refers to a missing task: ${gap.afterTaskId} or ${gap.beforeTaskId}`);
      else if (before.start !== undefined && after.start !== undefined && after.start - (before.start + before.item.durationMinutes) < gap.minMinutes) issues.push(`Leave ${gap.minMinutes} minutes between ${before.item.task} and ${after.item.task}`);
    }
    if (requirements.workload) {
      const { participants, minMinutes, maxMinutes, excludeTaskIds = [] } = requirements.workload;
      if (minMinutes > maxMinutes) issues.push("Workload minimum exceeds its maximum");
      for (const person of participants) {
        const total = slots.filter((slot) => !excludeTaskIds.includes(slot.item.taskId ?? "") && slot.people.some((assigned) => assigned.toLowerCase() === person.toLowerCase())).reduce((sum, slot) => sum + slot.item.durationMinutes, 0);
        if (total < minMinutes || total > maxMinutes) issues.push(`${person}: assign ${minMinutes}–${maxMinutes} minutes of work, not ${total}`);
      }
    }
  }

  // Literal checks catch common requests even when the interpreted checklist omits them.
  const userText = [...request.history.filter((entry) => entry.role === "user").map((entry) => entry.text), request.message].join(" ");
  const fixedCall = /\b([A-Za-z]+) has a fixed call from (\d{1,2}:\d{2}\s*[AP]M) to (\d{1,2}:\d{2}\s*[AP]M)/i.exec(userText);
  if (fixedCall) {
    const expectedStart = minutes(fixedCall[2]);
    const expectedEnd = minutes(fixedCall[3]);
    const match = slots.some((slot) => /\bcall\b/i.test(slot.item.task) && slot.people.some((person) => person.toLowerCase() === fixedCall[1].toLowerCase()) && slot.start === expectedStart && expectedStart !== undefined && expectedEnd !== undefined && slot.item.durationMinutes === expectedEnd - expectedStart);
    if (!match) issues.push(`Keep ${fixedCall[1]}'s call at ${fixedCall[2]} for the full fixed duration`);
  }
  const buffer = /\badd a (\d{1,2})-minute transition buffer\b/i.exec(request.message);
  if (buffer) {
    const needed = Number(buffer[1]);
    const hasGap = draft.participants.some((person) => {
      const ordered = slots.filter((slot) => slot.start !== undefined && slot.people.includes(person)).sort((a, b) => a.start! - b.start!);
      return ordered.some((slot, index) => index > 0 && slot.start! - (ordered[index - 1].start! + ordered[index - 1].item.durationMinutes) >= needed);
    });
    if (!hasGap) issues.push(`Add a real ${needed}-minute gap between scheduled activities`);
  }
  return issues;
}
