import type { HouseholdPlan, PlanRequirements } from "../shared/contracts";
import { planRequirementsSchema } from "../shared/contracts";
import { requirementsIssues } from "./requirements";

function normalize(value: string): string {
  return value.toLowerCase().replace(/[“”"'’]/g, "").replace(/[-_]/g, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");
}

function namedTask(plan: HouseholdPlan, name: string) {
  const target = normalize(name);
  const matches = plan.requirements!.tasks.filter((task) => [task.id, task.label].some((alias) => {
    const normalized = normalize(alias);
    return target.length >= 3 && (normalized === target || normalized.endsWith(` ${target}`));
  }));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Recognize one exact named gap, never an implicit target or an extra mutation. */
export function explicitGapRequirements(plan: HouseholdPlan, message: string): PlanRequirements | undefined {
  if (!plan.requirements) return undefined;
  const parts = message.trim().replace(/[.!?]+$/, "").split(/[.!?]\s+/);
  const match = /^(?:please\s+)?add\s+(?:a\s+)?(\d{1,3})[-\s]+minute\s+(?:transition\s+)?(?:buffer|gap)\s+after\s+(.+?)\s+and\s+before\s+(.+)$/i.exec(parts[0]);
  if (!match) return undefined;
  const minMinutes = Number(match[1]);
  if (minMinutes < 1 || minMinutes > 120) return undefined;
  const after = namedTask(plan, match[2]);
  const before = namedTask(plan, match[3]);
  if (!after || !before || after.id === before.id) return undefined;
  for (const supplement of parts.slice(1)) {
    if (/^(?:keep|preserve) (?:all )?(?:other|existing|current) requirements$/i.test(supplement)) continue;
    const preservation = /^(?:keep|preserve) the accepted (\d{1,3})-minute (.+?) duration and all other requirements$/i.exec(supplement);
    const task = preservation && namedTask(plan, preservation[2]);
    if (!task || task.durationMinutes !== Number(preservation![1])) return undefined;
  }
  const requirements = structuredClone(plan.requirements);
  requirements.source = "interpreted";
  const existing = requirements.gaps?.find((gap) => gap.afterTaskId === after.id && gap.beforeTaskId === before.id);
  // Adding a buffer never weakens an already accepted, larger minimum.
  if (existing) existing.minMinutes = Math.max(existing.minMinutes, minMinutes);
  else requirements.gaps = [...(requirements.gaps ?? []), { afterTaskId: after.id, beforeTaskId: before.id, minMinutes }];
  const parsed = planRequirementsSchema.safeParse(requirements);
  return parsed.success && !requirementsIssues(parsed.data, plan.participants).length ? parsed.data : undefined;
}
