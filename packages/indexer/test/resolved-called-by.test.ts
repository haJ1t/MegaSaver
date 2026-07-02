import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIndex } from "../src/build.js";
import type { CodeBlock } from "../src/code-block.js";
import { readBlocks, resolveIndexPaths } from "../src/store.js";

const PROJECT_ID = projectIdSchema.parse("00000000-0000-4000-8000-000000000003");

let repo: string;
let store: string;
let counter: number;

function newId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "mega-rcb-repo-"));
  store = mkdtempSync(join(tmpdir(), "mega-rcb-store-"));
  counter = 0;
  mkdirSync(join(repo, "src"));
  // TWO files each export a same-named `parse`. a.ts#parse is imported+called
  // only by useA (in usea.ts); b.ts#parse only by useB (in useb.ts).
  writeFileSync(join(repo, "src", "a.ts"), "export function parse() { return 1; }\n");
  writeFileSync(join(repo, "src", "b.ts"), "export function parse() { return 2; }\n");
  writeFileSync(
    join(repo, "src", "usea.ts"),
    `import { parse } from "./a";\nexport function useA() { return parse(); }\n`,
  );
  writeFileSync(
    join(repo, "src", "useb.ts"),
    `import { parse } from "./b";\nexport function useB() { return parse(); }\n`,
  );
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(store, { recursive: true, force: true });
});

function blockAt(blocks: CodeBlock[], filePath: string, name: string): CodeBlock | undefined {
  return blocks.find((b) => b.filePath === filePath && b.name === name);
}

describe("resolvedCalledBy disambiguates same-named cross-file functions", () => {
  it("a.ts#parse is called only by useA; b.ts#parse only by useB", async () => {
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID, newId });
    const blocks = readBlocks(resolveIndexPaths(store, PROJECT_ID));

    const aParse = blockAt(blocks, "src/a.ts", "parse");
    const bParse = blockAt(blocks, "src/b.ts", "parse");
    expect(aParse).toBeDefined();
    expect(bParse).toBeDefined();

    // The PROOF: the old name-based calledBy would list BOTH useA and useB on
    // each parse (same name). The resolved field separates them by import target.
    expect(aParse?.calledBy.sort()).toEqual(["useA", "useB"]);
    expect(bParse?.calledBy.sort()).toEqual(["useA", "useB"]);

    expect(aParse?.resolvedCalledBy).toEqual(["src/usea.ts#useA"]);
    expect(bParse?.resolvedCalledBy).toEqual(["src/useb.ts#useB"]);
  });

  it("callers carry resolvedCalls pointing at the precise file#name", async () => {
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID, newId });
    const blocks = readBlocks(resolveIndexPaths(store, PROJECT_ID));

    const useA = blockAt(blocks, "src/usea.ts", "useA");
    const useB = blockAt(blocks, "src/useb.ts", "useB");
    expect(useA?.resolvedCalls).toContain("src/a.ts#parse");
    expect(useA?.resolvedCalls).not.toContain("src/b.ts#parse");
    expect(useB?.resolvedCalls).toContain("src/b.ts#parse");
    expect(useB?.resolvedCalls).not.toContain("src/a.ts#parse");
  });
});

describe("namespace-member calls keep name-fallback reach (no edge lost)", () => {
  it("a function called via `ns.x()` is still in its callee's resolvedCalledBy by name", async () => {
    // useNs imports * as ns from ./helper and calls ns.run(). The build extracts
    // the bare call `run`, can't pin it to a file (binding is `ns`), so the edge
    // stays "#run". The callee `run` must still list useNs (via the unresolved
    // bucket) so resolved-mode reach is never less than name-mode.
    mkdirSync(join(repo, "deep"));
    writeFileSync(join(repo, "deep", "helper.ts"), "export function run() { return 7; }\n");
    writeFileSync(
      join(repo, "deep", "consumer.ts"),
      `import * as ns from "./helper";\nexport function useNs() { return ns.run(); }\n`,
    );
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID, newId });
    const blocks = readBlocks(resolveIndexPaths(store, PROJECT_ID));
    const run = blockAt(blocks, "deep/helper.ts", "run");
    const useNs = blockAt(blocks, "deep/consumer.ts", "useNs");
    expect(useNs?.resolvedCalls).toEqual(["#run"]);
    // name fallback: useNs reaches `run` despite the unresolved namespace call.
    expect(run?.calledBy).toEqual(["useNs"]);
    expect(run?.resolvedCalledBy).toContain("deep/consumer.ts#useNs");
  });
});
