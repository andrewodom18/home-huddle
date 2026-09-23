/**
 * Bounded local-only response-quality campaign. Run with:
 *   npx tsx scripts/live-corpus.ts
 *
 * The prompts are fictional. Never print requests or full responses: output is a
 * deliberately redacted scorecard. This talks only to the local API, never to
 * the public Lambda. Each of 14 serial requests permits at most three Converse
 * calls, for a campaign ceiling of 42 calls including server-side repairs.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { planDraftSchema, householdPlanSchema, type ChatRequest, type ChatResponse, type HouseholdPlan } from "../shared/contracts";
import { SCENARIO_REQUIREMENTS } from "../shared/scenarios";
import { minutes, scheduleIssues, assignedPeople } from "../server/scheduleValidation";
import { PRESET_SCENARIOS } from "../src/presets";

const ENDPOINT = "http://127.0.0.1:8787/api/chat";
const HEALTH = "http://127.0.0.1:8787/api/health";
const MAX_REQUESTS = 14;
const MAX_CALLS_PER_REQUEST = 3;
const OUTPUT = "output/live-corpus";
const selectedCases = process.env.HOME_HUDDLE_CASES ? new Set(process.env.HOME_HUDDLE_CASES.split(",")) : undefined;
type Result = { id: string; outcome: "pass" | "fail" | "blocked"; detail: string; latencyMs: number; converseCalls: string; repairCalls: string };
const results: Result[] = [];
let requestCount = 0;
let possibleCalls = 0;
let knownCalls = 0;
let unknownCallRequests = 0;
let previousUpperBound = 0;

const fixture: HouseholdPlan = {
  title: "Supply morning", objective: "Finish a small household preparation together",
  participants: ["Ada", "Ben", "Kit"],
  items: [
    { id: "task-snacks", taskId: "snacks", date: "2026-09-28", startTime: "9:00 AM", durationMinutes: 30, task: "Prepare snacks", assignee: "Ada" },
    { id: "task-supplies", taskId: "supplies", date: "2026-09-28", startTime: "9:00 AM", durationMinutes: 25, task: "Pack supplies", assignee: "Ben" },
    { id: "task-books", taskId: "books", date: "2026-09-28", startTime: "9:00 AM", durationMinutes: 20, task: "Sort books", assignee: "Kit" },
    { id: "task-review", taskId: "review", date: "2026-09-28", startTime: "9:30 AM", durationMinutes: 15, task: "Group review", assignee: "Ada, Ben, Kit" },
  ],
  requirements: {
    source: "interpreted", timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" },
    tasks: [
      { id: "snacks", date: "2026-09-28", label: "Prepare snacks", durationMinutes: 30, requiredParticipants: ["Ada"] },
      { id: "supplies", date: "2026-09-28", label: "Pack supplies", durationMinutes: 25, requiredParticipants: ["Ben"] },
      { id: "books", date: "2026-09-28", label: "Sort books", durationMinutes: 20, requiredParticipants: ["Kit"] },
      { id: "review", date: "2026-09-28", label: "Group review", durationMinutes: 15, requiredParticipants: ["Ada", "Ben", "Kit"] },
    ],
    ordering: [
      { beforeTaskId: "snacks", afterTaskId: "review" },
      { beforeTaskId: "supplies", afterTaskId: "review" },
      { beforeTaskId: "books", afterTaskId: "review" },
    ],
  },
  notes: [], version: 1, updatedAt: "2026-09-17T00:00:00.000Z",
};

function safeError(value: unknown): string {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: { code?: string } }).error;
    return error?.code ?? "API_ERROR";
  }
  return "API_ERROR";
}

/** Classify server error text in memory; never emit its raw contents. */
function safeFailureCategory(value: unknown): string {
  const message = value && typeof value === "object" && "error" in value
    ? (value as { error?: { message?: unknown } }).error?.message : undefined;
  if (typeof message !== "string") return "not available";
  const categories: Array<[string, RegExp]> = [
    ["stable-task coverage", /task id|task checklist|schedule exactly once|missing task|duplicate/i],
    ["date constraint", /date|YYYY-MM-DD|multi-day/i],
    ["time window", /time window|starts before|finish by|planning window/i],
    ["overlap", /overlap|double.book/i],
    ["assignee constraint", /assign|participant|include one of/i],
    ["duration constraint", /duration|minute duration/i],
    ["ordering dependency", /must finish before|ordering/i],
    ["transition gap", /gap|buffer|between scheduled/i],
    ["revision fidelity", /requested|move exactly|move to/i],
    ["checklist preservation", /established requirement|preserve|checklist correction/i],
    ["missing tool response", /not published and checked/i],
    ["schema or tool shape", /missing required fields|invalid tool|tool data/i],
    ["uncaptured interpreted checklist", /free-text requirements|interpreted requirements|captured requirements/i],
    ["invalid clock format", /valid start time|valid time such as|valid start and end times/i],
    ["generic validation fallback", /did not satisfy its requirements/i],
  ];
  return categories.find(([, pattern]) => pattern.test(message))?.[0] ?? "other validation issue";
}

function validatePlan(plan: unknown, request: ChatRequest): { plan?: HouseholdPlan; issues: string[] } {
  const parsed = householdPlanSchema.safeParse(plan);
  if (!parsed.success) return { issues: ["published plan fails schema"] };
  const draft = planDraftSchema.safeParse(parsed.data);
  if (!draft.success) return { issues: ["published plan cannot be validated as a draft"] };
  return { plan: parsed.data, issues: scheduleIssues(draft.data, request, parsed.data.requirements) };
}

function hasTask(plan: HouseholdPlan, pattern: RegExp): boolean {
  return Boolean(plan.requirements?.tasks.some((task) => pattern.test(task.label)));
}

function coherent(response: ChatResponse): boolean {
  return response.meta.toolUsed === Boolean(response.plan)
    && !(response.plan && /couldn.t publish|couldn.t make|failed to/i.test(response.reply));
}

async function run(
  id: string,
  request: ChatRequest,
  assess: (response: ChatResponse | undefined, status: number, issues: string[]) => string[],
): Promise<HouseholdPlan | undefined> {
  if (selectedCases && !selectedCases.has(id)) return undefined;
  if (requestCount >= MAX_REQUESTS || previousUpperBound + possibleCalls + MAX_CALLS_PER_REQUEST > 42) throw new Error("Campaign call ceiling reached");
  requestCount += 1;
  possibleCalls += MAX_CALLS_PER_REQUEST;
  // Reserve the worst case before each request so an interrupted or repeated
  // run cannot silently exceed the campaign cap.
  await writeFile(`${OUTPUT}/campaign-ledger.json`, JSON.stringify({ reservedCallCeiling: previousUpperBound + possibleCalls, hardCap: 42 }, null, 2));
  const started = performance.now();
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(request), signal: AbortSignal.timeout(110_000),
    });
    const body: unknown = await response.json();
    const reply = response.ok ? body as ChatResponse : undefined;
    const validation = reply?.plan ? validatePlan(reply.plan, request) : { issues: [] as string[] };
    const issues = [...validation.issues, ...assess(reply, response.status, validation.issues)];
    if (reply && !coherent(reply)) issues.push("reply/tool/calendar mismatch");
    const detail = issues.length ? `${issues.join("; ")} (HTTP ${response.status}, ${response.ok ? "OK" : safeError(body)}, category: ${response.ok ? "not applicable" : safeFailureCategory(body)})` : (response.ok ? "Expected outcome and validated calendar" : `Expected safe rejection (${safeError(body)})`);
    const outcome = issues.length ? "fail" : "pass";
    const calls = reply?.meta.callCount ?? (response.status === 400 && safeError(body) === "VALIDATION" ? 0 : undefined);
    if (calls === undefined) unknownCallRequests += 1;
    else knownCalls += calls;
    results.push({ id, outcome, detail, latencyMs: Math.round(performance.now() - started), converseCalls: calls === undefined ? "unknown (0–3)" : String(calls), repairCalls: calls === undefined ? "unknown (0–2)" : String(Math.max(0, calls - 1)) });
    process.stdout.write(`${id}: ${outcome}\n`);
    return validation.plan;
  } catch (error) {
    unknownCallRequests += 1;
    const detail = error instanceof Error && error.name === "TimeoutError" ? "Local API timeout" : "Local API unavailable or response malformed";
    results.push({ id, outcome: "blocked", detail, latencyMs: Math.round(performance.now() - started), converseCalls: "unknown (0–3)", repairCalls: "unknown (0–2)" });
    process.stdout.write(`${id}: blocked\n`);
    return undefined;
  }
}

function expectsPlan(response: ChatResponse | undefined, status: number): string[] {
  return status === 200 && response?.plan && response.meta.toolUsed ? [] : ["expected a tool-published plan"];
}

function expectsNoPlan(response: ChatResponse | undefined, status: number): string[] {
  return status === 200 && response && !response.plan && !response.meta.toolUsed && response.reply.trim() ? [] : ["expected a direct answer or clarification without a plan"];
}

function expectsRejection(response: ChatResponse | undefined, status: number): string[] {
  return status === 400 && !response ? [] : ["expected a safe 400 rejection before publication"];
}

function item(plan: HouseholdPlan, id: string) { return plan.items.find((entry) => entry.taskId === id); }
function samePeople(actual: string, expected: string[], plan: HouseholdPlan) {
  const names = assignedPeople(actual, plan.participants);
  return names.length === expected.length && expected.every((name) => names.includes(name));
}

async function main() {
  if (process.env.HOME_HUDDLE_LIVE_CORPUS !== "1") throw new Error("Set HOME_HUDDLE_LIVE_CORPUS=1 to authorize this bounded local run");
  const health = await fetch(HEALTH, { signal: AbortSignal.timeout(5_000) });
  const state = await health.json() as { status?: string; bedrockConfigured?: boolean };
  if (!health.ok || state.status !== "ok" || state.bedrockConfigured !== true) throw new Error("Local Bedrock API is not ready; no requests sent");
  await mkdir(OUTPUT, { recursive: true });
  try {
    const ledger = JSON.parse(await readFile(`${OUTPUT}/campaign-ledger.json`, "utf8")) as { reservedCallCeiling?: number };
    previousUpperBound = ledger.reservedCallCeiling ?? 42;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    for (const name of ["results.json", "recheck.json"]) {
      try {
        const previous = JSON.parse(await readFile(`${OUTPUT}/${name}`, "utf8")) as { actualCallRange?: [number, number] };
        previousUpperBound += previous.actualCallRange?.[1] ?? 42;
      } catch (readError) {
        if (!(readError instanceof Error && "code" in readError && readError.code === "ENOENT")) throw readError;
      }
    }
  }
  if (selectedCases) {
    await readFile(`${OUTPUT}/results.json`, "utf8");
    if (previousUpperBound >= 42) throw new Error("No campaign call allowance remains");
  } else {
    try {
      await readFile(`${OUTPUT}/results.json`, "utf8");
      throw new Error("A campaign result already exists; use HOME_HUDDLE_CASES for a bounded targeted recheck");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }

  const presetPlans: Partial<Record<string, HouseholdPlan>> = {};
  for (const preset of PRESET_SCENARIOS) {
    const request: ChatRequest = { message: preset.prompt, history: [], scenarioId: preset.id as "weekday" | "chores" | "outing", planDate: preset.id === "chores" ? "2026-09-26" : undefined };
    presetPlans[preset.id] = await run(`preset-${preset.id}`, request, (response, status) => {
      const issues = expectsPlan(response, status);
      if (response?.plan) {
        const required = SCENARIO_REQUIREMENTS[request.scenarioId!];
        if (response.plan.items.length !== required.tasks.length) issues.push("preset task coverage mismatch");
        if (required.tasks.some((task) => !item(response.plan!, task.id))) issues.push("missing stable preset task ID");
        if (response.plan.requirements?.source !== "scenario") issues.push("preset checklist source changed");
      }
      return issues;
    });
  }

  const parallelRequest: ChatRequest = {
    message: "Plan September 28, 2026, 9:00–11:00 AM for Ada, Ben, and Kit. Ada prepares snacks for 30 minutes, Ben packs supplies for 25 minutes, and Kit sorts books for 20 minutes. They may do those three jobs at the same time. After all three finish, everyone does a 15-minute group review. Leave unused time free.",
    history: [], planDate: "2026-09-28",
  };
  const parallelPlan = await run("free-parallel", parallelRequest, (response, status) => {
    const issues = expectsPlan(response, status);
    const plan = response?.plan;
    if (plan) {
      if (![ /snack/i, /suppl/i, /book/i, /review/i ].every((pattern) => hasTask(plan, pattern))) issues.push("missing a requested task in checklist");
      const starts = plan.items.filter((entry) => !/review/i.test(entry.task)).map((entry) => minutes(entry.startTime));
      if (starts.length < 3 || new Set(starts).size === starts.length) issues.push("independent work was not parallelized");
      if (!plan.requirements?.ordering || plan.requirements.ordering.length < 3) issues.push("dependency not captured in checklist");
    }
    return issues;
  });

  const crossRequest: ChatRequest = {
    message: "Plan for Ava and Kai on October 2 and November 2, 2026, from 4:00 PM to 6:00 PM on each date. On October 2, Ava labels moving boxes for 30 minutes and Kai inventories books for 25 minutes. On November 2, both people unpack the kitchen together for 40 minutes. Date every event explicitly; leave the days between free.",
    history: [],
  };
  await run("free-cross-month", crossRequest, (response, status) => {
    const issues = expectsPlan(response, status);
    const plan = response?.plan;
    if (plan) {
      const dates = new Set(plan.items.map((entry) => entry.date));
      if (!dates.has("2026-10-02") || !dates.has("2026-11-02") || dates.size !== 2) issues.push("cross-month dates not preserved");
      if (![ /box/i, /book/i, /kitchen/i ].every((pattern) => hasTask(plan, pattern))) issues.push("missing a requested task in checklist");
    }
    return issues;
  });

  await run("missing-information", { message: "Can you make a household schedule?", history: [] }, expectsNoPlan);
  await run("unrelated-question", { message: "What is the capital of France?", history: [] }, expectsNoPlan);

  const base = parallelPlan && item(parallelPlan, "supplies") && item(parallelPlan, "review") ? parallelPlan : fixture;
  const fixed = structuredClone(base);
  const supplies = item(fixed, "supplies")!;
  fixed.requirements!.tasks.find((task) => task.id === "supplies")!.fixedStartTime = supplies.startTime;
  await run("impossible-fixed-edit", { message: `Set the start of ${supplies.task} to 10:30 AM`, history: [], currentPlan: fixed, planDate: "2026-09-28" }, expectsRejection);
  await run("ambiguous-event-edit", { message: `Move ${supplies.task} and ${item(base, "review")!.task} 15 minutes later`, history: [], currentPlan: base, planDate: "2026-09-28" }, expectsRejection);

  const dateBase = presetPlans.outing ?? base;
  const dateTask = item(dateBase, "library") ?? item(dateBase, "supplies")!;
  const targetDate = dateTask.taskId === "library" ? "2026-09-25" : "2026-09-29";
  await run("revision-exact-date", { message: `Move ${dateTask.task} to ${targetDate}`, history: [], currentPlan: dateBase, planDate: dateTask.date }, (response, status) => {
    const issues = expectsPlan(response, status);
    if (response?.plan && item(response.plan, dateTask.taskId!)?.date !== targetDate) issues.push("requested event date missing");
    return issues;
  });
  await run("revision-exact-start", { message: `Set the start of ${supplies.task} to 9:40 AM`, history: [], currentPlan: base, planDate: "2026-09-28" }, (response, status) => {
    const issues = expectsPlan(response, status);
    if (response?.plan && minutes(item(response.plan, "supplies")?.startTime ?? "") !== minutes("9:40 AM")) issues.push("requested start missing");
    return issues;
  });
  await run("revision-duration", { message: `Set the duration of ${supplies.task} to 35 minutes`, history: [], currentPlan: base, planDate: "2026-09-28" }, (response, status) => {
    const issues = expectsPlan(response, status);
    if (response?.plan && item(response.plan, "supplies")?.durationMinutes !== 35) issues.push("requested duration missing");
    return issues;
  });
  const assigneeBase = structuredClone(base);
  delete assigneeBase.requirements!.tasks.find((task) => task.id === "supplies")!.requiredParticipants;
  await run("revision-assignee", { message: `Assign ${supplies.task} to Ada`, history: [], currentPlan: assigneeBase, planDate: "2026-09-28" }, (response, status) => {
    const issues = expectsPlan(response, status);
    if (response?.plan && !samePeople(item(response.plan, "supplies")?.assignee ?? "", ["Ada"], response.plan)) issues.push("requested assignee missing");
    return issues;
  });
  const review = item(base, "review")!;
  await run("revision-gap-dependency", { message: `Add a 10-minute transition buffer between ${supplies.task} and ${review.task}. Keep their order and all existing tasks.`, history: [], currentPlan: base, planDate: "2026-09-28" }, (response, status) => {
    const issues = expectsPlan(response, status);
    if (response?.plan) {
      const gap = response.plan.requirements?.gaps?.find((entry) => entry.afterTaskId === "supplies" && entry.beforeTaskId === "review" && entry.minMinutes >= 10);
      if (!gap) issues.push("requested named gap missing from checklist");
      const before = item(response.plan, "supplies"); const after = item(response.plan, "review");
      if (!before || !after || minutes(after.startTime)! - minutes(before.startTime)! - before.durationMinutes < 10) issues.push("actual transition gap missing");
    }
    return issues;
  });

  const totalLatency = results.reduce((sum, entry) => sum + entry.latencyMs, 0);
  const report = [
    "# Home Huddle local live corpus", "",
    `Run date: ${new Date().toISOString().slice(0, 10)}. Local API only; no public-site requests or hosted quota changes.`,
    `Requests: ${requestCount}/${MAX_REQUESTS}${selectedCases ? " targeted recheck" : ""}. Converse calls in this run: ${unknownCallRequests ? `${knownCalls} known, total bounded ${knownCalls}–${knownCalls + unknownCallRequests * 3}` : `${knownCalls} exact`}; cumulative campaign upper bound ${previousUpperBound + knownCalls + unknownCallRequests * 3}, hard ceiling 42.`,
    `Outcomes: ${results.filter((entry) => entry.outcome === "pass").length} pass, ${results.filter((entry) => entry.outcome === "fail").length} fail, ${results.filter((entry) => entry.outcome === "blocked").length} blocked. Total observed API latency ${totalLatency} ms.`,
    "Successful-response call counts come from safe API metadata; a count of one is first-pass success, and any extra calls are repairs. Error responses without count metadata are conservatively bounded. The two hosted plan/revision requests remain a post-deployment gate and were not run.", "",
    "| Case | Outcome | Observed latency | Converse calls | Repair calls | Finding |", "| --- | --- | ---: | --- | --- | --- |",
    ...results.map((entry) => `| ${entry.id} | ${entry.outcome} | ${entry.latencyMs} ms | ${entry.converseCalls} | ${entry.repairCalls} | ${entry.detail.replaceAll("|", "/")} |`),
    "", "All prompts and household names are fictional. The report intentionally omits prompts, response bodies, credentials, and request IDs.", "",
  ].join("\n");
  const filename = selectedCases ? `diagnostic-${new Date().toISOString().replaceAll(/[:.]/g, "-")}` : "results";
  const reportPath = `${OUTPUT}/${filename === "results" ? "report" : filename + "-report"}.md`;
  await writeFile(reportPath, report);
  await writeFile(`${OUTPUT}/${filename}.json`, JSON.stringify({ requestCount, converseCallHardCap: possibleCalls, knownConverseCalls: knownCalls, unknownCallRequests, actualCallRange: [knownCalls, knownCalls + unknownCallRequests * 3], previousUpperBound, results }, null, 2));
  process.stdout.write(`Finished ${requestCount} local requests. Results: ${reportPath}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Campaign failed"}\n`); process.exitCode = 1; });
