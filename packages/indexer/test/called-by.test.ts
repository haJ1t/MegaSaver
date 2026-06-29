import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIndex } from "../src/build.js";
import { readBlocks, resolveIndexPaths } from "../src/store.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000002";

let repo: string;
let store: string;
let counter: number;

function newId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "mega-cb-repo-"));
  store = mkdtempSync(join(tmpdir(), "mega-cb-store-"));
  counter = 0;
  mkdirSync(join(repo, "src"));
  // root <- mid <- top, plus a sibling that also calls root.
  writeFileSync(join(repo, "src", "core.ts"), "export function root() { return 1; }\n");
  writeFileSync(join(repo, "src", "mid.ts"), "export function mid() { return root(); }\n");
  writeFileSync(join(repo, "src", "top.ts"), "export function top() { return mid(); }\n");
  writeFileSync(join(repo, "src", "sib.ts"), "export function sib() { return root(); }\n");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(store, { recursive: true, force: true });
});

describe("calledBy population (inverse of calls)", () => {
  it("calledBy[X] equals the names of every block whose calls include X", () => {
    buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID, newId });
    const blocks = readBlocks(resolveIndexPaths(store, PROJECT_ID));
    const byName = new Map(blocks.map((b) => [b.name, b]));

    expect(byName.get("root")?.calledBy.sort()).toEqual(["mid", "sib"]);
    expect(byName.get("mid")?.calledBy).toEqual(["top"]);
    expect(byName.get("top")?.calledBy).toEqual([]);
  });

  it("calledBy is the exact inverse of calls across the indexed set", () => {
    buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID, newId });
    const blocks = readBlocks(resolveIndexPaths(store, PROJECT_ID));

    const forward = new Set<string>();
    for (const b of blocks) {
      if (b.name === undefined) continue;
      for (const callee of b.calls) forward.add(`${b.name}->${callee}`);
    }
    const reverse = new Set<string>();
    for (const b of blocks) {
      if (b.name === undefined) continue;
      for (const caller of b.calledBy) reverse.add(`${caller}->${b.name}`);
    }
    // Every reverse edge must correspond to a forward edge whose callee is indexed.
    const indexedNames = new Set(blocks.map((b) => b.name));
    for (const edge of forward) {
      const callee = edge.split("->")[1];
      if (callee && indexedNames.has(callee)) expect(reverse.has(edge)).toBe(true);
    }
    for (const edge of reverse) expect(forward.has(edge)).toBe(true);
  });
});
