import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ALLOWED_DEPENDENCIES = ["@megasaver/output-filter", "@megasaver/shared", "zod"];

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  dependencies?: Record<string, string>;
};

describe("@megasaver/stats dependency graph (cycle guard)", () => {
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

  it("does not depend on @megasaver/policy", () => {
    const deps = Object.keys(packageJson.dependencies ?? {});
    expect(deps).not.toContain("@megasaver/policy");
  });

  it("does not depend on @megasaver/retrieval", () => {
    const deps = Object.keys(packageJson.dependencies ?? {});
    expect(deps).not.toContain("@megasaver/retrieval");
  });

  it("declares exactly the allow-listed dependencies", () => {
    const deps = Object.keys(packageJson.dependencies ?? {}).sort();
    expect(deps).toEqual([...ALLOWED_DEPENDENCIES].sort());
  });
});
