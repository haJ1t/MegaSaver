import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOOK_PATH_SOURCES = [
  new URL("../../src/hooks/package-firewall-run.ts", import.meta.url),
  new URL("../../src/hooks/guard-run.ts", import.meta.url),
  new URL("../../src/hooks/board-inject.ts", import.meta.url),
  new URL("../../src/store.ts", import.meta.url),
  new URL("../../src/commands/warmup.ts", import.meta.url),
  new URL("../../../../packages/context-gate/src/package-refs.ts", import.meta.url),
  new URL("../../../../packages/context-gate/src/package-local-resolve.ts", import.meta.url),
  new URL("../../../../packages/context-gate/src/package-registry-cache.ts", import.meta.url),
  new URL("../../../../packages/context-gate/src/package-typosquat.ts", import.meta.url),
  new URL("../../../../packages/context-gate/src/firewall-ledger.ts", import.meta.url),
  new URL("../../../../packages/context-gate/src/data/npm-top.ts", import.meta.url),
  new URL("../../../../packages/context-gate/src/data/pypi-top.ts", import.meta.url),
  new URL("../../../../packages/context-gate/src/data/python-stdlib.ts", import.meta.url),
  new URL("../../../../packages/context-gate/src/data/pypi-import-aliases.ts", import.meta.url),
];

// Module-level needles: only network-capable IMPORTS — the data files list
// real package names ("undici" is a legitimate npm package), so a bare-name
// needle would false-positive on them.
const FORBIDDEN = [
  "fetch(",
  "node:http",
  "node:https",
  "node:http2",
  "node:net",
  "node:dns",
  "node:tls",
  'from "undici"',
  'from "node-fetch"',
  'require("undici")',
  'require("node-fetch")',
];

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
