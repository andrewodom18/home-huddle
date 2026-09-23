import { readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";

// September 23: the user authorized a targeted recheck of the three failed
// cases. At most nine additional calls are reserved; the original 150-call
// allowance and its existing attempts remain in this same ledger.
export const CALL_CAP = 159;
const attemptSchema = z.object({
  id: z.string(), caseId: z.string(), sourceFingerprint: z.string(), startedAt: z.string(),
  ceiling: z.number().int().min(0).max(3), settled: z.boolean(),
});
const ledgerSchema = z.object({ version: z.literal(2), cap: z.literal(159), attempts: z.array(attemptSchema) });
const priorLedgerSchema = ledgerSchema.extend({ cap: z.literal(150) });
export type CampaignLedger = z.infer<typeof ledgerSchema>;
export const spent = (ledger: CampaignLedger) => ledger.attempts.reduce((sum, attempt) => sum + attempt.ceiling, 0);

export async function readLedger(path: string): Promise<CampaignLedger> {
  try {
    const saved = JSON.parse(await readFile(path, "utf8"));
    const parsed = saved?.cap === 150 ? priorLedgerSchema.parse(saved) : ledgerSchema.parse(saved);
    return { ...parsed, cap: CALL_CAP };
  }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { version: 2, cap: CALL_CAP, attempts: [] };
    throw new Error("Campaign ledger is unreadable; refusing to reset its call allowance.", { cause: error });
  }
}

async function save(path: string, ledger: CampaignLedger) {
  ledgerSchema.parse(ledger);
  if (spent(ledger) > CALL_CAP) throw new Error("Campaign cap exceeded");
  await writeFile(`${path}.tmp`, JSON.stringify(ledger, null, 2), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

/** Caller holds an exclusive campaign lock. Reserve the worst case before network I/O. */
export async function reserve(path: string, ledger: CampaignLedger, caseId: string, fingerprint: string): Promise<string> {
  if (spent(ledger) + 3 > CALL_CAP) throw new Error("Approved campaign allowance exhausted");
  const id = `${ledger.attempts.length + 1}-${caseId}`;
  ledger.attempts.push({ id, caseId, sourceFingerprint: fingerprint, startedAt: new Date().toISOString(), ceiling: 3, settled: false });
  await save(path, ledger);
  return id;
}

export async function settle(path: string, ledger: CampaignLedger, id: string, calls: unknown) {
  const attempt = ledger.attempts.find((value) => value.id === id);
  if (!attempt || attempt.settled) throw new Error("Unknown or already settled attempt");
  // Missing diagnostics retain the full reservation, including interrupted requests.
  if (typeof calls === "number" && Number.isInteger(calls) && calls >= 0 && calls <= 3) {
    attempt.ceiling = calls;
    attempt.settled = true;
  }
  await save(path, ledger);
}
