import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createApp } from "./app";
import { sourceFingerprint } from "./sourceFingerprint";

dotenv.config({ path: ".env.local" });

if (process.env.NODE_ENV === "production" && !process.env.PUBLIC_ORIGIN) {
  throw new Error("PUBLIC_ORIGIN is required for the public demo.");
}

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const candidateIdentity = process.env.NODE_ENV === "production"
  ? undefined
  : {
      sourceFingerprint: await sourceFingerprint(),
      modelId: process.env.BEDROCK_MODEL_ID ?? "us.amazon.nova-2-lite-v1:0",
      region: process.env.AWS_REGION ?? "us-east-1",
      instanceId: randomUUID(),
    };
const app = createApp({
  staticDir: process.env.NODE_ENV === "production" ? path.resolve("dist") : undefined,
  candidateIdentity,
});

const server = app.listen(port, host, () => {
  console.info(`Home Huddle listening at http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
