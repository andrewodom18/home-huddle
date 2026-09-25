import { readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";

export const V3_CALL_CAP = 150;
const attemptSchema = z.object({
  id: z.string(), caseId: z.string(), sourceFingerprint: z.string(), startedAt: z.string(),
  ceiling: z.number().int().min(0).max(3), settled: z.boolean(),
});
const ledgerSchema = z.object({
  version: z.literal(3), cap: z.literal(V3_CALL_CAP),
  sourceFingerprint: z.string().min(1),
  attempts: z.array(attemptSchema),
});
export type V3CampaignLedger = z.infer<typeof ledgerSchema>;
export const v3Spent = (ledger: V3CampaignLedger) => ledger.attempts.reduce((sum, attempt) => sum + attempt.ceiling, 0);

/** A missing ledger can only start a new campaign with an explicit 150-call authorization. */
export async function readV3Ledger(path: string, sourceFingerprint: string): Promise<V3CampaignLedger> {
  try {
    const ledger = ledgerSchema.parse(JSON.parse(await readFile(path, "utf8")));
    if (v3Spent(ledger) > V3_CALL_CAP) throw new Error("Campaign cap exceeded");
    if (ledger.attempts.some((attempt) => attempt.sourceFingerprint !== ledger.sourceFingerprint)) throw new Error("Campaign ledger contains mixed source fingerprints");
    if (ledger.sourceFingerprint !== sourceFingerprint) throw new Error("V3 campaign source changed; keep this ledger and obtain a new campaign allowance before starting another campaign.");
    return ledger;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { version: 3, cap: V3_CALL_CAP, sourceFingerprint, attempts: [] };
    }
    if (error instanceof Error && error.message.startsWith("V3 campaign source changed")) throw error;
    throw new Error("V3 campaign ledger is unreadable; refusing to reset its call allowance.", { cause: error });
  }
}

async function save(path: string, ledger: V3CampaignLedger) {
  ledgerSchema.parse(ledger);
  if (v3Spent(ledger) > V3_CALL_CAP) throw new Error("Campaign cap exceeded");
  await writeFile(`${path}.tmp`, JSON.stringify(ledger, null, 2), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

/** Caller holds the exclusive v3 campaign lock. Reserve worst-case calls before network I/O. */
export async function reserveV3(path: string, ledger: V3CampaignLedger, caseId: string, fingerprint: string): Promise<string> {
  if (ledger.sourceFingerprint !== fingerprint) throw new Error("V3 campaign source changed");
  if (v3Spent(ledger) + 3 > V3_CALL_CAP) throw new Error("V3 campaign allowance exhausted");
  const id = `${ledger.attempts.length + 1}-${caseId}`;
  ledger.attempts.push({ id, caseId, sourceFingerprint: fingerprint, startedAt: new Date().toISOString(), ceiling: 3, settled: false });
  await save(path, ledger);
  return id;
}

export async function settleV3(path: string, ledger: V3CampaignLedger, id: string, calls: unknown) {
  const attempt = ledger.attempts.find((value) => value.id === id);
  if (!attempt || attempt.settled) throw new Error("Unknown or already settled V3 attempt");
  // Ambiguous or interrupted attempts retain all three reserved calls.
  if (typeof calls === "number" && Number.isInteger(calls) && calls >= 0 && calls <= 3) {
    attempt.ceiling = calls;
    attempt.settled = true;
  }
  await save(path, ledger);
}
