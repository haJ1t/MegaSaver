import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// §3c allow-list (BB7a): apps/cli may import exactly these @megasaver/*
// packages after BB7a. The non-Mega deps (citty, zod) are ignored by the
// @megasaver/ filter below.
const ALLOWED_MEGA_DEPENDENCIES = [
  "@megasaver/connector-generic-cli",
  "@megasaver/connectors-shared",
  "@megasaver/content-store",
  "@megasaver/core",
  "@megasaver/output-filter",
  "@megasaver/policy",
  "@megasaver/shared",
];

const FORBIDDEN_DEPENDENCIES = [
  "@megasaver/mcp-bridge",
  "@megasaver/retrieval",
  "@megasaver/stats",
];

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  dependencies?: Record<string, string>;
};

function megaDeps(): string[] {
  return Object.keys(packageJson.dependencies ?? {}).filter((d) => d.startsWith("@megasaver/"));
}

describe("@megasaver/cli dependency graph (cycle guard)", () => {
  it("declares @megasaver/* dependencies as a subset of the allow-list", () => {
    for (const dep of megaDeps()) {
      expect(ALLOWED_MEGA_DEPENDENCIES).toContain(dep);
    }
  });

  it("declares the three BB7a deps (policy, output-filter, content-store)", () => {
    const deps = megaDeps();
    expect(deps).toContain("@megasaver/policy");
    expect(deps).toContain("@megasaver/output-filter");
    expect(deps).toContain("@megasaver/content-store");
  });

  it("does not depend on mcp-bridge, retrieval, or stats", () => {
    const deps = Object.keys(packageJson.dependencies ?? {});
    for (const forbidden of FORBIDDEN_DEPENDENCIES) {
      expect(deps).not.toContain(forbidden);
    }
  });
});
