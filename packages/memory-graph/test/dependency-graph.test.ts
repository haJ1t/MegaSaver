import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ALLOWED_DEPENDENCIES = ["@megasaver/shared", "zod"];
const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  dependencies?: Record<string, string>;
};

describe("@megasaver/memory-graph dependency graph (cycle guard)", () => {
  it("declares exactly the allow-listed dependencies", () => {
    const deps = Object.keys(packageJson.dependencies ?? {}).sort();
    expect(deps).toEqual([...ALLOWED_DEPENDENCIES].sort());
  });
  it("does not depend on @megasaver/core", () => {
    expect(Object.keys(packageJson.dependencies ?? {})).not.toContain("@megasaver/core");
  });
});
