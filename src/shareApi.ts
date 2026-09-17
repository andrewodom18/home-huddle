import type { HouseholdPlan } from "../shared/contracts";

export type SharedSnapshot = {
  plan: HouseholdPlan;
  date: string;
  timeZone: string;
  expiresAt: string;
};

type CreateShareResponse = { token: string; expiresAt: string };

async function postShare<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(import.meta.env.VITE_API_URL || "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = data as { error?: { message?: string } } | undefined;
    throw new Error(error?.error?.message || "Sharing is unavailable right now.");
  }
  return data as T;
}

export function createShare(plan: HouseholdPlan, date: string, timeZone: string) {
  return postShare<CreateShareResponse>({ action: "share-create", plan, date, timeZone });
}

export function resolveShare(token: string) {
  return postShare<SharedSnapshot>({ action: "share-resolve", token });
}

export function shareUrl(token: string): string {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin);
  url.hash = `share=${encodeURIComponent(token)}`;
  return url.toString();
}

export function shareTokenFromHash(): string | null {
  return window.location.hash.startsWith("#share=")
    ? window.location.hash.slice("#share=".length)
    : null;
}
