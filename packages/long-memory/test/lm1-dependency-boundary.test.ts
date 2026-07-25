import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const lm1Files = [
  "lm1-model.ts",
  "lm1-identity.ts",
  "lm1-paths.ts",
  "lm1-store.ts",
  "lm1-capture.ts",
  "lm1-runtime.ts",
  "lm1-state.ts",
  "lm1-recall.ts",
] as const;

it("keeps LM1 isolated from LM0 protocol and product packages", () => {
  for (const file of lm1Files) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

    expect(source).not.toMatch(
      /@megasaver\/(core|evidence-ledger|connector-[^"']+|mcp-bridge)|benchmarks\/|longmemeval|\.\/(model|rpc|stdio)\.js/,
    );
  }
});

it("keeps LM1 package dependencies limited to its approved contracts", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { dependencies: Record<string, string> };

  expect(manifest.dependencies).toEqual({
    "@megasaver/retrieval": "workspace:*",
    "@megasaver/shared": "workspace:*",
    "fs-ext": "^2.1.1",
    zod: "^3.24.1",
  });
});

it("keeps the LM0 JSONL host free of LM1 protocol imports", () => {
  const source = readFileSync(new URL("../src/stdio.ts", import.meta.url), "utf8");

  expect(source).not.toContain("lm1-");
});
