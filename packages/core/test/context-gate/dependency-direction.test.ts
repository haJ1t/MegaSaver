import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @megasaver/stats joins the allow-list in BB7b: the exec orchestrator
// (run-command.ts) appends a TokenSaverEvent via stats.appendEvent. This stays
// acyclic — stats depends only on output-filter + shared and never imports
// @megasaver/core — so core → stats introduces no cycle.
const ALLOWED_DEPENDENCIES = [
  "@megasaver/content-store",
  "@megasaver/output-filter",
  "@megasaver/policy",
  "@megasaver/shared",
  "@megasaver/stats",
  "zod",
];

const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe("@megasaver/core context-gate dependency direction (§3c cycle guard)", () => {
  it("declares dependencies as a subset of the allow-list", () => {
    const deps = Object.keys(packageJson.dependencies ?? {});
    for (const dep of deps) {
      expect(ALLOWED_DEPENDENCIES).toContain(dep);
    }
  });

  it("declares exactly the allow-listed dependencies", () => {
    const deps = Object.keys(packageJson.dependencies ?? {}).sort();
    expect(deps).toEqual([...ALLOWED_DEPENDENCIES].sort());
  });

  it("does not depend on @megasaver/mcp-bridge", () => {
    const all = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];
    expect(all).not.toContain("@megasaver/mcp-bridge");
  });

  it("does not depend on any apps/* package", () => {
    const all = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];
    for (const dep of all) {
      expect(dep.startsWith("@megasaver/cli")).toBe(false);
      expect(dep.startsWith("@megasaver/gui")).toBe(false);
    }
  });
});
