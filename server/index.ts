import dotenv from "dotenv";
import path from "node:path";
import { createApp } from "./app";

dotenv.config({ path: ".env.local" });

if (process.env.NODE_ENV === "production" && !process.env.PUBLIC_ORIGIN) {
  throw new Error("PUBLIC_ORIGIN is required for the public demo.");
}

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const app = createApp({
  staticDir: process.env.NODE_ENV === "production" ? path.resolve("dist") : undefined,
});

const server = app.listen(port, host, () => {
  console.info(`Home Huddle listening at http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
