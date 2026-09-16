// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createLambdaHandler } from "./lambda";

const validEvent = {
  requestContext: { http: { method: "POST" } },
  headers: { origin: "https://andrewodom18.github.io", "content-type": "application/json" },
  body: JSON.stringify({ message: "Plan tonight", history: [] }),
};

describe("public Lambda handler", () => {
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
