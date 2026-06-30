import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, readBlocks, resolveIndexPaths } from "@megasaver/indexer";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildImpactPack } from "../src/pack.js";

// End-to-end recall guard (buildIndex → buildImpactPack): a true caller must
// never be silently dropped from a blast radius. Two regressions an earlier
// pass shipped, both fixed at the build-time invert: (1) a NodeNext ".js"
// specifier resolved to a phantom file and the caller fell into no bucket;
// (2) an incremental reused caller kept a stale resolvedCalls FQN after the
// target was renamed. Both are now bucketed under the "#name" floor when the
// resolved FQN owns no current block, recovered by select.ts's per-edge byName.

const PID = "00000000-0000-4000-8000-0000000000ee" as ProjectId;
let repo: string;
let store: string;
let c: number;
const newId = (): string => `00000000-0000-4000-8000-${(c++).toString(16).padStart(12, "0")}`;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "recall-"));
  store = mkdtempSync(join(tmpdir(), "recall-s-"));
  c = 1;
  mkdirSync(join(repo, "src"));
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(store, { recursive: true, force: true });
});

describe("impact recall (no true caller dropped)", () => {
  it("a NodeNext .js-suffixed caller is kept alongside an extensionless caller", async () => {
    writeFileSync(join(repo, "src", "tgt.ts"), "export function parse(){return 1;}\n");
    writeFileSync(
      join(repo, "src", "a.ts"),
      'import {parse} from "./tgt";\nexport function callA(){return parse();}\n',
    );
    writeFileSync(
      join(repo, "src", "b.ts"),
      'import {parse} from "./tgt.js";\nexport function callB(){return parse();}\n',
    );
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PID, newId });
    const blocks = readBlocks(resolveIndexPaths(store, PID));
    const names = buildImpactPack({ symbol: "parse", blocks }).included.map((x) => x.name);
    expect(names).toContain("callA");
    expect(names).toContain("callB");
  });

  it("a .js specifier resolves PRECISELY so same-name cross-file callers stay disambiguated", async () => {
    // Fix 1 (NodeNext .js → .ts remap) must resolve precisely, not just via the
    // name floor — else two same-named `parse` re-acquire each other's callers.
    writeFileSync(join(repo, "src", "ta.ts"), "export function parse(){return 1;}\n");
    writeFileSync(join(repo, "src", "tb.ts"), "export function parse(){return 2;}\n");
    writeFileSync(
      join(repo, "src", "ua.ts"),
      'import {parse} from "./ta.js";\nexport function useA(){return parse();}\n',
    );
    writeFileSync(
      join(repo, "src", "ub.ts"),
      'import {parse} from "./tb.js";\nexport function useB(){return parse();}\n',
    );
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PID, newId });
    const blocks = readBlocks(resolveIndexPaths(store, PID));
    const ta = blocks.find((x) => x.filePath === "src/ta.ts" && x.name === "parse");
    expect(ta?.resolvedCalledBy).toEqual(["src/ua.ts#useA"]);
    const names = buildImpactPack({ symbol: "parse", blocks }).included.map((x) => x.name);
    expect(names).toContain("useA");
    expect(names).not.toContain("useB");
  });

  it("incremental rename: an untouched caller is kept alongside a fresh caller", async () => {
    writeFileSync(join(repo, "src", "def.ts"), "export function work(){return 1;}\n");
    writeFileSync(
      join(repo, "src", "legacy.ts"),
      'import {work} from "./def";\nexport function legacyCaller(){return work();}\n',
    );
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PID, newId });
    // Rename the target; legacy.ts content unchanged ⇒ its block is reused with a
    // now-stale resolvedCalls FQN. A fresh caller imports the new path.
    renameSync(join(repo, "src", "def.ts"), join(repo, "src", "def2.ts"));
    writeFileSync(join(repo, "src", "def2.ts"), "export function work(){return 1;}\n");
    writeFileSync(
      join(repo, "src", "fresh.ts"),
      'import {work} from "./def2";\nexport function freshCaller(){return work();}\n',
    );
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PID, newId });
    const blocks = readBlocks(resolveIndexPaths(store, PID));
    const names = buildImpactPack({ symbol: "work", blocks }).included.map((x) => x.name);
    expect(names).toContain("freshCaller");
    expect(names).toContain("legacyCaller");
  });
});
