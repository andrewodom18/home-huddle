import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  chatRequestSchema,
} from "../shared/contracts";
import { createChatService, type ChatService } from "./chatService";
import { AppError } from "./errors";
import { shareCreateRequestSchema, shareResolveRequestSchema } from "../shared/shareContracts";
import { createShareService, ShareError, type ShareService } from "./share";

type AppOptions = {
  chatService?: ChatService;
  shareService?: ShareService;
  bedrockConfigured?: boolean;
  staticDir?: string;
  hourlyChatLimit?: number;
  publicOrigin?: string;
  now?: () => number;
};

export function createApp(options: AppOptions = {}) {
  const app = express();
  const chatService = options.chatService ?? createChatService();
  const shareService = options.shareService ?? createShareService();
  const configuredLimit = options.hourlyChatLimit ?? Number(process.env.CHAT_HOURLY_LIMIT ?? 60);
  const hourlyChatLimit = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? Math.floor(configuredLimit)
    : 60;
  const configuredConcurrent = Number(process.env.CHAT_MAX_CONCURRENT ?? 2);
  const maxConcurrent = Number.isFinite(configuredConcurrent) && configuredConcurrent > 0
    ? Math.floor(configuredConcurrent)
    : 2;
  const publicOrigin = options.publicOrigin ?? process.env.PUBLIC_ORIGIN;
  const now = options.now ?? Date.now;
  let windowStartedAt = now();
  let chatCount = 0;
  let activeChats = 0;

  app.disable("x-powered-by");
  app.use(express.json({ limit: "24kb" }));

  function verifyOrigin(request: Request) {
    if (
      publicOrigin &&
      (request.get("origin") !== publicOrigin || request.get("sec-fetch-site") === "cross-site")
    ) {
      throw new AppError("VALIDATION", "Use the Home Huddle page to send a request.", {
        status: 403,
      });
    }
  }

  async function handleShare(request: Request, action: "share-create" | "share-resolve") {
    verifyOrigin(request);
    const body = { ...request.body, action };
    if (Buffer.byteLength(JSON.stringify(body)) > 24_000) {
      throw new ShareError("VALIDATION", "The request is too large.", 413);
    }
    if (action === "share-create") {
      const parsed = shareCreateRequestSchema.safeParse(body);
      if (!parsed.success) throw new ShareError("VALIDATION", "Choose a valid plan, date, and time zone.", 400);
      return shareService.create(parsed.data);
    }
    const parsed = shareResolveRequestSchema.safeParse(body);
    if (!parsed.success) throw new ShareError("VALIDATION", "Use a valid share token.", 400);
    return shareService.resolve(parsed.data);
  }

  app.get("/api/health", (_request, response) => {
    response.json({
      status: "ok",
      bedrockConfigured:
        options.bedrockConfigured ??
        Boolean(
          process.env.BEDROCK_AUTH_MODE === "iam" ||
            (process.env.AWS_BEARER_TOKEN_BEDROCK &&
              process.env.AWS_BEARER_TOKEN_BEDROCK !== "replace-with-your-bedrock-api-key"),
        ),
    });
  });

  app.post("/api/chat", async (request, response, next) => {
    try {
      if (request.body?.action === "share-create" || request.body?.action === "share-resolve") {
        response.set("Cache-Control", "no-store");
        response.json(await handleShare(request, request.body.action));
        return;
      }
      verifyOrigin(request);
      if (Buffer.byteLength(JSON.stringify(request.body) ?? "") > 16_000) {
        throw new AppError("VALIDATION", "The request is too large.", { status: 413 });
      }
      if (now() - windowStartedAt >= 3_600_000) {
        windowStartedAt = now();
        chatCount = 0;
      }
      if (chatCount >= hourlyChatLimit || activeChats >= maxConcurrent) {
        throw new AppError(
          "RATE_LIMIT",
          "The public demo is busy. Please try again later.",
          { retryable: true, status: 429 },
        );
      }

      const parsed = chatRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(
          "VALIDATION",
          "Use a message under 500 characters and no more than 12 history items.",
          { status: 400 },
        );
      }

      chatCount += 1;
      activeChats += 1;
      try {
        response.json(await chatService(parsed.data));
      } finally {
        activeChats -= 1;
      }
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/share/create", async (request, response, next) => {
    try {
      response.set("Cache-Control", "no-store");
      response.json(await handleShare(request, "share-create"));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/share/resolve", async (request, response, next) => {
    try {
      response.set("Cache-Control", "no-store");
      response.json(await handleShare(request, "share-resolve"));
    } catch (error) {
      next(error);
    }
  });

  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile("index.html", { root: options.staticDir }, next);
    });
  }

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      void _next;
      const malformedJson = error instanceof SyntaxError && "body" in error;
      const oversizedJson = typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large";
      const appError = error instanceof AppError || error instanceof ShareError
        ? error
        : oversizedJson
          ? new ShareError("VALIDATION", "The request is too large.", 413)
        : malformedJson
          ? new AppError("VALIDATION", "Send a valid JSON request.", { status: 400 })
          : new AppError(
              "BEDROCK_UNAVAILABLE",
              "Home Huddle encountered an unexpected error.",
              { retryable: true, status: 500 },
            );

      if (!(error instanceof AppError) && !(error instanceof ShareError) && !malformedJson && !oversizedJson) {
        console.error("Unexpected Home Huddle API error", {
          name: error instanceof Error ? error.name : "unknown",
        });
      }

      response.status(appError.status).json({
        error: {
          code: appError.code,
          message: appError.message,
          retryable: appError.retryable,
        },
      });
    },
  );

  return app;
}
