// @vitest-environment node
import { createHash } from "node:crypto";
import { GetItemCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { createShareService } from "./share";
import type { ShareCreateRequest } from "../shared/shareContracts";
import { SCENARIO_REQUIREMENTS } from "../shared/scenarios";

const request: ShareCreateRequest = {
  action: "share-create",
  date: "2026-09-18",
  timeZone: "America/Chicago",
  plan: {
    title: "Fictional evening",
    objective: "Get ready for tomorrow",
    participants: ["Maya"],
    items: [{ id: "item-1", taskId: "prep", startTime: "6:00 PM", durationMinutes: 30, task: "Prepare", assignee: "Maya" }],
    notes: [],
    version: 1,
    updatedAt: "2026-09-16T12:00:00.000Z",
  },
};

describe("share service", () => {
  it("preserves separate event dates in an immutable snapshot", async () => {
    const service = createShareService();
    const spreadRequest: ShareCreateRequest = {
      ...request,
      plan: {
        ...request.plan,
        items: [
          { ...request.plan.items[0], date: "2026-09-18" },
          { ...request.plan.items[0], id: "item-2", taskId: "second", date: "2026-09-22" },
          { ...request.plan.items[0], id: "item-3", taskId: "third", date: "2026-10-07" },
          { ...request.plan.items[0], id: "item-4", taskId: "fourth", date: "2026-10-08" },
        ],
      },
    };
    const { token } = await service.create(spreadRequest);
    spreadRequest.plan.items[0].date = "2026-11-01";
    const resolved = await service.resolve({ action: "share-resolve", token });
    expect(resolved.date).toBe("2026-09-18");
    expect(resolved.timeZone).toBe("America/Chicago");
    expect(resolved.plan.items.map((item) => item.date)).toEqual([
      "2026-09-18", "2026-09-22", "2026-10-07", "2026-10-08",
    ]);
    resolved.plan.items[1].date = "2026-11-01";
    expect((await service.resolve({ action: "share-resolve", token })).plan.items[1].date)
      .toBe("2026-09-22");
  });

  it("rejects an invalid event date in a share snapshot", async () => {
    const service = createShareService();
    const invalid = {
      ...request,
      plan: { ...request.plan, items: [{ ...request.plan.items[0], date: "2026-02-30" }] },
    } as ShareCreateRequest;
    await expect(service.create(invalid)).rejects.toThrow();
  });

  it("rejects a schema-valid plan with a scheduling conflict", async () => {
    const service = createShareService();
    const conflicting: ShareCreateRequest = {
      ...request,
      plan: {
        ...request.plan,
        items: [
          { ...request.plan.items[0] },
          { ...request.plan.items[0], id: "item-2", taskId: "second", task: "Second task", startTime: "6:15 PM" },
        ],
      },
    };
    await expect(service.create(conflicting)).rejects.toMatchObject({ code: "VALIDATION", status: 400 });
  });

  it("does not share an unanchored example checklist as verified", async () => {
    const service = createShareService();
    const forged: ShareCreateRequest = {
      ...request,
      plan: {
        ...request.plan,
        requirements: {
          source: "scenario",
          timeWindow: { startTime: "6:00 PM", endTime: "7:00 PM" },
          tasks: [{ id: "prep", label: "Prepare", durationMinutes: 30 }],
        },
      },
    };
    await expect(service.create(forged)).rejects.toMatchObject({ code: "VALIDATION", status: 400 });
  });

  it("shares a valid plan checked against its current example checklist", async () => {
    const service = createShareService();
    const items = [
      { taskId: "kitchen", startTime: "9:00 AM", durationMinutes: 35, task: "Kitchen", assignee: "Alex" },
      { taskId: "vacuum", startTime: "9:00 AM", durationMinutes: 30, task: "Vacuum", assignee: "Sam" },
      { taskId: "start-laundry", startTime: "9:00 AM", durationMinutes: 20, task: "Start laundry", assignee: "Riley" },
      { taskId: "fold-laundry", startTime: "9:25 AM", durationMinutes: 20, task: "Fold laundry", assignee: "Riley" },
      { taskId: "shared-break", startTime: "9:50 AM", durationMinutes: 15, task: "Break", assignee: "All" },
    ];
    const checked: ShareCreateRequest = {
      ...request,
      plan: {
        ...request.plan,
        scenarioId: "chores",
        participants: ["Alex", "Sam", "Riley"],
        requirements: SCENARIO_REQUIREMENTS.chores,
        items: items.map((item, index) => ({ id: `item-${index}`, ...item })),
      },
    };
    const { token } = await service.create(checked);
    const resolved = await service.resolve({ action: "share-resolve", token });
    expect(resolved.plan.requirements).toEqual(SCENARIO_REQUIREMENTS.chores);
  });

  it("keeps user-added activity details in a read-only snapshot", async () => {
    const service = createShareService();
    const withDetails: ShareCreateRequest = {
      ...request,
      plan: { ...request.plan, items: [{ ...request.plan.items[0], details: "Use the prepared ingredients." }] },
    };
    const result = await service.create(withDetails);
    const resolved = await service.resolve({ action: "share-resolve", token: result.token });
    expect(resolved.plan.items[0].details).toBe("Use the prepared ingredients.");
  });

  it("omits unchecked notes from older saved plans when sharing", async () => {
    const service = createShareService();
    const legacy = { ...request, plan: { ...request.plan, notes: ["Riley only does laundry tasks"] } };
    const result = await service.create(legacy);
    const resolved = await service.resolve({ action: "share-resolve", token: result.token });
    expect(resolved.plan.notes).toEqual([]);
  });

  it("creates an immutable read-only local snapshot and expires it after seven days", async () => {
    let current = new Date("2026-09-16T12:00:00.000Z");
    const service = createShareService({ now: () => current });
    const result = await service.create(request);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(result.expiresAt).toBe("2026-09-23T12:00:00.000Z");

    request.plan.title = "Changed after share";
    const resolved = await service.resolve({ action: "share-resolve", token: result.token });
    expect(resolved.plan.title).toBe("Fictional evening");
    expect(resolved.date).toBe("2026-09-18");
    expect(resolved.timeZone).toBe("America/Chicago");
    expect(resolved.createdAt).toBe("2026-09-16T12:00:00.000Z");
    resolved.plan.title = "Changed after resolve";
    expect((await service.resolve({ action: "share-resolve", token: result.token })).plan.title).toBe("Fictional evening");
    request.plan.title = "Fictional evening";

    current = new Date("2026-09-23T12:00:00.000Z");
    await expect(service.resolve({ action: "share-resolve", token: result.token })).rejects.toMatchObject({
      code: "SHARE_NOT_FOUND",
      status: 404,
    });
  });

  it("stores only a token hash and snapshot in DynamoDB", async () => {
    const commands: Array<GetItemCommand | TransactWriteItemsCommand> = [];
    const send = vi.fn(async (command: GetItemCommand | TransactWriteItemsCommand) => {
      commands.push(command);
      if (command instanceof GetItemCommand) return { Item: undefined };
      return {};
    });
    const service = createShareService({ tableName: "test-shares", now: () => new Date("2026-09-16T12:00:00.000Z"), send });
    const result = await service.create({
      ...request,
      plan: { ...request.plan, items: [{ ...request.plan.items[0], date: "2026-10-07" }] },
    });
    const transaction = commands[0] as TransactWriteItemsCommand;
    const put = transaction.input.TransactItems?.[0]?.Put;
    const hash = createHash("sha256").update(result.token).digest("hex");
    expect(put?.Item?.id?.S).toBe(`share#${hash}`);
    expect(put?.Item?.snapshot?.S).toContain("Fictional evening");
    expect(JSON.parse(put?.Item?.snapshot?.S ?? "{}").plan.items[0].date).toBe("2026-10-07");
    expect(JSON.parse(put?.Item?.snapshot?.S ?? "{}").createdAt).toBe("2026-09-16T12:00:00.000Z");
    expect(put?.Item?.snapshot?.S).not.toContain("history");
    expect(JSON.stringify(transaction.input)).not.toContain(result.token);
    expect(transaction.input.TransactItems).toHaveLength(3);
  });

  it("rejects missing and expired records even if DynamoDB TTL has not deleted them", async () => {
    const service = createShareService({
      tableName: "test-shares",
      now: () => new Date("2026-09-23T12:00:00.000Z"),
      send: async (command) => command instanceof GetItemCommand
        ? { Item: { snapshot: { S: JSON.stringify({ plan: request.plan, date: request.date, timeZone: request.timeZone }) }, expiresAt: { N: String(Date.parse("2026-09-23T12:00:00.000Z") / 1000) } } }
        : {},
    });
    await expect(service.resolve({ action: "share-resolve", token: "A".repeat(32) })).rejects.toMatchObject({
      code: "SHARE_NOT_FOUND",
      status: 404,
    });
  });

  it("resolves an older stored snapshot without a creation timestamp", async () => {
    const service = createShareService({
      tableName: "test-shares",
      now: () => new Date("2026-09-16T12:00:00.000Z"),
      send: async (command) => command instanceof GetItemCommand
        ? { Item: { snapshot: { S: JSON.stringify({ plan: request.plan, date: request.date, timeZone: request.timeZone }) }, expiresAt: { N: String(Date.parse("2026-09-23T12:00:00.000Z") / 1000) } } }
        : {},
    });
    const result = await service.resolve({ action: "share-resolve", token: "A".repeat(32) });
    expect(result.createdAt).toBeUndefined();
    expect(result.plan.title).toBe("Fictional evening");
  });

  it("refuses a previously stored conflicting snapshot on resolve", async () => {
    const conflicting = {
      ...request,
      plan: {
        ...request.plan,
        items: [
          { ...request.plan.items[0] },
          { ...request.plan.items[0], id: "item-2", taskId: "second", task: "Second task", startTime: "6:15 PM" },
        ],
      },
    };
    const service = createShareService({
      tableName: "test-shares",
      now: () => new Date("2026-09-16T12:00:00.000Z"),
      send: async (command) => command instanceof GetItemCommand
        ? { Item: { snapshot: { S: JSON.stringify({ plan: conflicting.plan, date: request.date, timeZone: request.timeZone }) }, expiresAt: { N: String(Date.parse("2026-09-23T12:00:00.000Z") / 1000) } } }
        : {},
    });
    await expect(service.resolve({ action: "share-resolve", token: "A".repeat(32) })).rejects.toMatchObject({
      code: "SHARE_NOT_FOUND",
      status: 404,
    });
  });

  it("enforces the local create quota and maps conditional DynamoDB failures to rate limits", async () => {
    const local = createShareService({ now: () => new Date("2026-09-16T12:00:00.000Z") });
    for (let index = 0; index < 100; index += 1) await local.create(request);
    await expect(local.create(request)).rejects.toMatchObject({ code: "RATE_LIMIT", status: 429 });

    const remote = createShareService({
      tableName: "test-shares",
      send: async () => {
        throw { name: "TransactionCanceledException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] };
      },
    });
    await expect(remote.create(request)).rejects.toMatchObject({ code: "RATE_LIMIT", status: 429 });
  });

});
