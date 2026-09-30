// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFingerprint } from "./sourceFingerprint";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "huddle-source-"));
  for (const dir of ["server", "shared", "scripts", "src"]) await mkdir(path.join(root, dir));
  for (const filename of ["server/second.ts", "server/first.ts", "shared/contracts.ts", "scripts/runner.ts", "src/presets.ts", "package.json", "package-lock.json"]) {
    await writeFile(path.join(root, filename), filename);
  }
  return root;
}

describe("planning source fingerprint", () => {
  it("tracks behavior and package bytes but ignores tests", async () => {
    const root = await fixture();
    try {
      const original = await sourceFingerprint(root);
      await writeFile(path.join(root, "server/first.test.ts"), "new test");
      expect(await sourceFingerprint(root)).toBe(original);
      await writeFile(path.join(root, "server/first.ts"), "changed planning code");
      expect(await sourceFingerprint(root)).not.toBe(original);
      await writeFile(path.join(root, "server/first.ts"), "server/first.ts");
      await writeFile(path.join(root, "package-lock.json"), "changed dependencies");
      expect(await sourceFingerprint(root)).not.toBe(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
