import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { fixturePlan, fixtureResponse, validateFixture } from "./fixtures";
import { presetScenarios } from "../src/presets";
import type { ChatRequest, HouseholdPlan } from "../shared/contracts";

const isFullFlow = (name: string) => ["chromium-390", "chromium-1440", "webkit-mobile", "webkit-desktop", "firefox-desktop"].includes(name);
const storageKey = "home-huddle-state-v2";
const visibleEvent = (page: Page, task: string) => page.locator(".day-grid__event:visible, .plan-task__button:visible").filter({ hasText: task }).first();
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const plusDays = (date: string, days: number) => isoDate(new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000));
const shortDate = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const icsDate = (date: string) => date.replaceAll("-", "");

test.beforeEach(async ({ page }) => {
  // Any missing fixture fails closed instead of reaching a configured API or Bedrock.
  await page.route("**/*", (route) => route.request().method() === "POST" ? route.abort() : route.continue());
});

async function cleanOpen(page: Page) {
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
}

async function mockChat(page: Page, response: (request: ChatRequest) => ReturnType<typeof fixtureResponse> | { error: unknown }, requests: ChatRequest[] = []) {
  await page.route("**/api/chat", async (route: Route) => {
    const request = route.request().postDataJSON() as ChatRequest;
    requests.push(request);
    const body = response(request);
    await route.fulfill({ status: "error" in body ? 503 : 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function axeHasNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("welcome, active chat, calendar, and editor remain usable at this viewport", async ({ page }, testInfo) => {
  const plan = fixturePlan("chores");
  await mockChat(page, () => fixtureResponse(plan));
  await cleanOpen(page);
  await expect(page.getByRole("heading", { name: "Hello, how can we plan together?" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Household calendar" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("welcome.png"), fullPage: true });
  await page.getByRole("button", { name: /Share the chores/ }).click();
  await expect(page.getByRole("region", { name: "Household calendar" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("active-calendar.png"), fullPage: true });
  await page.getByRole("textbox", { name: "Message" }).focus();
  await page.screenshot({ path: testInfo.outputPath("focused-composer.png"), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "No page-wide horizontal overflow; the day grid may scroll internally").toBeLessThanOrEqual(1);
  const cards = await page.locator(".day-grid__event").count();
  expect(cards).toBeGreaterThanOrEqual(5);
  await expect(page.locator(".plan-timeline li").filter({ hasText: "9:00 AM" })).toHaveCount(3);
  await visibleEvent(page, "Clean the kitchen").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("event-editor.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "About" }).click();
  await expect(page.getByRole("heading", { name: "Make room for everyone’s day." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start planning" })).toBeVisible();
});

test("all examples put the complete prompt in chat and reveal only a returned plan", async ({ page }, testInfo) => {
  test.skip(!isFullFlow(testInfo.project.name));
  await cleanOpen(page);
  for (const [index, scenario] of presetScenarios(isoDate(new Date())).entries()) {
    if (index > 0) {
      await page.getByRole("button", { name: "New plan" }).click();
      await expect(page.getByRole("heading", { name: "Hello, how can we plan together?" })).toBeVisible();
    }
    const requests: ChatRequest[] = [];
    await page.unroute("**/api/chat");
    await mockChat(page, (request) => fixtureResponse(fixturePlan(scenario.id as "weekday" | "chores" | "outing", request.planDate)), requests);
    await page.getByRole("button", { name: new RegExp(scenario.title) }).click();
    const selected = presetScenarios(requests[0].planDate!).find((preset) => preset.id === scenario.id)!;
    await expect(page.getByRole("article", { name: "user message" }).last()).toContainText(selected.prompt);
    await expect(page.getByRole("region", { name: "Household calendar" })).toBeVisible();
    expect(requests[0].scenarioId).toBe(scenario.id);
    expect(requests[0].message).toBe(selected.prompt);
    await page.screenshot({ path: testInfo.outputPath(`${scenario.id}.png`), fullPage: true });
  }
});

test("examples dismiss, Thinking is announced, API failure retries", async ({ page }, testInfo) => {
  test.skip(!isFullFlow(testInfo.project.name));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  await page.route("**/api/chat", async (route) => {
    calls += 1;
    if (calls === 1) {
      await pending;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "BEDROCK_UNAVAILABLE", message: "Try again soon.", retryable: true } }) });
    } else await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixtureResponse(fixturePlan("chores"))) });
  });
  await cleanOpen(page);
  await page.getByRole("button", { name: "Dismiss example scenarios" }).click();
  await expect(page.getByRole("button", { name: /Share the chores/ })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Message" }).fill("Plan a simple Saturday chore schedule for Alex, Sam, and Riley.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Thinking about your message");
  release();
  await expect(page.getByRole("alert")).toContainText("Try again soon.");
  await expect(page.getByRole("region", { name: "Household calendar" })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("region", { name: "Household calendar" })).toBeVisible();
  expect(calls).toBe(2);
});

test("nonconsecutive dates, parallel work, notes, and .ics export", async ({ page }, testInfo) => {
  test.skip(!isFullFlow(testInfo.project.name));
  const plan = fixturePlan("outing");
  const gardenDate = plan.items.find((entry) => entry.taskId === "garden")!.date!;
  const libraryDate = plan.items.find((entry) => entry.taskId === "library")!.date!;
  const picnicDate = plan.items.find((entry) => entry.taskId === "picnic")!.date!;
  await mockChat(page, () => fixtureResponse(plan));
  await cleanOpen(page);
  await page.getByRole("button", { name: /Three family outings/ }).click();
  const days = page.getByRole("navigation", { name: "Schedule days" });
  const dayButton = (day: string) => days.getByRole("button", { name: new RegExp(`${shortDate(day)}, \\d{4} `) });
  await expect(dayButton(gardenDate)).toHaveAttribute("aria-pressed", "true");
  await dayButton(libraryDate).click();
  await expect(page.getByRole("button", { name: /Open details for Accessible library visit/ }).first()).toBeVisible();
  await dayButton(picnicDate).click();
  await expect(page.getByRole("button", { name: /Open details for Family picnic/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /Open details for Family picnic/ }).first().click();
  await page.getByRole("textbox", { name: "Additional details" }).fill("Bring a fictional picnic blanket.");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("button", { name: /Open details for Family picnic/ }).first()).toContainText("Has details");
  await page.getByText("Share or export this plan").click();
  const zone = page.getByRole("textbox", { name: "Time zone" });
  await zone.fill("America/Chicago");
  await zone.press("Enter");
  await expect(page.getByRole("checkbox", { name: /confirm these event dates/ })).toBeEnabled();
  await page.getByRole("checkbox", { name: /confirm these event dates/ }).check();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .ics" }).click();
  const file = await download;
  const contents = await file.path().then(async (path) => (await import("node:fs/promises")).readFile(path, "utf8"));
  expect(contents).toContain(icsDate(gardenDate));
  expect(contents).toContain(icsDate(libraryDate));
  expect(contents).toContain(icsDate(picnicDate));
  expect(contents).toMatch(new RegExp(`DTSTART:${icsDate(gardenDate)}T\\d{6}Z`));
  expect(contents).toMatch(new RegExp(`DTSTART:${icsDate(picnicDate)}T\\d{6}Z`));
  expect(contents).toContain("Bring a fictional picnic blanket");
});

test("schedule edit is reviewed, can be kept or applied, and can be undone", async ({ page }, testInfo) => {
  test.skip(!isFullFlow(testInfo.project.name));
  const original = fixturePlan("chores");
  const changed: HouseholdPlan = { ...original, version: 2, items: original.items.map((entry) => entry.taskId === "kitchen" ? { ...entry, startTime: "9:05 AM" } : entry) };
  validateFixture(changed);
  const requests: ChatRequest[] = [];
  await mockChat(page, (request) => fixtureResponse(request.edit ? changed : original), requests);
  await cleanOpen(page);
  await page.getByRole("button", { name: /Share the chores/ }).click();
  const open = () => visibleEvent(page, "Clean the kitchen");
  await open().click();
  await page.getByRole("textbox", { name: "Additional details" }).fill("Use the blue sponge.");
  await page.getByRole("dialog").getByLabel("Activity start time").fill("09:05");
  await page.getByRole("button", { name: "Review schedule change" }).click();
  await expect(page.getByRole("region", { name: "Proposed revision" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Proposed revision" })).toBeFocused();
  await expect(open()).toContainText("Has details");
  expect(requests.at(-1)?.edit).toEqual({ taskId: "kitchen", startTime: "9:05 AM" });
  await page.screenshot({ path: testInfo.outputPath("revision-proposal.png"), fullPage: true });
  await expect(open()).toHaveAttribute("aria-label", /9:00 AM/);
  await page.getByRole("button", { name: "Keep current" }).click();
  await expect(page.getByRole("region", { name: "Proposed revision" })).toHaveCount(0);
  await expect(open()).toContainText("Has details");
  await open().click();
  await expect(page.getByRole("textbox", { name: "Additional details" })).toHaveValue("Use the blue sponge.");
  await page.getByRole("dialog").getByLabel("Activity start time").fill("09:05");
  await page.getByRole("button", { name: "Review schedule change" }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(open()).toHaveAttribute("aria-label", /9:05 AM/);
  await page.getByRole("button", { name: "Undo accepted revision" }).click();
  await expect(open()).toHaveAttribute("aria-label", /9:00 AM/);
});

test("end time, duration, and eligible people become a checked proposal and accepted calendar state", async ({ page }, testInfo) => {
  test.skip(!isFullFlow(testInfo.project.name));
  const original = fixturePlan("chores");
  const requirements = structuredClone(original.requirements!);
  requirements.source = "interpreted";
  requirements.tasks = requirements.tasks.map((task) => task.id === "kitchen" ? { ...task, durationMinutes: 30 } : task);
  const shorter: HouseholdPlan = {
    ...original, version: 2, scenarioEdits: { kitchen: { durationMinutes: 30 } }, requirements,
    items: original.items.map((item) => item.taskId === "kitchen" ? { ...item, durationMinutes: 30 } : item),
  };
  const reassignedRequirements = structuredClone(requirements);
  reassignedRequirements.tasks = reassignedRequirements.tasks.map((task) => task.id === "kitchen"
    ? { ...task, requiredParticipants: ["Sam"], allowedParticipants: ["Sam"], atLeastOneOf: undefined }
    : task);
  const reassigned: HouseholdPlan = {
    ...shorter, version: 3, scenarioEdits: { kitchen: { durationMinutes: 30, assignees: ["Sam"] } },
    requirements: reassignedRequirements,
    items: shorter.items.map((item) => item.taskId === "kitchen" ? { ...item, assignee: "Sam" } : item.taskId === "vacuum" ? { ...item, assignee: "Alex" } : item),
  };
  validateFixture(shorter);
  validateFixture(reassigned);
  const requests: ChatRequest[] = [];
  await mockChat(page, (request) => fixtureResponse(request.edit?.assignees ? reassigned : request.edit ? shorter : original), requests);
  await cleanOpen(page);
  await page.getByRole("button", { name: /Share the chores/ }).click();
  await visibleEvent(page, "Clean the kitchen").click();
  await page.getByRole("dialog").getByLabel("Activity end time").fill("09:30");
  await expect(page.getByRole("dialog").getByLabel("Activity duration in minutes")).toHaveValue("30");
  await page.getByRole("button", { name: "Review schedule change" }).click();
  expect(requests.at(-1)?.edit).toEqual({ taskId: "kitchen", startTime: "9:00 AM", durationMinutes: 30 });
  await expect(page.getByRole("region", { name: "Proposed revision" })).toBeVisible();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("region", { name: "Proposed revision" })).toHaveCount(0);
  await expect(page.getByText("Plan v2")).toBeVisible();
  await visibleEvent(page, "Clean the kitchen").click();
  await expect(page.getByRole("dialog").getByLabel("Activity duration in minutes")).toHaveValue("30");
  await page.getByRole("dialog").getByRole("checkbox", { name: "Alex" }).uncheck();
  await page.getByRole("dialog").getByRole("checkbox", { name: "Sam" }).check();
  await page.getByRole("button", { name: "Review schedule change" }).click();
  expect(requests.at(-1)?.edit).toEqual({ taskId: "kitchen", assignees: ["Sam"] });
  await expect(page.getByRole("region", { name: "Proposed revision" })).toBeVisible();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(visibleEvent(page, "Clean the kitchen")).toHaveAttribute("aria-label", /assigned to Sam/);
  await expect(visibleEvent(page, "Vacuum the floors")).toHaveAttribute("aria-label", /assigned to Alex/);
  await expect(page.getByText("Customized example checklist")).toBeVisible();
  await visibleEvent(page, "Clean the kitchen").click();
  await expect(page.getByRole("dialog").getByRole("checkbox", { name: "Alex" })).toBeEnabled();
  await expect(page.getByRole("dialog").getByRole("checkbox", { name: "Riley" })).toBeDisabled();
  await page.getByRole("button", { name: "Close activity details" }).click();
  await page.getByRole("button", { name: "Undo accepted revision" }).click();
  await expect(visibleEvent(page, "Clean the kitchen")).toHaveAttribute("aria-label", /assigned to Alex/);
});

test("editor checks invalid input and preserves accepted plan after conflicting edits", async ({ page }, testInfo) => {
  test.skip(!isFullFlow(testInfo.project.name));
  const choreDate = fixturePlan("chores").items[0].date!;
  const requests: ChatRequest[] = [];
  await mockChat(page, (request) => request.edit
    ? { error: { code: "VALIDATION", message: "That conflicts with another activity or a fixed requirement.", retryable: false } }
    : fixtureResponse(fixturePlan("chores")), requests);
  await cleanOpen(page);
  await page.getByRole("button", { name: /Share the chores/ }).click();
  await visibleEvent(page, "Clean the kitchen").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Activity duration in minutes")).toBeEnabled();
  await expect(dialog.getByLabel("Activity end time")).toBeEnabled();
  await dialog.getByLabel("Activity date").fill("");
  await dialog.getByRole("button", { name: "Review schedule change" }).click();
  await expect(dialog.getByRole("alert")).toContainText("valid date");
  expect(requests).toHaveLength(1);
  await dialog.getByLabel("Activity date").fill(choreDate);
  await dialog.getByRole("checkbox", { name: "Alex" }).uncheck();
  await dialog.getByRole("checkbox", { name: "Sam" }).check();
  await dialog.getByRole("button", { name: "Review schedule change" }).click();
  await expect(page.getByRole("alert")).toContainText("conflicts with another activity");
  await expect(page.locator(".error-banner")).toBeFocused();
  expect(requests.at(-1)?.edit).toEqual({ taskId: "kitchen", assignees: ["Sam"] });
  await expect(page.getByRole("region", { name: "Proposed revision" })).toHaveCount(0);
  await visibleEvent(page, "Clean the kitchen").click();
  await page.getByRole("dialog").getByLabel("Activity date").fill(plusDays(choreDate, 1));
  await page.getByRole("dialog").getByLabel("Activity start time").fill("09:05");
  await page.getByRole("dialog").getByRole("button", { name: "Review schedule change" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(requests.at(-1)?.edit).toEqual({ taskId: "kitchen", date: plusDays(choreDate, 1), startTime: "9:05 AM" });
  await expect(visibleEvent(page, "Clean the kitchen")).toHaveAttribute("aria-label", /9:00 AM/);
});

test("past calendar edits and whole-plan moves explain the attempted date without an API call", async ({ page }, testInfo) => {
  test.skip(!isFullFlow(testInfo.project.name));
  const requests: ChatRequest[] = [];
  await mockChat(page, () => fixtureResponse(fixturePlan("chores")), requests);
  await cleanOpen(page);
  await page.getByRole("button", { name: /Share the chores/ }).click();
  await visibleEvent(page, "Clean the kitchen").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Activity date").fill("2000-01-01");
  await dialog.getByRole("button", { name: "Review schedule change" }).click();
  await expect(dialog.getByRole("alert")).toContainText("in the past");
  await expect(dialog).toBeVisible();
  expect(requests).toHaveLength(1);
  await dialog.getByRole("button", { name: "Close activity details" }).click();
  await page.getByRole("textbox", { name: "Message" }).fill("Move the plan to January 1, 2000");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" }).last()).toContainText("in the past");
  await expect(page.getByRole("region", { name: "Proposed revision" })).toHaveCount(0);
  expect(requests).toHaveLength(1);
});

test("fixed commitments explain why schedule editing is unavailable", async ({ page }, testInfo) => {
  test.skip(!isFullFlow(testInfo.project.name));
  const requests: ChatRequest[] = [];
  await mockChat(page, (request) => request.edit
    ? { error: { code: "VALIDATION", message: "Jordan's fixed call must stay at 6:30 PM.", retryable: false } }
    : fixtureResponse(fixturePlan("weekday")), requests);
  await cleanOpen(page);
  await page.getByRole("button", { name: /The school-week rhythm/ }).click();
  await visibleEvent(page, "Jordan's fixed call").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Activity date")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Review schedule change" })).toHaveCount(0);
  await expect(dialog).toContainText("fixed commitment in the example");
  expect(requests).toHaveLength(1);
  await expect(page.getByRole("region", { name: "Proposed revision" })).toHaveCount(0);
});

const nextChoreDate = plusDays(fixturePlan("chores").items[0].date!, 1);
for (const editCase of [
  { name: "date", label: "Activity date", value: nextChoreDate, expected: { date: nextChoreDate } },
  { name: "start", label: "Activity start time", value: "09:05", expected: { startTime: "9:05 AM" } },
  { name: "end", label: "Activity end time", value: "09:30", expected: { startTime: "9:00 AM", durationMinutes: 30 } },
  { name: "duration", label: "Activity duration in minutes", value: "30", expected: { startTime: "9:00 AM", durationMinutes: 30 } },
] as const) {
  test(`${editCase.name} edit sends the exact changed schedule fields`, async ({ page }, testInfo) => {
    test.skip(!isFullFlow(testInfo.project.name));
    const requests: ChatRequest[] = [];
    await mockChat(page, (request) => request.edit
      ? { error: { code: "VALIDATION", message: "Fixture rejected the edit.", retryable: false } }
      : fixtureResponse(fixturePlan("chores")), requests);
    await cleanOpen(page);
    await page.getByRole("button", { name: /Share the chores/ }).click();
    await visibleEvent(page, "Clean the kitchen").click();
    await page.getByRole("dialog").getByLabel(editCase.label).fill(editCase.value);
    await page.getByRole("dialog").getByRole("button", { name: "Review schedule change" }).click();
    await expect(page.getByRole("alert")).toContainText("Fixture rejected");
    expect(requests.at(-1)?.edit).toEqual({ taskId: "kitchen", ...editCase.expected });
  });
}

test("person and shared views stay usable across desktop and mobile", async ({ page }, testInfo) => {
  await mockChat(page, () => fixtureResponse(fixturePlan("chores")));
  await cleanOpen(page);
  await page.getByRole("button", { name: /Share the chores/ }).click();
  const switcher = page.getByRole("group", { name: "Calendar view" });
  const compact = (page.viewportSize()?.width ?? 1440) <= 980;
  if (compact) {
    await expect(switcher.getByRole("button", { name: "Shared" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("list", { name: "Activities in time order" })).toBeVisible();
    await switcher.getByRole("button", { name: "By person" }).click();
    const grouped = page.getByRole("group", { name: "Activities by person" });
    await expect(grouped.getByRole("region", { name: "Alex activities" })).toBeVisible();
    await expect(grouped.getByRole("region", { name: "Sam activities" })).toBeVisible();
    await expect(grouped.getByRole("region", { name: "Riley activities" })).toBeVisible();
  } else {
    await expect(switcher.getByRole("button", { name: "By person" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("group", { name: "Calendar day view" })).toBeVisible();
    await switcher.getByRole("button", { name: "Shared" }).click();
    const shared = page.getByRole("group", { name: "Shared calendar day view" });
    await expect(shared).toBeVisible();
    await expect(shared.getByRole("button", { name: /Open details for Shared break/ })).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath("shared-calendar.png"), fullPage: true });
  }
  await switcher.getByRole("button", { name: "Shared" }).click();
  await expect(switcher.getByRole("button", { name: "Shared" })).toHaveAttribute("aria-pressed", "true");
  await visibleEvent(page, "Clean the kitchen").click();
  await expect(page.getByRole("dialog", { name: "Clean the kitchen" })).toBeVisible();
});

test("keyboard, touch targets, hover hints, and reduced motion remain usable", async ({ page }, testInfo) => {
  test.skip(!isFullFlow(testInfo.project.name));
  await mockChat(page, () => fixtureResponse(fixturePlan("chores")));
  await cleanOpen(page);
  if (testInfo.project.name.startsWith("chromium")) {
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  }
  await page.getByRole("button", { name: /Share the chores/ }).click();
  await expect(page.getByRole("button", { name: "New plan" })).toHaveAttribute("title", "New plan");
  await expect(visibleEvent(page, "Clean the kitchen")).toHaveAttribute("title", /View activity details/);
  const targets = await page.getByRole("button", { name: "New plan" }).evaluate((element) => {
    const { width, height } = element.getBoundingClientRect();
    return { width, height };
  });
  expect(targets.width).toBeGreaterThanOrEqual(24);
  expect(targets.height).toBeGreaterThanOrEqual(24);
  await visibleEvent(page, "Clean the kitchen").click();
  await expect(page.getByRole("button", { name: "Close activity details" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(visibleEvent(page, "Clean the kitchen")).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await page.getByRole("button", { name: "New plan" }).evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(motion).toBe("0s");
});

test("key welcome, calendar, editor, and proposal states pass axe", async ({ page }, testInfo) => {
  test.skip(!isFullFlow(testInfo.project.name));
  const original = fixturePlan("chores");
  const changed: HouseholdPlan = { ...original, version: 2, items: original.items.map((entry) => entry.taskId === "kitchen" ? { ...entry, startTime: "9:05 AM" } : entry) };
  await mockChat(page, (request) => fixtureResponse(request.edit ? changed : original));
  await cleanOpen(page);
  await axeHasNoViolations(page);
  await page.getByRole("button", { name: /Share the chores/ }).click();
  await axeHasNoViolations(page);
  await visibleEvent(page, "Clean the kitchen").click();
  await axeHasNoViolations(page);
  await page.getByRole("dialog").getByLabel("Activity start time").fill("09:05");
  await page.getByRole("button", { name: "Review schedule change" }).click();
  await axeHasNoViolations(page);
});

test("old saved plan warns and shared snapshot is read only", async ({ page }, testInfo) => {
  test.skip(!isFullFlow(testInfo.project.name));
  const old = { ...fixturePlan("chores"), requirements: undefined };
  await cleanOpen(page);
  await page.evaluate(({ key, plan }) => localStorage.setItem(key, JSON.stringify({ messages: [], plan, calendarDate: plan.items[0].date })), { key: storageKey, plan: old });
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "before the current schedule checks" })).toBeVisible();
  await expect(page.getByText("Share or export this plan")).toHaveCount(0);
  await page.route("**/api/chat", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ plan: fixturePlan("chores"), date: fixturePlan("chores").items[0].date, timeZone: "America/Chicago", expiresAt: "2099-09-24T00:00:00Z" }) }));
  await page.goto("/#share=abcdefghijklmnopqrstuvwxyzABCDEF");
  await page.reload();
  await expect(page.getByText("Read-only snapshot")).toBeVisible();
  await visibleEvent(page, "Clean the kitchen").click();
  await expect(page.getByRole("dialog").getByText("Start a new plan to edit this schedule.")).toHaveCount(0);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Review schedule change" })).toHaveCount(0);
});
