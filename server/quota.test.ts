// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { createQuotaReserver } from "./quota";

describe("Bedrock call quota", () => {
  it("atomically reserves one call in the UTC day and month", async () => {
    const send = vi.fn(async (command: TransactWriteItemsCommand) => {
      void command;
      return {};
    });
    const reserve = createQuotaReserver({
      tableName: "demo-quota",
      dailyLimit: 30,
      monthlyLimit: 300,
      now: () => new Date("2026-09-16T23:59:00Z"),
      send,
    });

    await reserve();

    const items = send.mock.calls[0]?.[0].input.TransactItems;
    expect(items).toHaveLength(2);
    expect(items?.[0]?.Update?.Key).toEqual({ period: { S: "day#2026-09-16" } });
    expect(items?.[1]?.Update?.Key).toEqual({ period: { S: "month#2026-09" } });
    expect(items?.[0]?.Update?.ExpressionAttributeValues?.[":reserve"]).toEqual({ N: "1" });
    expect(items?.[0]?.Update?.ExpressionAttributeValues?.[":remaining"]).toEqual({ N: "29" });
    expect(items?.[1]?.Update?.ExpressionAttributeValues?.[":remaining"]).toEqual({ N: "299" });
  });

  it("fails closed when the quota is exhausted", async () => {
    const send = vi.fn(async () => {
      throw {
        name: "TransactionCanceledException",
        CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
      };
    });
    const reserve = createQuotaReserver({ tableName: "demo-quota", send });

    await expect(reserve()).rejects.toMatchObject({
      code: "RATE_LIMIT",
      retryable: false,
      status: 429,
    });
  });
});
