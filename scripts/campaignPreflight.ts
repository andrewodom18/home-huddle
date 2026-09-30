import { z } from "zod";
import { sourceFingerprint } from "../server/sourceFingerprint";

const expectedModelId = "us.amazon.nova-2-lite-v1:0";
const expectedRegion = "us-east-1";
const healthSchema = z.object({
  status: z.literal("ok"),
  plannerVersion: z.literal(2),
  bedrockConfigured: z.literal(true),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{16}$/),
  modelId: z.literal(expectedModelId),
  region: z.literal(expectedRegion),
  instanceId: z.string().uuid(),
});

/** Reject stale processes, public proxies, and mismatched model configuration. */
export function assertCandidateHealth(value: unknown, fingerprint: string, instanceId?: string): string {
  const parsed = healthSchema.safeParse(value);
  if (!parsed.success || parsed.data.sourceFingerprint !== fingerprint ||
      (instanceId !== undefined && parsed.data.instanceId !== instanceId)) {
    throw new Error("The local planning API does not match the frozen source, model, or region.");
  }
  return parsed.data.instanceId;
}

export async function assertLocalCandidate(fingerprint: string, instanceId?: string): Promise<string> {
  if (await sourceFingerprint() !== fingerprint) {
    throw new Error("Campaign source changed after it was frozen.");
  }
  const response = await fetch("http://127.0.0.1:8787/api/health", {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("The local planning API health check failed.");
  return assertCandidateHealth(await response.json() as unknown, fingerprint, instanceId);
}

/** Never trust a call count after a process or source change during a request. */
export async function verifyCandidateAfterResponse(
  fingerprint: string,
  instanceId: string,
  callCount: unknown,
): Promise<{ matched: boolean; callCount: unknown }> {
  try {
    await assertLocalCandidate(fingerprint, instanceId);
    return { matched: true, callCount };
  } catch {
    return { matched: false, callCount: undefined };
  }
}
