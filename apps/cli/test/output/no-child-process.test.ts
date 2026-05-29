import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// §8: BB7a holds at HIGH (not CRITICAL) precisely because no command is
// spawned. `exec` (child_process) lands in BB7b. Assert the spawn boundary
// stays out of every output command source file.
const outputDir = fileURLToPath(new URL("../../src/commands/output", import.meta.url));

function outputSources(): string[] {
  return readdirSync(outputDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(outputDir, name));
}

describe("mega output sources contain no child-process spawn", () => {
  it("finds output command source files", () => {
    expect(outputSources().length).toBeGreaterThan(0);
  });

  it("imports neither child_process nor node:child_process and never calls spawn", () => {
    for (const file of outputSources()) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("child_process");
      expect(source).not.toContain("spawn");
      expect(source).not.toContain("execFile");
    }
  });
});
