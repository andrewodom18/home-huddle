// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assessPlan, buildCorpus, revisionFixture } from "./planning-corpus";
import { readLedger, reserve, settle, spent } from "./campaign-budget";
import { chatRequestSchema } from "../shared/contracts";
import { fixturePlan } from "../e2e/fixtures";

describe("independent planning corpus", () => {
  const corpus = buildCorpus(DateTime.fromISO("2026-09-18T12:00:00", { zone: "America/Chicago" }));
  it("provides thirty valid uniquely identified cases, including all four release regressions", () => {
    expect(corpus).toHaveLength(30);
    expect(new Set(corpus.map((entry) => entry.id)).size).toBe(30);
    for (const entry of corpus) expect(chatRequestSchema.safeParse(entry.request).success, entry.id).toBe(true);
    expect(corpus.map((entry) => entry.id)).toEqual(expect.arrayContaining(["free-parallel", "free-cross-month", "revision-exact-start", "revision-assignee"]));
  });
  it("keeps the remaining-day request feasible while earlier live cases run near an hour boundary", () => {
    const now = DateTime.fromISO("2026-09-18T13:59:59", { zone: "America/Chicago" });
    const entry = buildCorpus(now).find((value) => value.id === "remaining-day")!;
    const first = entry.tasks![0];
    const start = DateTime.fromFormat(`${first.date} ${first.earliest}`, "yyyy-MM-dd h:mm a", { zone: "America/Chicago" });
    expect(start.diff(now, "minutes").minutes).toBeGreaterThanOrEqual(60);
    expect(start.toISODate()).toBe(now.toISODate());
  });
  it("catches omitted tasks and wrong assignments even if the model rewrites its own checklist", () => {
    const entry = corpus.find((value) => value.id === "free-parallel")!;
    const plan = revisionFixture(entry.request.planDate!);
    expect(assessPlan(entry, plan).hardIssues).toEqual([]);
    plan.items[0].assignee = "Ben";
    plan.requirements!.tasks[0].requiredParticipants = ["Ben"];
    expect(assessPlan(entry, plan).hardIssues).toContain("task-1:assignees");
    plan.items.pop(); plan.requirements!.tasks.pop();
    expect(assessPlan(entry, plan).coverage).toBeLessThan(1);
  });
  it("tests repeated task labels separately by date", () => {
    const entry = corpus.find((value) => value.id === "repeated-labels")!;
    const plan = revisionFixture(entry.request.planDate!);
    plan.participants = ["Ada"];
    plan.items = entry.tasks!.map((expected, index) => ({ id: String(index), taskId: `reading-${index}`, task: "Reading", date: expected.date, startTime: expected.start!, durationMinutes: expected.duration!, assignee: "Ada" }));
    expect(assessPlan(entry, plan).hardIssues).toEqual([]);
    plan.items[1].date = plan.items[0].date;
    expect(assessPlan(entry, plan).hardIssues).toContain("task-2:missing-or-duplicate");
  });
  it("accepts either requested adult for math help while rejecting an absent helper", () => {
    const entry = corpus.find((value) => value.id === "preset-weekday")!;
    const plan = fixturePlan("weekday", "2026-09-18");
    expect(assessPlan(entry, plan).hardIssues).toEqual([]);
    plan.items.find((item) => item.taskId === "math-mon")!.assignee = "Maya, Jordan";
    expect(assessPlan(entry, plan).hardIssues).toEqual([]);
    plan.items.find((item) => item.taskId === "math-mon")!.assignee = "Maya";
    expect(assessPlan(entry, plan).hardIssues).toContain("task-6:required-or-alternative-assignee");
  });
  it("does not confuse table setting with the substring in vegetables", () => {
    const entry = corpus.find((value) => value.id === "meal-shared-oven")!;
    const plan = revisionFixture(entry.request.planDate!);
    plan.items = [
      { id: "bread", taskId: "bread", task: "Bake bread", date: entry.request.planDate, startTime: "4:00 PM", durationMinutes: 40, assignee: "Ada" },
      { id: "vegetables", taskId: "vegetables", task: "Roast vegetables", date: entry.request.planDate, startTime: "4:40 PM", durationMinutes: 30, assignee: "Ben" },
      { id: "table", taskId: "table", task: "Set the table", date: entry.request.planDate, startTime: "4:00 PM", durationMinutes: 15, assignee: "Kit" },
    ];
    expect(assessPlan(entry, plan).hardIssues).toEqual([]);
    plan.items[2].task = "Polish silverware";
    expect(assessPlan(entry, plan).hardIssues).toContain("task-3:missing-or-duplicate");
  });
  it("checks interpreted resource use and availability against independently authored values", () => {
    const resource = corpus.find((entry) => entry.id === "meal-shared-oven")!;
    const plan = revisionFixture(resource.request.planDate!);
    plan.requirements!.resources = [{ id: "oven", label: "Oven", capacity: 2 }];
    expect(assessPlan(resource, plan).qualityIssues).toContain("resource-1:captured-capacity-or-use");
    const availability = corpus.find((entry) => entry.id === "revision-availability")!;
    plan.requirements!.availability = [{ participant: "Ben", startTime: "10:00 AM", endTime: "11:00 AM" }];
    expect(assessPlan(availability, plan).qualityIssues).not.toContain("availability-1:captured-window");
    plan.requirements!.availability[0].startTime = "9:00 AM";
    expect(assessPlan(availability, plan).qualityIssues).toContain("availability-1:captured-window");
  });
});

describe("live campaign budget", () => {
  it("counts actual calls rather than rejecting refunded zero-call requests", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "huddle-budget-"));
    const filename = path.join(dir, "ledger.json");
    try {
      const ledger = await readLedger(filename);
      for (let i = 0; i < 51; i += 1) {
        const id = await reserve(filename, ledger, `local-${i}`, "test");
        await settle(filename, ledger, id, 0);
      }
      expect(spent(await readLedger(filename))).toBe(0);
      await reserve(filename, ledger, "model-request", "test");
      expect(spent(await readLedger(filename))).toBe(3);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("persists worst-case reservations across interruption and rejects corrupt ledgers", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "huddle-budget-"));
    const filename = path.join(dir, "ledger.json");
    try {
      const ledger = await readLedger(filename);
      await reserve(filename, ledger, "interrupted", "test");
      expect(spent(await readLedger(filename))).toBe(3);
      const id = await reserve(filename, ledger, "completed", "test");
      await settle(filename, ledger, id, 2);
      expect(spent(await readLedger(filename))).toBe(5);
      await expect(settle(filename, ledger, id, 0)).rejects.toThrow("settled");
      await writeFile(filename, "bad");
      await expect(readLedger(filename)).rejects.toThrow("refusing to reset");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("keeps prior reservations when applying the authorized nine-call extension", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "huddle-budget-"));
    const filename = path.join(dir, "ledger.json");
    try {
      const original = { version: 2, cap: 150, attempts: [{ id: "old", caseId: "previous", sourceFingerprint: "prior", startedAt: "2026-09-18T00:00:00.000Z", ceiling: 3, settled: false }] };
      await writeFile(filename, JSON.stringify(original));
      const ledger = await readLedger(filename);
      expect(ledger.cap).toBe(159);
      expect(spent(ledger)).toBe(3);
      await reserve(filename, ledger, "targeted", "current");
      expect(JSON.parse(await readFile(filename, "utf8"))).toMatchObject({ cap: 159, attempts: [original.attempts[0], { caseId: "targeted" }] });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("cannot exceed 159 calls and never trusts invalid call counts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "huddle-budget-"));
    const filename = path.join(dir, "ledger.json");
    try {
      const ledger = await readLedger(filename);
      for (let i = 0; i < 53; i += 1) {
        const id = await reserve(filename, ledger, `case-${i}`, "test");
        if (i === 0) await settle(filename, ledger, id, -1);
      }
      expect(spent(ledger)).toBe(159);
      await expect(reserve(filename, ledger, "extra", "test")).rejects.toThrow("exhausted");
      expect(JSON.parse(await readFile(filename, "utf8")).attempts).toHaveLength(53);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
