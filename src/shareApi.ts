import { z } from "zod";
import type { HouseholdPlan } from "../shared/contracts";
import { shareCreateRequestSchema, shareResolveRequestSchema, shareSnapshotSchema } from "../shared/shareContracts";
import { requestJson } from "./request";

const createResponseSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32}$/), expiresAt: z.iso.datetime() });
const snapshotResponseSchema = shareSnapshotSchema.extend({ expiresAt: z.iso.datetime() });
const errorSchema = z.object({ error: z.object({ message: z.string().min(1).max(2000) }) });
export type SharedSnapshot = z.infer<typeof snapshotResponseSchema>;

async function postShare<T>(body: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  try {
    const { response, data } = await requestJson(body, { signal, timeoutMs: 15_000 });
    if (!response.ok) {
      const error = errorSchema.safeParse(data);
      throw new Error(error.success ? error.data.error.message : "Sharing is unavailable right now. Please try again.");
    }
    const result = schema.safeParse(data);
    if (!result.success) throw new Error("The sharing service returned an incomplete response. Please try again.");
    return result.data;
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "TimeoutError") throw new Error("Sharing took too long to respond. Please try again.", { cause: error });
    throw error;
  }
}

export function createShare(plan: HouseholdPlan, date: string, timeZone: string, signal?: AbortSignal) {
  return postShare(shareCreateRequestSchema.parse({ action: "share-create", plan, date, timeZone }), createResponseSchema, signal);
}

export function resolveShare(token: string, signal?: AbortSignal) {
  return postShare(shareResolveRequestSchema.parse({ action: "share-resolve", token }), snapshotResponseSchema, signal);
}

export function shareUrl(token: string): string {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin);
  url.hash = `share=${encodeURIComponent(token)}`;
  return url.toString();
}

export function shareTokenFromHash(): string | null {
  if (!window.location.hash.startsWith("#share=")) return null;
  try { return decodeURIComponent(window.location.hash.slice("#share=".length)); }
  catch { return ""; }
}
