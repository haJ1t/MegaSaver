import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ALLOWED_DEPENDENCIES = ["@megasaver/shared", "zod"];

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe("@megasaver/evidence-ledger dependency graph (cycle guard)", () => {
  it("declares exactly the allow-listed dependencies", () => {
    const deps = Object.keys(packageJson.dependencies ?? {}).sort();
    expect(deps).toEqual([...ALLOWED_DEPENDENCIES].sort());
  });

  it("does not depend on @megasaver/core", () => {
    expect(Object.keys(packageJson.dependencies ?? {})).not.toContain("@megasaver/core");
  });

  it("does not depend on @megasaver/content-store (decoupled via ChunkDeletePort)", () => {
    expect(Object.keys(packageJson.dependencies ?? {})).not.toContain("@megasaver/content-store");
  });

  it("does not pull @megasaver/core via devDependencies", () => {
    expect(Object.keys(packageJson.devDependencies ?? {})).not.toContain("@megasaver/core");
  });

  it("declares no @megasaver workspace package or connector outside the allow-list (incl. dev)", () => {
    const all = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ].filter((name) => name.startsWith("@megasaver/"));
    for (const dep of all) {
      expect(ALLOWED_DEPENDENCIES).toContain(dep);
    }
  });
});
