import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/** Fingerprint the source that determines local planning behavior and its oracle. */
export async function sourceFingerprint(root = process.cwd()): Promise<string> {
  const hash = createHash("sha256");
  for (const dir of ["server", "shared", "scripts"]) {
    const files = (await readdir(path.join(root, dir)))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .sort();
    for (const filename of files) {
      hash.update(`${dir}/${filename}\n`)
        .update(await readFile(path.join(root, dir, filename)));
    }
  }
  for (const filename of ["src/presets.ts", "package.json", "package-lock.json"]) {
    hash.update(`${filename}\n`)
      .update(await readFile(path.join(root, filename)));
  }
  return hash.digest("hex").slice(0, 16);
}
