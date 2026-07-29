import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ALLOWED_DEPENDENCIES = [
  "@megasaver/evidence-ledger",
  "@megasaver/indexer",
  "@megasaver/policy",
  "@megasaver/shared",
  // B4: real BPE at the reporting boundary. Pure-JS ranks, lazy
  // dynamic-imported (guarded by test/tokens-real.test.ts) — never loaded
  // on package import.
  "js-tiktoken",
  "zod",
];

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  dependencies?: Record<string, string>;
};

describe("@megasaver/output-filter dependency graph (cycle guard)", () => {
  it("declares dependencies as a subset of the allow-list", () => {
    const deps = Object.keys(packageJson.dependencies ?? {});
    for (const dep of deps) {
      expect(ALLOWED_DEPENDENCIES).toContain(dep);
    }
  });

  it("does not depend on @megasaver/core", () => {
    const deps = Object.keys(packageJson.dependencies ?? {});
    expect(deps).not.toContain("@megasaver/core");
  });

  it("declares exactly the allow-listed dependencies", () => {
    const deps = Object.keys(packageJson.dependencies ?? {}).sort();
    expect(deps).toEqual([...ALLOWED_DEPENDENCIES].sort());
  });
});
