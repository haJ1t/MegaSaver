import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// §8 / BB7b: the spawn capability lives in @megasaver/core's exec orchestrator,
// NOT in the CLI. `mega output exec` (exec.ts) is a thin adapter that forwards
// an injected spawn function to core without importing node:child_process or
// invoking spawn itself. Assert the CLI output sources never import the
// child-process module, never call spawn/execFile, and never reach for a shell
// — the boundary that keeps the CLI from owning process creation.
const outputDir = fileURLToPath(new URL("../../src/commands/output", import.meta.url));

function outputSources(): string[] {
  return readdirSync(outputDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(outputDir, name));
}

describe("mega output sources do not own child-process creation", () => {
  it("finds output command source files", () => {
    expect(outputSources().length).toBeGreaterThan(0);
  });

  it("imports no child_process module and invokes no spawn/execFile/exec call", () => {
    for (const file of outputSources()) {
      const source = readFileSync(file, "utf8");
      // No import of the process-creation module (with or without the node: prefix).
      expect(source).not.toContain("child_process");
      // No actual call sites — forwarding an injected `spawn` value (no call
      // parens) is allowed; `spawn(`, `execFile(`, `execSync(` etc. are not.
      expect(source).not.toMatch(/\bspawn(?:Sync)?\s*\(/);
      expect(source).not.toMatch(/\bexec(?:File|FileSync|Sync)?\s*\(/);
    }
  });
});
