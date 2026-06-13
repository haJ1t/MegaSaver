import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The standalone bundle inlines the TypeScript compiler (via @megasaver/indexer),
// which reads __filename/__dirname at module load. A broken ESM bundle crashes
// on import before any command runs. This guards that regression locally when a
// bundle is present; CI builds the bundle and runs the same smoke unconditionally.
const bundle = join(dirname(fileURLToPath(import.meta.url)), "..", "dist-bundle", "mega.mjs");
const hasBundle = existsSync(bundle);

describe("standalone CLI bundle", () => {
  it.skipIf(!hasBundle)(
    "runs `doctor` from the built mega.mjs (exit 0, no ESM-global crash)",
    () => {
      const out = execFileSync(process.execPath, [bundle, "doctor"], { encoding: "utf8" });
      expect(out).toContain("PASS");
    },
  );
});
