import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// §3c allow-list: apps/cli may import exactly these @megasaver/*
// packages. BB8 adds @megasaver/mcp-bridge (the `mega mcp` CLI drives
// the bridge's install/status facade); skill-packs-real adds
// @megasaver/skill-packs (the `mega pack` CLI drives the loader and
// installer directly — core does not depend on skill-packs, so a core
// re-export is not available). connector-claude-code is added so the CLI
// can drive the Claude Code connector's saver hook directly; it stays
// acyclic — the connector depends only on connectors-shared/core/shared/zod,
// never on the CLI. The arrow stays acyclic — skill-packs
// depends only on zod, never on the CLI.
// The non-Mega deps (citty, zod) are ignored by the @megasaver/ filter.
const ALLOWED_MEGA_DEPENDENCIES = [
  "@megasaver/connector-claude-code",
  "@megasaver/connector-generic-cli",
  "@megasaver/connectors-shared",
  "@megasaver/content-store",
  "@megasaver/context-pruner",
  "@megasaver/core",
  "@megasaver/indexer",
  "@megasaver/mcp-bridge",
  "@megasaver/output-filter",
  "@megasaver/policy",
  "@megasaver/shared",
  "@megasaver/skill-packs",
];

const FORBIDDEN_DEPENDENCIES = ["@megasaver/retrieval", "@megasaver/stats"];

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

// The CLI ships as a self-contained bundle (every workspace dep is inlined),
// so its @megasaver/* deps are declared as devDependencies — they are build-time
// inputs to the bundle, not runtime deps. The cycle guard cares about the import
// graph, not the dependency-type label, so it reads both maps.
function declaredDeps(): string[] {
  return Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
}

function megaDeps(): string[] {
  return declaredDeps().filter((d) => d.startsWith("@megasaver/"));
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

  it("does not depend on retrieval or stats", () => {
    const deps = declaredDeps();
    for (const forbidden of FORBIDDEN_DEPENDENCIES) {
      expect(deps).not.toContain(forbidden);
    }
  });
});
