import type { ChatRequest, PlanDraft } from "../shared/contracts";

function minutes(time: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return undefined;
  return (hour % 12) * 60 + minute + (match[3].toUpperCase() === "PM" ? 720 : 0);
}

function assignedPeople(assignee: string, participants: string[]): string[] {
  if (/\b(all|everyone|family|household)\b/i.test(assignee)) return participants;
  return participants.filter((person) => {
    const escaped = person.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\W)${escaped}($|\\W)`, "i").test(assignee);
  });
}

export function scheduleIssues(draft: PlanDraft, request: ChatRequest): string[] {
  const issues: string[] = [];
  const slots = draft.items.map((item) => ({
    item,
    start: minutes(item.startTime),
    people: assignedPeople(item.assignee, draft.participants),
  }));

  for (const slot of slots) {
    if (slot.start === undefined) {
      issues.push(`${slot.item.task}: use a valid start time such as 6:30 PM`);
    }
  }

  for (let left = 0; left < slots.length; left += 1) {
    for (let right = left + 1; right < slots.length; right += 1) {
      const a = slots[left];
      const b = slots[right];
      if (a.start === undefined || b.start === undefined) continue;
      const samePeople = a.people.filter((person) => b.people.includes(person));
      if (
        samePeople.length > 0 &&
        a.start < b.start + b.item.durationMinutes &&
        b.start < a.start + a.item.durationMinutes
      ) {
        issues.push(`${a.item.task} and ${b.item.task} overlap for ${samePeople.join(", ")}`);
      }
    }
  }

  const userText = [...request.history.filter((entry) => entry.role === "user").map((entry) => entry.text), request.message].join(" ");
  const fixedCall = /\b([A-Za-z]+) has a fixed call from (\d{1,2}:\d{2}\s*[AP]M) to (\d{1,2}:\d{2}\s*[AP]M)/i.exec(userText);
  if (fixedCall) {
    const expectedStart = minutes(fixedCall[2]);
    const expectedEnd = minutes(fixedCall[3]);
    const match = slots.some((slot) =>
      /\bcall\b/i.test(slot.item.task) &&
      slot.people.some((person) => person.toLowerCase() === fixedCall[1].toLowerCase()) &&
      slot.start === expectedStart &&
      expectedStart !== undefined &&
      expectedEnd !== undefined &&
      slot.item.durationMinutes === expectedEnd - expectedStart,
    );
    if (!match) issues.push(`Keep ${fixedCall[1]}'s call at ${fixedCall[2]} for the full fixed duration`);
  }

  const buffer = /\badd a (\d{1,2})-minute transition buffer\b/i.exec(request.message);
  if (buffer) {
    const needed = Number(buffer[1]);
    const hasGap = draft.participants.some((person) => {
      const ordered = slots
        .filter((slot) => slot.start !== undefined && slot.people.includes(person))
        .sort((a, b) => a.start! - b.start!);
      return ordered.some((slot, index) => index > 0 &&
        slot.start! - (ordered[index - 1].start! + ordered[index - 1].item.durationMinutes) >= needed);
    });
    if (!hasGap) issues.push(`Add a real ${needed}-minute gap between scheduled activities`);
  }

  return issues;
}
