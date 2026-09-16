import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  chatRequestSchema,
  type ChatErrorResponse,
} from "../shared/contracts";
import { createChatService, type ChatService } from "./chatService";
import { AppError } from "./errors";

type AppOptions = {
  chatService?: ChatService;
  bedrockConfigured?: boolean;
  staticDir?: string;
  hourlyChatLimit?: number;
  publicOrigin?: string;
  now?: () => number;
};

export function createApp(options: AppOptions = {}) {
  const app = express();
  const chatService = options.chatService ?? createChatService();
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
  app.use(express.json({ limit: "100kb" }));

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
      if (
        publicOrigin &&
        (request.get("origin") !== publicOrigin || request.get("sec-fetch-site") === "cross-site")
      ) {
        throw new AppError("VALIDATION", "Use the Home Huddle page to send a request.", {
          status: 403,
        });
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
      response: Response<ChatErrorResponse>,
      _next: NextFunction,
    ) => {
      void _next;
      const malformedJson = error instanceof SyntaxError && "body" in error;
      const appError = error instanceof AppError
        ? error
        : malformedJson
          ? new AppError("VALIDATION", "Send a valid JSON request.", { status: 400 })
          : new AppError(
              "BEDROCK_UNAVAILABLE",
              "Home Huddle encountered an unexpected error.",
              { retryable: true, status: 500 },
            );

      if (!(error instanceof AppError) && !malformedJson) {
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
