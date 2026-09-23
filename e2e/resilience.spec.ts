import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fixturePlan, fixtureResponse } from "./fixtures";
import type { HouseholdPlan } from "../shared/contracts";

const storageKey = "home-huddle-state-v2";
const fullProjects = ["chromium-390", "chromium-1440", "webkit-mobile", "webkit-desktop", "firefox-desktop"];
const composer = (page: Page) => page.getByRole("textbox", { name: "Message", exact: true });
const visibleEvent = (page: Page, task: string) => page.locator(".day-grid__event:visible, .plan-task__button:visible").filter({ hasText: task }).first();
const token = "abcdefghijklmnopqrstuvwxyzABCDEF";

test.beforeEach(async ({ page }, info) => {
  test.skip(!fullProjects.includes(info.project.name));
  // Isolate every test from the configured backend, including accidentally unhandled sharing requests.
  await page.route("**/*", (route) => route.request().method() === "POST" ? route.abort() : route.continue());
});

async function seed(page: Page, plan: HouseholdPlan) {
  await page.goto("/");
  await page.evaluate(({ key, plan }) => localStorage.setItem(key, JSON.stringify({
    messages: [], plan, calendarDate: plan.items[0].date, timeZone: "America/Chicago",
  })), { key: storageKey, plan });
  await page.reload();
}

async function noAccessibilityViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }))).toEqual([]);
}

test("storage denial keeps the conversation usable and explains memory-only saving", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage denied", "SecurityError"); };
    Storage.prototype.removeItem = () => { throw new DOMException("Storage denied", "SecurityError"); };
  });
  await page.goto("/");
  await expect(composer(page)).toBeVisible();
  await expect(page.getByText(/cannot save|could not save|not saved|memory only|memory-only|storage.*unavailable/i).first()).toBeVisible();
  await composer(page).fill("Hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" }).last()).toContainText("Hi!");
  await page.getByRole("button", { name: "New plan" }).click();
  await expect(composer(page)).toBeEnabled();
  expect(errors).toEqual([]);
  await noAccessibilityViolations(page);
});

test("malformed saved plans recover instead of leaving a blank page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.evaluate(({ key, plan }) => localStorage.setItem(key, JSON.stringify({ messages: [], plan: { ...plan, updatedAt: "bad" } })), { key: storageKey, plan: fixturePlan("chores") });
  await page.reload();
  await expect(composer(page)).toBeVisible();
  await expect(page.getByText(/saved.*(invalid|recover|read)|recover.*saved|saved.*start|could not.*saved/i).first()).toBeVisible();
  await composer(page).fill("Hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" }).last()).toContainText("Hi!");
  expect(errors).toEqual([]);
});

test("malformed API success becomes a recoverable error without rendering a plan", async ({ page }) => {
  await page.route("**/api/chat", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ reply: "Ready", plan: "not a plan" }) }));
  await page.goto("/");
  await composer(page).fill("Help plan tomorrow's dinner.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("region", { name: "Household calendar" })).toHaveCount(0);
  await expect(composer(page)).toBeEnabled();
  await noAccessibilityViolations(page);
});

test("network failure retries the same request and quota exhaustion remains understandable", async ({ page }) => {
  let calls = 0;
  const messages: string[] = [];
  await page.route("**/api/chat", async (route) => {
    calls += 1;
    messages.push(route.request().postDataJSON().message);
    if (calls === 1) await route.abort("failed");
    else if (calls === 2) await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "RATE_LIMIT", message: "The demo call allowance is used. Try again tomorrow.", retryable: true } }) });
    else await route.fulfill({ contentType: "application/json", body: JSON.stringify(fixtureResponse(fixturePlan("chores"))) });
  });
  await page.goto("/");
  await composer(page).fill("Plan household chores for tomorrow.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("alert")).toContainText("allowance");
  await noAccessibilityViolations(page);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("region", { name: "Household calendar" })).toBeVisible();
  expect(messages).toEqual(Array(3).fill("Plan household chores for tomorrow."));
});

test("reset cancels an in-flight reply without restoring the previous plan", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/chat", async (route) => {
    await pending;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(fixtureResponse(fixturePlan("chores"))) }).catch(() => undefined);
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Share the chores/ }).click();
  await expect(composer(page)).toBeDisabled();
  await page.getByRole("button", { name: "New plan" }).click();
  release();
  await expect(page.getByRole("heading", { name: "Hello, how can we plan together?" })).toBeVisible();
  await composer(page).fill("Hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" }).last()).toContainText("Hi!");
  await expect(page.getByRole("region", { name: "Household calendar" })).toHaveCount(0);
});

test("long multiline custom prompts are preserved and clarification remains editable", async ({ page }) => {
  const sent: string[] = [];
  await page.route("**/api/chat", async (route) => {
    sent.push(route.request().postDataJSON().message);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ reply: "Which day should I plan?", outcome: "clarification", meta: { provider: "Amazon Bedrock", modelId: "fixture", toolUsed: false, latencyMs: 1, callCount: 1 } }) });
  });
  await page.goto("/");
  const prompt = `Plan a meal and household errands.\n${"Use the available time without moving fixed commitments. ".repeat(14)}`.trim();
  expect(prompt.length).toBeGreaterThan(500);
  await expect(composer(page)).toHaveAttribute("maxlength", "1000");
  await composer(page).fill(prompt);
  await composer(page).press("Shift+Enter");
  expect(sent).toHaveLength(0);
  await composer(page).press("Enter");
  await expect(page.getByRole("article", { name: "assistant message" }).last()).toHaveText(/Which day should I plan/);
  expect(sent).toEqual([prompt]);
  await expect(composer(page)).toBeEnabled();
  await expect(page.getByRole("region", { name: "Household calendar" })).toHaveCount(0);
});

test("assumptions and extended checklist constraints remain available after reload", async ({ page }) => {
  const plan = fixturePlan("chores");
  delete plan.scenarioId;
  delete plan.scenarioAnchor;
  plan.requirements!.source = "interpreted";
  plan.notes = ["Leave unused time free for the household."];
  plan.requirements!.assumptions = ["Cleaning supplies are already available."];
  plan.requirements!.availability = [{ participant: "Alex", date: plan.items[0].date, startTime: "9:00 AM", endTime: "11:00 AM" }];
  plan.requirements!.resources = [{ id: "vacuum", label: "Vacuum cleaner", capacity: 1 }];
  plan.requirements!.tasks.find((task) => task.id === "vacuum")!.resources = [{ resourceId: "vacuum", units: 1 }];
  plan.requirements!.preferences = [{ description: "Finish early where possible.", kind: "earlier_finish" }];
  await seed(page, plan);
  await page.getByText("Interpreted checklist — review it", { exact: true }).click();
  await expect(page.getByText("Cleaning supplies are already available.", { exact: true })).toBeVisible();
  await expect(page.getByText("Leave unused time free for the household.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Vacuum cleaner/).first()).toBeVisible();
  await expect(page.getByText(/Finish early where possible/)).toBeVisible();
  await noAccessibilityViolations(page);
});

test("clipboard denial still exposes a copyable read-only snapshot link", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new DOMException("Denied", "NotAllowedError"); } } }));
  await seed(page, fixturePlan("chores"));
  await page.route("**/api/chat", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ token, expiresAt: "2099-10-27T12:00:00.000Z" }) }));
  await page.getByText("Share or export this plan", { exact: true }).click();
  await page.getByRole("checkbox", { name: /I confirm/ }).check();
  await page.getByRole("button", { name: "Copy view link", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "View link", exact: true })).toHaveValue(new RegExp(`#share=${token}$`));
  await expect(page.getByText("View link ready. Copy it from the field below.", { exact: true })).toBeVisible();
  await noAccessibilityViolations(page);
});

test("share errors, invalid tokens and expired links offer a usable way forward", async ({ page }) => {
  await seed(page, fixturePlan("chores"));
  await page.route("**/api/chat", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "SHARE_UNAVAILABLE", message: "Sharing is temporarily unavailable.", retryable: true } }) }));
  await page.getByText("Share or export this plan", { exact: true }).click();
  await page.getByRole("checkbox", { name: /I confirm/ }).check();
  await page.getByRole("button", { name: "Copy view link", exact: true }).click();
  await expect(page.getByText("Sharing is temporarily unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy view link", exact: true })).toBeEnabled();
  await page.goto("/#share=bad");
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("invalid");
  await page.route("**/api/chat", (route) => route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ error: { code: "SHARE_EXPIRED", message: "This snapshot has expired.", retryable: false } }) }));
  await page.goto(`/#share=${token}`);
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("expired");
  await expect(page.getByRole("link", { name: "Start your own plan" })).toBeVisible();
  await noAccessibilityViolations(page);
});

test("dense long-label plans reflow at 200 percent zoom and preserve dialog keyboard boundaries", async ({ page }, info) => {
  const plan = fixturePlan("weekday");
  plan.items = plan.items.map((item) => ({ ...item, task: `${item.task} — ${"household".repeat(8)}` }));
  await seed(page, plan);
  await page.evaluate(() => {
    // Desktop browser-style zoom preserves a >=320 CSS-pixel layout; on phones
    // test 200% text enlargement instead of inventing a 195px CSS viewport.
    if (window.innerWidth >= 768) document.documentElement.style.zoom = "2";
    else document.documentElement.style.fontSize = "200%";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Shared", exact: true }).click();
  await visibleEvent(page, plan.items[0].task).click();
  const dialog = page.getByRole("dialog");
  expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  const close = dialog.getByRole("button", { name: "Close activity details" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Save details" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.screenshot({ path: info.outputPath("zoomed-event-editor.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(visibleEvent(page, plan.items[0].task)).toBeFocused();
});

test("unsupported speech input leaves a complete text path", async ({ page }) => {
  await page.addInitScript(() => {
    const browser = window as unknown as Record<string, unknown>;
    delete browser.SpeechRecognition;
    delete browser.webkitSpeechRecognition;
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Voice input unavailable in this browser" })).toHaveAttribute("aria-disabled", "true");
  await composer(page).fill("Hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" }).last()).toContainText("Hi!");
});

test("invalid time-zone drafts do not corrupt the accepted planning zone", async ({ page }) => {
  await seed(page, fixturePlan("chores"));
  await page.getByText("Share or export this plan", { exact: true }).click();
  const zone = page.getByRole("textbox", { name: "Time zone", exact: true });
  await zone.fill("Not/AZone");
  await zone.press("Tab");
  await expect(page.getByRole("alert")).toContainText(/valid.*time zone/i);
  await expect(page.getByRole("button", { name: "Download .ics" })).toBeDisabled();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).timeZone, storageKey)).toBe("America/Chicago");
  await noAccessibilityViolations(page);
  await zone.fill("America/New_York");
  await zone.press("Enter");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).timeZone, storageKey)).toBe("America/New_York");
  await page.reload();
  await page.getByText("Share or export this plan", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Time zone", exact: true })).toHaveValue("America/New_York");
});

test("whole-plan date changes reject missing, repeated, and crossing daylight-saving times", async ({ page }) => {
  for (const [startTime, targetDate, feedback] of [
    ["1:30 AM", "2099-11-01", "occurs twice"],
    ["2:30 AM", "2099-03-08", "does not exist"],
    ["1:50 AM", "2099-03-08", "daylight-saving"],
  ]) {
    const date = "2099-01-15";
    const plan: HouseholdPlan = {
      title: "Early routine", objective: "Prepare a bag", participants: ["Ada"],
      items: [{ id: "pack", taskId: "pack", task: "Pack bag", date, startTime, durationMinutes: 20, assignee: "Ada" }],
      requirements: { source: "interpreted", timeWindow: { startTime: "1:00 AM", endTime: "4:00 AM" }, tasks: [{ id: "pack", label: "Pack bag", date, durationMinutes: 20, requiredParticipants: ["Ada"] }] },
      notes: [], version: 1, updatedAt: "2026-09-18T12:00:00.000Z",
    };
    await seed(page, plan);
    await composer(page).fill(`Move the whole plan to ${targetDate}.`);
    await composer(page).press("Enter");
    await expect(page.getByRole("article", { name: "assistant message" }).last()).toContainText(feedback);
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).plan.items[0].date, storageKey)).toBe(date);
  }
});

test("a pending proposal, acceptance, and undo survive reloads without losing notes", async ({ page }) => {
  const original = fixturePlan("chores");
  original.items[0].details = "Keep the blue sponge for this task.";
  const revised = structuredClone(original);
  revised.version += 1;
  revised.items[0].startTime = "9:05 AM";
  await seed(page, original);
  await page.route("**/api/chat", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(fixtureResponse(revised)) }));
  await composer(page).fill("Move Clean the kitchen five minutes later.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("region", { name: "Proposed revision" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Proposed revision" })).toBeVisible();
  await expect(composer(page)).toBeDisabled();
  await expect(visibleEvent(page, "Clean the kitchen")).toHaveAttribute("aria-label", /9:00 AM/);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.reload();
  await expect(visibleEvent(page, "Clean the kitchen")).toHaveAttribute("aria-label", /9:05 AM/);
  await page.getByRole("button", { name: "Undo accepted revision" }).click();
  await visibleEvent(page, "Clean the kitchen").click();
  await expect(page.getByRole("textbox", { name: "Additional details" })).toHaveValue("Keep the blue sponge for this task.");
  await expect(page.getByRole("dialog").getByLabel("Activity start time")).toHaveValue("09:00");
});

test("speech permission denial and late transcripts preserve the text workflow", async ({ page }) => {
  await page.addInitScript(() => {
    const browser = window as unknown as Record<string, unknown>;
    class FakeRecognition {
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() { browser.__testSpeech = this; }
      start() { /* Events are driven explicitly without real microphone access. */ }
      abort() { this.onend?.(); }
      stop() { this.onend?.(); }
    }
    browser.SpeechRecognition = FakeRecognition;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start voice input" }).click();
  await page.evaluate(() => {
    const speech = (window as unknown as { __testSpeech: { onerror: (event: unknown) => void } }).__testSpeech;
    speech.onerror({ error: "not-allowed" });
  });
  await expect(page.getByRole("alert")).toContainText("Microphone permission was not granted");
  await expect(composer(page)).toBeEnabled();
  await page.getByRole("button", { name: "Start voice input" }).click();
  await page.evaluate(() => {
    const speech = (window as unknown as { __testSpeech: { onresult: (event: unknown) => void } }).__testSpeech;
    speech.onresult({ results: [[{ transcript: "Plan dinner for tomorrow" }]] });
  });
  await expect(composer(page)).toHaveValue("Plan dinner for tomorrow");
  await page.getByRole("button", { name: "New plan" }).click();
  await page.evaluate(() => {
    const speech = (window as unknown as { __testSpeech: { onresult: (event: unknown) => void } }).__testSpeech;
    speech.onresult({ results: [[{ transcript: "An old late transcript" }]] });
  });
  await expect(composer(page)).toHaveValue("");
  await expect(page.getByRole("heading", { name: "Hello, how can we plan together?" })).toBeVisible();
});

test("twelve participants and twenty activities remain reachable without page overflow", async ({ page }) => {
  const date = "2099-10-20";
  const participants = Array.from({ length: 12 }, (_, index) => `Person ${index + 1}`);
  const items = Array.from({ length: 20 }, (_, index) => ({
    id: `activity-${index}`, taskId: `activity-${index}`, task: `Household activity ${index + 1}`,
    date, assignee: participants[index % 12], startTime: index < 12 ? "9:00 AM" : "9:15 AM", durationMinutes: 10,
  }));
  const plan: HouseholdPlan = {
    title: "Large household", objective: "Coordinate independent work without losing an activity", participants, items,
    requirements: { source: "interpreted", timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" }, tasks: items.map((item) => ({ id: item.taskId, label: item.task, date, durationMinutes: 10, requiredParticipants: [item.assignee] })) },
    notes: [], version: 1, updatedAt: "2026-09-18T12:00:00.000Z",
  };
  await seed(page, plan);
  await page.getByRole("button", { name: "By person", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  const lastPerson = page.locator(".day-grid__event:visible, .plan-task__button:visible").filter({ hasText: "Household activity 12" }).first();
  await lastPerson.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("Person 12");
  await page.keyboard.press("Escape");
  await expect(lastPerson).toBeFocused();
  await page.getByRole("button", { name: "Shared", exact: true }).click();
  await visibleEvent(page, "Household activity 20").click();
  await expect(page.getByRole("dialog")).toContainText("Household activity 20");
});
