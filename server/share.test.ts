// @vitest-environment node
import { createHash } from "node:crypto";
import { GetItemCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { createShareService } from "./share";
import type { ShareCreateRequest } from "../shared/shareContracts";

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
    const result = await service.create(request);
    const transaction = commands[0] as TransactWriteItemsCommand;
    const put = transaction.input.TransactItems?.[0]?.Put;
    const hash = createHash("sha256").update(result.token).digest("hex");
    expect(put?.Item?.id?.S).toBe(`share#${hash}`);
    expect(put?.Item?.snapshot?.S).toContain("Fictional evening");
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
