// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readV3Ledger, reserveV3, settleV3, v3Spent } from "./campaign-budget-v3";

const directories: string[] = [];
async function ledgerPath() {
  const directory = await mkdtemp(path.join(tmpdir(), "home-huddle-v3-"));
  directories.push(directory);
  return path.join(directory, "ledger.json");
}
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("separate v3 campaign budget", () => {
  it("reserves three calls before network activity and reconciles only known counts", async () => {
    const file = await ledgerPath();
    const ledger = await readV3Ledger(file, "source-a");
    const id = await reserveV3(file, ledger, "free-parallel", "source-a");
    expect(v3Spent(ledger)).toBe(3);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ version: 3, cap: 150, sourceFingerprint: "source-a" });
    await settleV3(file, ledger, id, 2);
    expect(v3Spent(await readV3Ledger(file, "source-a"))).toBe(2);
    const interrupted = await reserveV3(file, ledger, "free-cross-month", "source-a");
    await settleV3(file, ledger, interrupted, "unknown");
    expect(v3Spent(await readV3Ledger(file, "source-a"))).toBe(5);
  });

  it("fails closed on a changed source or unreadable ledger", async () => {
    const file = await ledgerPath();
    const ledger = await readV3Ledger(file, "source-a");
    await reserveV3(file, ledger, "free-parallel", "source-a");
    await expect(readV3Ledger(file, "source-b")).rejects.toThrow("source changed");
    await writeFile(file, "bad json");
    await expect(readV3Ledger(file, "source-a")).rejects.toThrow("unreadable");
  });

  it("does not reserve beyond 150 calls", async () => {
    const file = await ledgerPath();
    const ledger = await readV3Ledger(file, "source-a");
    for (let index = 0; index < 50; index += 1) await reserveV3(file, ledger, `case-${index}`, "source-a");
    expect(v3Spent(ledger)).toBe(150);
    await expect(reserveV3(file, ledger, "over-cap", "source-a")).rejects.toThrow("exhausted");
  });
});
