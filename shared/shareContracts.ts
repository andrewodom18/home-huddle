import { z } from "zod";
import { householdPlanSchema } from "./contracts";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((date) => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}, "Choose a valid calendar date.");

const timeZoneSchema = z.string().min(1).max(80).refine((zone) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}, "Choose a valid IANA time zone.");

export const shareCreateRequestSchema = z.strictObject({
  action: z.literal("share-create"),
  plan: householdPlanSchema,
  date: dateSchema,
  timeZone: timeZoneSchema,
});

export const shareResolveRequestSchema = z.strictObject({
  action: z.literal("share-resolve"),
  token: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
});

export const shareSnapshotSchema = z.strictObject({
  plan: householdPlanSchema,
  date: dateSchema,
  timeZone: timeZoneSchema,
  createdAt: z.iso.datetime().optional(),
});

export type ShareSnapshot = z.infer<typeof shareSnapshotSchema>;
export type ShareCreateRequest = z.infer<typeof shareCreateRequestSchema>;
export type ShareResolveRequest = z.infer<typeof shareResolveRequestSchema>;

export type ShareCreateResponse = { token: string; expiresAt: string };
export type ShareResolveResponse = ShareSnapshot & { expiresAt: string };
export type ShareErrorResponse = {
  error: {
    code: "VALIDATION" | "RATE_LIMIT" | "SHARE_NOT_FOUND" | "SHARE_UNAVAILABLE";
    message: string;
    retryable: boolean;
  };
};
