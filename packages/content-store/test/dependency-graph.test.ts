import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ALLOWED_DEPENDENCIES = ["@megasaver/output-filter", "@megasaver/shared", "zod"];

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe("@megasaver/content-store dependency graph (cycle guard)", () => {
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

  // §3c forbids the core edge in EITHER direction — a devDependency on core
  // is a latent cycle (core imports content-store), so the guard must cover
  // devDependencies too, not just runtime dependencies.
  it("does not pull @megasaver/core via devDependencies", () => {
    const devDeps = Object.keys(packageJson.devDependencies ?? {});
    expect(devDeps).not.toContain("@megasaver/core");
  });

  it("declares no @megasaver workspace package outside the allow-list (incl. dev)", () => {
    const all = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ].filter((name) => name.startsWith("@megasaver/"));
    for (const dep of all) {
      expect(ALLOWED_DEPENDENCIES).toContain(dep);
    }
  });
});
