import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOOK_PATH_SOURCES = [
  new URL("../../src/hooks/package-firewall-run.ts", import.meta.url),
  new URL("../../src/hooks/guard-run.ts", import.meta.url),
  new URL("../../../../packages/context-gate/src/package-refs.ts", import.meta.url),
  new URL("../../../../packages/context-gate/src/package-local-resolve.ts", import.meta.url),
  new URL("../../../../packages/context-gate/src/package-registry-cache.ts", import.meta.url),
  new URL("../../../../packages/context-gate/src/package-typosquat.ts", import.meta.url),
];

const FORBIDDEN = ["fetch(", "node:http", "node:https", "undici"];

const REFRESH_SOURCE = new URL("../../src/commands/firewall/refresh.ts", import.meta.url);

function readSource(url: URL): string {
  return readFileSync(fileURLToPath(url), "utf8");
}

describe("no network I/O in any hook path", () => {
  it("every hook-path module is free of fetch/http imports", () => {
    for (const url of HOOK_PATH_SOURCES) {
      const src = readSource(url);
      for (const needle of FORBIDDEN) {
        expect(src, `${fileURLToPath(url)} contains "${needle}"`).not.toContain(needle);
      }
    }
  });

  // Non-vacuity (redos-guard-testing: the instrument must be able to fire).
  it("refresh.ts DOES contain fetch( — the instrument can fire", () => {
    expect(readSource(REFRESH_SOURCE)).toContain("fetch(");
  });
});
