// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createLambdaHandler } from "./lambda";

const validEvent = {
  requestContext: { http: { method: "POST" } },
  headers: { origin: "https://andrewodom18.github.io", "content-type": "application/json" },
  body: JSON.stringify({ message: "Plan tonight", history: [] }),
};

describe("public Lambda handler", () => {
  it("routes share actions without invoking Bedrock and never places tokens in headers", async () => {
    const chatService = vi.fn();
    const plan = { title: "Evening", objective: "Prepare", participants: ["Maya"], items: [{ id: "1", task: "Prepare", assignee: "Maya", startTime: "6:00 PM", durationMinutes: 30 }], notes: [], version: 1, updatedAt: "2026-09-16T12:00:00.000Z" };
    const shareService = {
      create: vi.fn(async () => ({ token: "a".repeat(32), expiresAt: "2026-09-23T12:00:00.000Z" })),
      resolve: vi.fn(async () => ({ plan, date: "2026-09-18", timeZone: "America/Chicago", expiresAt: "2026-09-23T12:00:00.000Z" })),
    };
    const handler = createLambdaHandler({ chatService, shareService, publicOrigin: "https://andrewodom18.github.io" });
    const create = await handler({ ...validEvent, body: JSON.stringify({
      action: "share-create", date: "2026-09-18", timeZone: "America/Chicago",
      plan,
    }) });
    expect(create.statusCode).toBe(200);
    expect(shareService.create).toHaveBeenCalledOnce();
    expect(chatService).not.toHaveBeenCalled();
    expect(JSON.stringify(create.headers)).not.toContain("a".repeat(32));

    const resolve = await handler({ ...validEvent, body: JSON.stringify({ action: "share-resolve", token: "a".repeat(32) }) });
    expect(resolve.statusCode).toBe(200);
    expect(shareService.resolve).toHaveBeenCalledOnce();
  });

  it("rejects invalid date and zone before creating a share", async () => {
    const shareService = { create: vi.fn(), resolve: vi.fn() };
    const handler = createLambdaHandler({ chatService: vi.fn(), shareService, publicOrigin: "https://andrewodom18.github.io" });
    const result = await handler({ ...validEvent, body: JSON.stringify({ action: "share-create", date: "2026-02-30", timeZone: "Nowhere/Invalid", plan: {} }) });
    expect(result.statusCode).toBe(400);
    expect(shareService.create).not.toHaveBeenCalled();
  });
  it("rejects a foreign origin before planning", async () => {
    const chatService = vi.fn();
    const handler = createLambdaHandler({
      chatService,
      publicOrigin: "https://andrewodom18.github.io",
    });

    const result = await handler({
      ...validEvent,
      headers: { ...validEvent.headers, origin: "https://other.example.com" },
    });

    expect(result.statusCode).toBe(403);
    expect(chatService).not.toHaveBeenCalled();
  });

  it("rejects the former demo origin before planning", async () => {
    const chatService = vi.fn();
    const handler = createLambdaHandler({
      chatService,
      publicOrigin: "https://andrewodom18.github.io",
    });

    const result = await handler({
      ...validEvent,
      headers: { ...validEvent.headers, origin: "https://odom-technology.github.io" },
    });

    expect(result.statusCode).toBe(403);
    expect(chatService).not.toHaveBeenCalled();
  });

  it("serves a validated chat and does not retain request text in headers", async () => {
    const chatService = vi.fn(async () => ({
      reply: "Ready",
      meta: { provider: "Amazon Bedrock" as const, modelId: "test", toolUsed: false, latencyMs: 1 },
    }));
    const handler = createLambdaHandler({
      chatService,
      publicOrigin: "https://andrewodom18.github.io",
    });

    const result = await handler(validEvent);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).reply).toBe("Ready");
    expect(chatService).toHaveBeenCalledOnce();
    expect(JSON.stringify(result.headers)).not.toContain("Plan tonight");
  });
});
