// @vitest-environment node
import request from "supertest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { AppError } from "./errors";

describe("Home Huddle API", () => {
  it("accepts share actions on the chat URL and local aliases", async () => {
    const plan = { title: "Evening", objective: "Prepare", participants: ["Maya"], items: [{ id: "1", task: "Prepare", assignee: "Maya", startTime: "6:00 PM", durationMinutes: 30 }], notes: [], version: 1, updatedAt: "2026-09-16T12:00:00.000Z" };
    const shareService = {
      create: vi.fn(async () => ({ token: "a".repeat(32), expiresAt: "2026-09-23T12:00:00.000Z" })),
      resolve: vi.fn(async () => ({ plan, date: "2026-09-18", timeZone: "America/Chicago", expiresAt: "2026-09-23T12:00:00.000Z" })),
    };
    const chatService = vi.fn();
    const app = createApp({ chatService, shareService });
    const created = await request(app).post("/api/chat").send({ action: "share-create", plan, date: "2026-09-18", timeZone: "America/Chicago" });
    const resolved = await request(app).post("/api/share/resolve").send({ token: "a".repeat(32) });
    expect(created.status).toBe(200);
    expect(resolved.status).toBe(200);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(resolved.headers["cache-control"]).toBe("no-store");
    expect(shareService.create).toHaveBeenCalledOnce();
    expect(shareService.resolve).toHaveBeenCalledOnce();
    expect(chatService).not.toHaveBeenCalled();
  });

  it("rejects an oversized share body without invoking storage", async () => {
    const shareService = { create: vi.fn(), resolve: vi.fn() };
    const response = await request(createApp({ chatService: vi.fn(), shareService }))
      .post("/api/chat")
      .send({ action: "share-create", plan: {}, date: "2026-09-18", timeZone: "America/Chicago", padding: "x".repeat(25_000) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("VALIDATION");
    expect(shareService.create).not.toHaveBeenCalled();
  });

  it("reports readiness without exposing credentials", async () => {
    const response = await request(
      createApp({ chatService: vi.fn(), bedrockConfigured: true }),
    ).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", bedrockConfigured: true });
  });

  it("rejects invalid chat input", async () => {
    const chatService = vi.fn();
    const response = await request(createApp({ chatService }))
      .post("/api/chat")
      .send({ message: "", history: [] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION");
    expect(chatService).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without echoing its content", async () => {
    const response = await request(createApp({ chatService: vi.fn() }))
      .post("/api/chat")
      .set("Content-Type", "application/json")
      .send('{"message":"private household detail"');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION");
    expect(response.text).not.toContain("private household detail");
  });

  it("returns a typed Bedrock failure", async () => {
    const chatService = vi.fn(async () => {
      throw new AppError("BEDROCK_AUTH", "Configure Bedrock.", { status: 503 });
    });
    const response = await request(createApp({ chatService }))
      .post("/api/chat")
      .send({ message: "Plan tonight", history: [] });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: {
        code: "BEDROCK_AUTH",
        message: "Configure Bedrock.",
        retryable: false,
      },
    });
  });

  it("caps public chat calls before invoking Bedrock", async () => {
    const chatService = vi.fn(async () => ({
      reply: "Ready",
      meta: { provider: "Amazon Bedrock" as const, modelId: "test", toolUsed: false, latencyMs: 1 },
    }));
    const app = createApp({ chatService, hourlyChatLimit: 1 });

    const first = await request(app).post("/api/chat").send({
      message: "Plan tonight",
      history: [],
    });
    const second = await request(app).post("/api/chat").send({
      message: "Plan tomorrow",
      history: [],
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("RATE_LIMIT");
    expect(chatService).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin chat requests before invoking Bedrock", async () => {
    const chatService = vi.fn();
    const app = createApp({
      chatService,
      publicOrigin: "https://demo.example.com",
    });

    const response = await request(app)
      .post("/api/chat")
      .set("Origin", "https://other.example.com")
      .send({ message: "Plan tonight", history: [] });

    expect(response.status).toBe(403);
    expect(chatService).not.toHaveBeenCalled();
  });

  it("serves the compiled browser app alongside the API", async () => {
    const staticDir = mkdtempSync(path.join(tmpdir(), "home-huddle-static-"));
    writeFileSync(path.join(staticDir, "index.html"), "<h1>Home Huddle</h1>");
    const app = createApp({ chatService: vi.fn(), staticDir });

    try {
      const response = await request(app).get("/");
      expect(response.status).toBe(200);
      expect(response.text).toContain("Home Huddle");
    } finally {
      rmSync(staticDir, { recursive: true, force: true });
    }
  });
});
