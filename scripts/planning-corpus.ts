import { DateTime } from "luxon";
import type { ChatRequest, HouseholdPlan } from "../shared/contracts";
import { presetScenarios } from "../src/presets";
import { scenarioRequirements } from "../shared/scenarios";

/** These expectations are authored from the prompts, never from the model's checklist. */
export type ExpectedTask = { match: string; date: string; duration?: number; people?: string[]; includes?: string[]; oneOf?: string[]; start?: string; earliest?: string; latest?: string };
export type CorpusCase = {
  id: string;
  request: ChatRequest;
  outcome: "plan" | "clarification" | "conflict";
  tasks?: ExpectedTask[];
  before?: Array<[string, string, number]>;
  exclusive?: Array<[string, string]>;
  parallel?: string[];
  captured?: Array<"availability" | "resources" | "assumptions">;
  expectedResources?: Array<{ match: string; capacity: number; tasks: string[] }>;
  expectedAvailability?: Array<{ participant: string; date: string; intervals: Array<[string, string]> }>;
};

const clock = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value);
  return match ? (Number(match[1]) % 12) * 60 + Number(match[2]) + (/PM/i.test(match[3]) ? 720 : 0) : NaN;
};
const people = (item: HouseholdPlan["items"][number], plan: HouseholdPlan) => /^(all|everyone|family|household)$/i.test(item.assignee.trim())
  ? plan.participants : item.assignee.split(/\s*(?:,|&|\+|\band\b)\s*/i);
const sameNames = (a: string[], b: string[]) => a.map((s) => s.toLowerCase()).sort().join("|") === b.map((s) => s.toLowerCase()).sort().join("|");
const task = (match: string, date: string, duration: number, names?: string[], extra: Partial<ExpectedTask> = {}): ExpectedTask => ({ match, date, duration, people: names, ...extra });

export function revisionFixture(date: string): HouseholdPlan {
  return {
    title: "Supply morning", objective: "Prepare supplies together", participants: ["Ada", "Ben", "Kit"],
    items: [
      { id: "snacks", taskId: "snacks", task: "Prepare snacks", assignee: "Ada", date, startTime: "9:00 AM", durationMinutes: 30 },
      { id: "supplies", taskId: "supplies", task: "Pack supplies", assignee: "Ben", date, startTime: "9:00 AM", durationMinutes: 25 },
      { id: "books", taskId: "books", task: "Sort books", assignee: "Kit", date, startTime: "9:00 AM", durationMinutes: 20 },
      { id: "review", taskId: "review", task: "Group review", assignee: "Ada, Ben, Kit", date, startTime: "9:30 AM", durationMinutes: 15 },
    ],
    requirements: {
      source: "interpreted", timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" },
      tasks: [
        { id: "snacks", label: "Prepare snacks", date, durationMinutes: 30, requiredParticipants: ["Ada"] },
        { id: "supplies", label: "Pack supplies", date, durationMinutes: 25, allowedParticipants: ["Ada", "Ben"] },
        { id: "books", label: "Sort books", date, durationMinutes: 20, requiredParticipants: ["Kit"] },
        { id: "review", label: "Group review", date, durationMinutes: 15, requiredParticipants: ["Ada", "Ben", "Kit"] },
      ],
      ordering: ["snacks", "supplies", "books"].map((beforeTaskId) => ({ beforeTaskId, afterTaskId: "review" })),
    },
    notes: [], version: 1, updatedAt: "2026-09-18T12:00:00.000Z",
  };
}

export function buildCorpus(now = DateTime.now().setZone("America/Chicago")): CorpusCase[] {
  const zone = "America/Chicago";
  const anchor = now.toISODate()!;
  const day = now.plus({ days: 3 }).toISODate()!;
  const next = now.plus({ days: 4 }).toISODate()!;
  const later = now.plus({ months: 1, days: 3 }).toISODate()!;
  const request = (message: string, currentPlan?: HouseholdPlan): ChatRequest => ({ message, history: [], planDate: day, timeZone: zone, currentPlan });
  const basic = (id: string, message: string, tasks: ExpectedTask[], extra: Partial<CorpusCase> = {}): CorpusCase => ({ id, request: request(message), outcome: "plan", tasks, ...extra });
  const base = revisionFixture(day);
  const baseTasks = [task("snack", day, 30, ["Ada"]), task("suppl", day, 25, ["Ben"]), task("book", day, 20, ["Kit"]), task("review", day, 15, ["Ada", "Ben", "Kit"])];
  const cases: CorpusCase[] = presetScenarios(anchor).map((preset) => {
    const scenarioId = preset.id as "weekday" | "chores" | "outing";
    return {
      id: `preset-${scenarioId}`, outcome: "plan", request: { message: preset.prompt, history: [], scenarioId, planDate: anchor, timeZone: zone },
      tasks: scenarioRequirements(scenarioId, anchor)!.tasks.map((entry) => ({ match: entry.id, date: entry.date!, duration: entry.durationMinutes, people: entry.atLeastOneOf ? undefined : entry.requiredParticipants, includes: entry.atLeastOneOf ? entry.requiredParticipants : undefined, oneOf: entry.atLeastOneOf, start: entry.fixedStartTime })),
    };
  });
  cases.push(
    basic("free-parallel", `Plan ${day}, 9–11 AM for Ada, Ben, and Kit. Ada prepares snacks for 30 minutes, Ben packs supplies for 25 minutes, Kit sorts books for 20 minutes. Do those jobs in parallel. Once all finish, everyone does a 15-minute group review. Leave unused time free.`, baseTasks,
      { parallel: ["snack", "suppl", "book"], before: [["snack", "review", 0], ["suppl", "review", 0], ["book", "review", 0]] }),
    basic("free-cross-month", `Plan ${day} and ${later}, 4–6 PM each day for Ava and Kai. On ${day}, Ava labels boxes for 30 minutes and Kai inventories books for 25 minutes. On ${later}, both unpack the kitchen for 40 minutes. Leave intervening days free.`, [task("box", day, 30, ["Ava"]), task("book", day, 25, ["Kai"]), task("kitchen", later, 40, ["Ava", "Kai"])]),
    basic("meal-shared-oven", `On ${day} from 4–6 PM, Ada bakes bread for 40 minutes and Ben roasts vegetables for 30 minutes. Both require the one oven for the whole task; it fits only one task at a time. Kit sets the table for 15 minutes independently.`, [task("bread", day, 40, ["Ada"]), task("vegetable", day, 30, ["Ben"]), task("\\btable\\b", day, 15, ["Kit"])], { exclusive: [["bread", "vegetable"]], captured: ["resources"] }),
    basic("laundry-resource", `On ${day} 9 AM–noon, Ada washes bedding for 45 minutes and Ben washes towels for 35 minutes. There is one washer, occupied for each whole task; the wash jobs cannot overlap. Each person folds their own load for 15 minutes afterward.`, [task("\\bwash(?:ing)?\\b.*bedding|bedding.*\\bwash(?:ing)?\\b", day, 45, ["Ada"]), task("\\bwash(?:ing)?\\b.*towel|towel.*\\bwash(?:ing)?\\b", day, 35, ["Ben"]), task("fold.*bedding|bedding.*fold", day, 15, ["Ada"]), task("fold.*towel|towel.*fold", day, 15, ["Ben"])], { exclusive: [["\\bwash(?:ing)?\\b.*bedding|bedding.*\\bwash(?:ing)?\\b", "\\bwash(?:ing)?\\b.*towel|towel.*\\bwash(?:ing)?\\b"]], before: [["\\bwash(?:ing)?\\b.*bedding|bedding.*\\bwash(?:ing)?\\b", "fold.*bedding|bedding.*fold", 0], ["\\bwash(?:ing)?\\b.*towel|towel.*\\bwash(?:ing)?\\b", "fold.*towel|towel.*fold", 0]], captured: ["resources"] }),
    basic("caregiving-handoff", `On ${day} 10 AM–noon, Noor and Jo take a 30-minute walk, then Jo needs a 15-minute seated rest. After that Noor and Eli do a 10-minute care handoff. Noor is available only 10–11 AM, Eli only 10:45 AM–noon, Jo 10 AM–noon.`, [task("walk", day, 30, ["Noor", "Jo"], { latest: "11:00 AM" }), task("rest", day, 15, ["Jo"]), task("handoff", day, 10, ["Noor", "Eli"], { earliest: "10:45 AM", latest: "11:00 AM" })], { before: [["walk", "rest", 0], ["rest", "handoff", 0]], captured: ["availability"] }),
    basic("school-transport", `On ${day} 2–5 PM, Alex drives to school for 20 minutes, picks up Sam at exactly 3 PM for 10 minutes, then both travel home for 20 minutes. After arriving home, Sam does 30 minutes of homework. Keep the pickup fixed.`, [task("(?:drive|travel).*school|school.*(?:drive|travel)", day, 20, ["Alex"], { latest: "3:00 PM" }), task("pickup|pick.up", day, 10, ["Alex", "Sam"], { start: "3:00 PM" }), task("home.*travel|travel.*home|return", day, 20, ["Alex", "Sam"]), task("homework", day, 30, ["Sam"])], { before: [["(?:drive|travel).*school|school.*(?:drive|travel)", "pickup|pick.up", 0], ["pickup|pick.up", "home.*travel|travel.*home|return", 0], ["home.*travel|travel.*home|return", "homework", 0]] }),
    basic("roommate-eligibility", `On ${day} 9–11 AM, divide three chores between Ada and Ben: vacuum 30 minutes, dishes 20 minutes, recycling 10 minutes. Ada is available only 9–9:30 AM and cannot vacuum. Ben is available 9–11 AM. Assign each chore once, prioritize balanced workload.`, [task("vacuum", day, 30, ["Ben"]), task("dish", day, 20), task("recycl", day, 10)], { captured: ["availability"] }),
    basic("solo-routine", `Plan ${day} 8–11 AM for Maya: 25 minutes of stretching, a fixed 30-minute call at 9 AM, and 20 minutes packing lunch. Finish the packing before the call, and keep all three activities.`, [task("stretch", day, 25, ["Maya"]), task("call", day, 30, ["Maya"], { start: "9:00 AM" }), task("lunch|pack", day, 20, ["Maya"], { latest: "9:00 AM" })], { before: [["lunch|pack", "call", 0]] }),
    basic("gathering", `On ${day} 3–5 PM, Ada makes decorations for 30 minutes, Ben prepares snacks for 25 minutes, and Kit arranges chairs for 15 minutes. Work independently, then all three do a 20-minute final setup together.`, [task("decoration", day, 30, ["Ada"]), task("snack", day, 25, ["Ben"]), task("chair", day, 15, ["Kit"]), task("setup", day, 20, ["Ada", "Ben", "Kit"])], { parallel: ["decoration", "snack", "chair"], before: [["decoration", "setup", 0], ["snack", "setup", 0], ["chair", "setup", 0]] }),
    basic("availability", `On ${day} 9 AM–noon, Ava is available only 10 AM–noon and Kai only 9–10 AM. Ava cleans the kitchen for 45 minutes. Kai sorts the pantry for 30 minutes.`, [task("kitchen", day, 45, ["Ava"], { earliest: "10:00 AM" }), task("pantry", day, 30, ["Kai"], { latest: "10:00 AM" })], { captured: ["availability"] }),
    basic("split-availability", `On ${day} 9 AM–noon, Ada is available 9–9:30 AM and 11 AM–noon, unavailable in between. Ada does a 30-minute pharmacy errand and 45-minute meal preparation. Ben is available throughout and waters plants for 20 minutes.`, [task("pharmacy", day, 30, ["Ada"], { latest: "9:30 AM" }), task("meal", day, 45, ["Ada"], { earliest: "11:00 AM" }), task("plant", day, 20, ["Ben"])], { captured: ["availability"] }),
    basic("shared-car", `On ${day} 9 AM–noon, Ada has a 40-minute grocery trip and Ben a 30-minute parcel drop-off trip. Both need the household's one car for the entire trip, so they cannot overlap. Kit reads for 25 minutes at home.`, [task("grocer", day, 40, ["Ada"]), task("parcel", day, 30, ["Ben"]), task("read", day, 25, ["Kit"])], { exclusive: [["grocer", "parcel"]], captured: ["resources"] }),
    basic("visible-assumptions", `On ${day} 5–7 PM Ada prepares a simple dinner and Ben sets the table. I don't know the durations; estimate them and explicitly label the estimates as assumptions. No other commitments.`, [{ match: "dinner", date: day, people: ["Ada"] }, { match: "table", date: day, people: ["Ben"] }], { captured: ["assumptions"] }),
    basic("dated-windows", `On ${day}, Ada and Ben pack supplies together for 30 minutes between 9–10 AM. On ${next}, Ada waters plants for 20 minutes between 4–5 PM and Ben sorts books for 25 minutes in that same afternoon window.`, [task("suppl", day, 30, ["Ada", "Ben"], { earliest: "9:00 AM", latest: "10:00 AM" }), task("plant", next, 20, ["Ada"], { earliest: "4:00 PM", latest: "5:00 PM" }), task("book", next, 25, ["Ben"], { earliest: "4:00 PM", latest: "5:00 PM" })]),
    basic("repeated-labels", `On ${day}, Ada has Reading for 20 minutes at exactly 9 AM. On ${next}, Ada has Reading for 25 minutes at exactly 10 AM. Use two separate tasks with distinct stable IDs. Available 9–11 AM each day.`, [task("read", day, 20, ["Ada"], { start: "9:00 AM" }), task("read", next, 25, ["Ada"], { start: "10:00 AM" })]),
  );
  // Keep at least an hour of lead time: the earlier cases can take minutes,
  // and rounding down must not turn this feasible request into a past event.
  const soon = now.plus({ hours: 2 }).startOf("hour");
  const sameDay = soon.hour < 21 ? soon : now.plus({ days: 1 }).set({ hour: 9, minute: 0 });
  cases.push(basic("remaining-day", `Plan ${sameDay.toISODate()} for Ada from ${sameDay.toFormat("h:mm a")} to ${sameDay.plus({ hours: 2 }).toFormat("h:mm a")}. Ada sorts mail for 15 minutes, then packs a bag for 20 minutes. Only schedule within this future window.`, [task("mail", sameDay.toISODate()!, 15, ["Ada"], { earliest: sameDay.toFormat("h:mm a") }), task("bag", sameDay.toISODate()!, 20, ["Ada"])], { before: [["mail", "bag", 0]] }));
  const names = Array.from({ length: 20 }, (_, i) => `Task${String(i + 1).padStart(2, "0")}`);
  cases.push(basic("maximum-tasks", `On ${day} 9 AM–noon, Ada completes these 20 independent tasks, each lasting 5 minutes: ${names.join(", ")}. Include each exactly once; leave unused time free.`, names.map((name) => task(name, day, 5, ["Ada"]))));
  cases.push({ id: "missing-information", outcome: "clarification", request: request("Can you make a household schedule?") });
  const repeated = structuredClone(base);
  repeated.items[0].task = "Reading"; repeated.items[1].task = "Reading";
  repeated.requirements!.tasks[0].label = "Reading"; repeated.requirements!.tasks[1].label = "Reading";
  cases.push({ id: "ambiguous-target", outcome: "clarification", request: request("Move Reading to 10 AM.", repeated) });
  cases.push({ id: "infeasible-fixed", outcome: "conflict", request: request(`On ${day}, Ada alone must attend a 60-minute call at exactly 9 AM and a 30-minute appointment at exactly 9:15 AM. Both are fixed and require Ada throughout. Available 9–11 AM. Do not change either time.`) });
  cases.push({ id: "infeasible-duration", outcome: "conflict", request: request(`On ${day} Ada has only 9–10 AM. Ada must clean the kitchen for 45 minutes and do dishes for 30 minutes. Both require Ada the entire time, cannot overlap or shorten. No other participants.`) });
  cases.push(
    basic("revision-exact-start", "Set the start of Pack supplies to 9:40 AM. Preserve other requirements and move the review later if needed.", baseTasks.map((entry) => entry.match === "suppl" ? { ...entry, start: "9:40 AM" } : entry), { request: request("Set the start of Pack supplies to 9:40 AM. Preserve other requirements and move the review later if needed.", base) }),
    basic("revision-assignee", "Assign Pack supplies to Ada instead of Ben. Keep all activities and dependencies.", baseTasks.map((entry) => entry.match === "suppl" ? { ...entry, people: ["Ada"] } : entry), { request: request("Assign Pack supplies to Ada instead of Ben. Keep all activities and dependencies.", base) }),
    basic("revision-cancel", "Cancel Sort books. Remove its dependency on the group review, keep all other tasks and constraints.", baseTasks.filter((entry) => entry.match !== "book"), { request: request("Cancel Sort books. Remove its dependency on the group review, keep all other tasks and constraints.", base) }),
    basic("revision-add", "Add a 10-minute Water plants activity for Kit before the group review. Keep all existing tasks and requirements.", [...baseTasks, task("plant", day, 10, ["Kit"])], { request: request("Add a 10-minute Water plants activity for Kit before the group review. Keep all existing tasks and requirements.", base), before: [["plant", "review", 0]] }),
    basic("revision-availability", "Ben is now available only from 10 AM to 11 AM. Reschedule his work and the group review within that availability. Preserve every task and assignment.", baseTasks.map((entry) => ["suppl", "review"].includes(entry.match) ? { ...entry, earliest: "10:00 AM" } : entry), { request: request("Ben is now available only from 10 AM to 11 AM. Reschedule his work and the group review within that availability. Preserve every task and assignment.", base), captured: ["availability"] }),
  );
  const elapsed = revisionFixture(day);
  const yesterday = now.minus({ days: 1 }).toISODate()!;
  elapsed.items[0].date = yesterday;
  elapsed.requirements!.tasks[0].date = yesterday;
  cases.push(basic("revision-elapsed-history", "Move Pack supplies to 9:40 AM. Keep the already completed Prepare snacks unchanged, and move the group review later if needed.", baseTasks.map((entry) => entry.match === "snack" ? { ...entry, date: yesterday, start: "9:00 AM" } : entry.match === "suppl" ? { ...entry, start: "9:40 AM" } : entry), { request: request("Move Pack supplies to 9:40 AM. Keep the already completed Prepare snacks unchanged, and move the group review later if needed.", elapsed) }));
  const resourceCases = [
    { id: "meal-shared-oven", match: "oven", tasks: ["bread", "vegetable"] },
    { id: "laundry-resource", match: "washer|washing machine", tasks: ["\\bwash(?:ing)?\\b.*bedding|bedding.*\\bwash(?:ing)?\\b", "\\bwash(?:ing)?\\b.*towel|towel.*\\bwash(?:ing)?\\b"] },
    { id: "shared-car", match: "car", tasks: ["grocer", "parcel"] },
  ];
  for (const { id, match, tasks } of resourceCases) cases.find((entry) => entry.id === id)!.expectedResources = [{ match, tasks, capacity: 1 }];
  const availabilityCases: Array<[string, string, Array<[string, string]>]> = [
    ["caregiving-handoff", "Noor", [["10:00 AM", "11:00 AM"]]],
    ["caregiving-handoff", "Eli", [["10:45 AM", "12:00 PM"]]],
    ["caregiving-handoff", "Jo", [["10:00 AM", "12:00 PM"]]],
    ["roommate-eligibility", "Ada", [["9:00 AM", "9:30 AM"]]],
    ["availability", "Ava", [["10:00 AM", "12:00 PM"]]],
    ["availability", "Kai", [["9:00 AM", "10:00 AM"]]],
    ["split-availability", "Ada", [["9:00 AM", "9:30 AM"], ["11:00 AM", "12:00 PM"]]],
    ["revision-availability", "Ben", [["10:00 AM", "11:00 AM"]]],
  ];
  for (const [id, participant, intervals] of availabilityCases) {
    const entry = cases.find((entry) => entry.id === id)!;
    entry.expectedAvailability = [...(entry.expectedAvailability ?? []), { participant, date: day, intervals }];
  }
  return cases;
}

export function assessPlan(entry: CorpusCase, plan: HouseholdPlan): { hardIssues: string[]; qualityIssues: string[]; coverage: number; changedExistingActivities: number } {
  const hardIssues: string[] = [];
  const qualityIssues: string[] = [];
  const matched = new Set<string>();
  const find = (pattern: string, date?: string) => plan.items.find((item) => (!date || item.date === date) && (entry.id.startsWith("preset-") ? item.taskId === pattern : new RegExp(pattern, "i").test(item.task)));
  for (const [index, expected] of (entry.tasks ?? []).entries()) {
    const found = find(expected.match, expected.date);
    if (!found || matched.has(found.id)) { hardIssues.push(`task-${index + 1}:missing-or-duplicate`); continue; }
    matched.add(found.id);
    if (expected.duration !== undefined && found.durationMinutes !== expected.duration) hardIssues.push(`task-${index + 1}:duration`);
    if (expected.people && !sameNames(people(found, plan), expected.people)) hardIssues.push(`task-${index + 1}:assignees`);
    const assigned = people(found, plan).map((name) => name.toLowerCase());
    if (expected.includes?.some((name) => !assigned.includes(name.toLowerCase())) || expected.oneOf && !expected.oneOf.some((name) => assigned.includes(name.toLowerCase()))) hardIssues.push(`task-${index + 1}:required-or-alternative-assignee`);
    const start = clock(found.startTime);
    if (!Number.isFinite(start)) hardIssues.push(`task-${index + 1}:clock`);
    if (expected.start && start !== clock(expected.start)) hardIssues.push(`task-${index + 1}:fixed-start`);
    if (expected.earliest && start < clock(expected.earliest)) hardIssues.push(`task-${index + 1}:earliest`);
    if (expected.latest && start + found.durationMinutes > clock(expected.latest)) hardIssues.push(`task-${index + 1}:latest`);
  }
  if (entry.tasks && plan.items.length !== entry.tasks.length) hardIssues.push("activity-count");
  for (const [a, b, gap] of entry.before ?? []) {
    const first = find(a); const second = find(b);
    if (!first || !second || first.date !== second.date || clock(second.startTime) < clock(first.startTime) + first.durationMinutes + gap) hardIssues.push("required-order-or-gap");
  }
  for (let i = 0; i < plan.items.length; i += 1) for (let j = i + 1; j < plan.items.length; j += 1) {
    const a = plan.items[i]; const b = plan.items[j];
    const overlap = a.date === b.date && clock(a.startTime) < clock(b.startTime) + b.durationMinutes && clock(b.startTime) < clock(a.startTime) + a.durationMinutes;
    if (overlap && people(a, plan).some((name) => people(b, plan).includes(name))) hardIssues.push("person-double-booked");
  }
  for (const [a, b] of entry.exclusive ?? []) {
    const first = find(a); const second = find(b);
    if (!first || !second || first.date === second.date && clock(first.startTime) < clock(second.startTime) + second.durationMinutes && clock(second.startTime) < clock(first.startTime) + first.durationMinutes) hardIssues.push("shared-resource-overlap");
  }
  if (entry.parallel) {
    const starts = entry.parallel.map((pattern) => find(pattern)).filter(Boolean).map((item) => item!.startTime);
    if (new Set(starts).size === starts.length) qualityIssues.push("independent-work-not-parallelized");
  }
  for (const field of entry.captured ?? []) if (!plan.requirements?.[field]?.length) qualityIssues.push(`missing-displayed-${field}`);
  for (const [index, expected] of (entry.expectedResources ?? []).entries()) {
    const resource = plan.requirements?.resources?.find((entry) => new RegExp(expected.match, "i").test(`${entry.id} ${entry.label}`));
    if (!resource || resource.capacity !== expected.capacity || expected.tasks.some((pattern) => {
      const item = find(pattern);
      return !item || !plan.requirements?.tasks.find((task) => task.id === item.taskId)?.resources?.some((use) => use.resourceId === resource.id && use.units === 1);
    })) qualityIssues.push(`resource-${index + 1}:captured-capacity-or-use`);
  }
  for (const [index, expected] of (entry.expectedAvailability ?? []).entries()) {
    const actual = (plan.requirements?.availability ?? []).filter((entry) => entry.participant.toLowerCase() === expected.participant.toLowerCase() && (!entry.date || entry.date === expected.date));
    const intervals = (values: Array<[string, string]>) => [...new Set(values.map(([start, end]) => `${clock(start)}-${clock(end)}`))].sort().join("|");
    if (intervals(actual.map((entry) => [entry.startTime, entry.endTime])) !== intervals(expected.intervals)) qualityIssues.push(`availability-${index + 1}:captured-window`);
  }
  const changedExistingActivities = entry.request.currentPlan?.items.filter((old) => {
    const next = plan.items.find((item) => item.taskId === old.taskId);
    return !next || old.date !== next.date || old.startTime !== next.startTime || old.durationMinutes !== next.durationMinutes || old.assignee !== next.assignee;
  }).length ?? 0;
  return { hardIssues: [...new Set(hardIssues)], qualityIssues, coverage: entry.tasks?.length ? matched.size / entry.tasks.length : 1, changedExistingActivities };
}
