// @vitest-environment node
import dotenv from "dotenv";
import { describe, expect, it } from "vitest";
import { createBedrockGateway } from "./bedrock";

dotenv.config({ path: ".env.local" });

const liveEnabled =
  process.env.LIVE_BEDROCK === "1" &&
  (process.env.BEDROCK_AUTH_MODE === "iam" ||
    Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK));

describe.skipIf(!liveEnabled)("Amazon Bedrock live smoke test", () => {
  it("receives a real Converse response", async () => {
    const gateway = createBedrockGateway();
    const response = await gateway.converse([
      {
        role: "user",
        content: [
          {
            text: "Ask one short question to clarify a household planning request.",
          },
        ],
      },
    ]);

    expect(response.output.message.role).toBe("assistant");
    expect(response.output.message.content.length).toBeGreaterThan(0);
  }, 35_000);
});
