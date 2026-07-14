import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractBlocksForFile } from "@megasaver/output-filter";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ExecGit, type MemoryRegistry, runVerify } from "../src/code-truth.js";

// Finding C: no real extractor throws (they all swallow parse errors), so force
// extractBlocksForFile to throw on demand. Delegates to the real extractor when
// the flag is off so the WOW integration test keeps real extraction.
const extractCtl = vi.hoisted(() => ({ throwOnExtract: false }));
vi.mock("@megasaver/output-filter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@megasaver/output-filter")>();
  return {
    ...actual,
    extractBlocksForFile: async (path: string, source: string) => {
      if (extractCtl.throwOnExtract) {
        throw new Error("extractor boom (loadExtractors/parse failure)");
      }
      return actual.extractBlocksForFile(path, source);
    },
  };
});
import type { CodeAnchor } from "../src/memory-anchor.js";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const E1 = "00000000-0000-4000-8000-0000000000d1" as MemoryEntryId;
const E2 = "00000000-0000-4000-8000-0000000000d2" as MemoryEntryId;
const TS = "2026-07-13T00:00:00.000Z";
const EARLIER = "2026-07-10T00:00:00.000Z";
const NOW = "2026-07-14T12:00:00.000Z";
const LATER = "2026-07-14T13:00:00.000Z";
const OLD_HEAD = "1111111111111111111111111111111111111111";
const HEAD = "2222222222222222222222222222222222222222";
const FALSIFIER = "3333333333333333333333333333333333333333";
const ROOT = tmpdir();

function mem(over: Omit<Partial<MemoryEntry>, "id"> & { id: string }): MemoryEntry {
  return memoryEntrySchema.parse({
    id: over.id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "auth verifies via verifyToken",
    content: "auth middleware validates requests via verifyToken",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: over.stale ?? false,
    createdAt: TS,
    updatedAt: TS,
    ...(over.anchor !== undefined ? { anchor: over.anchor } : {}),
    ...(over.lastVerified !== undefined ? { lastVerified: over.lastVerified } : {}),
    ...(over.validTo !== undefined ? { validTo: over.validTo } : {}),
    ...(over.evidence !== undefined ? { evidence: over.evidence } : {}),
  });
}

function freshRegistry(rootPath: string): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath,
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

function fileAnchor(path = "src/a.ts"): CodeAnchor {
  return {
    repoHead: OLD_HEAD,
    capturedAt: TS,
    files: [{ path, blobSha: "blob-old" }],
    symbols: [],
  };
}

type FakeGitState = {
  head: string;
  blobs: Record<string, string>;
  renames?: string;
  attribution?: Record<string, string>;
};

function fakeGit(state: FakeGitState): ExecGit {
  return (args, _cwd, input) => {
    if (args[0] === "rev-parse") {
      return `${state.head}\n`;
    }
    if (args[0] === "cat-file") {
      const lines = (input ?? "").split("\n").filter((line) => line !== "");
      return `${lines
        .map((line) => {
          const sha = state.blobs[line.replace(/^HEAD:/, "")];
          return sha === undefined ? `${line} missing` : `${sha} blob 100`;
        })
        .join("\n")}\n`;
    }
    if (args.includes("diff")) {
      return state.renames ?? "";
    }
    if (args[0] === "log") {
      const path = args[args.length - 1] ?? "";
      const sha = state.attribution?.[path];
      return sha === undefined ? "" : `${sha}\n`;
    }
    throw new Error(`unexpected git args: ${args.join(" ")}`);
  };
}

function spy(registry: CoreRegistry): { registry: MemoryRegistry; calls: () => number } {
  let applyCalls = 0;
  return {
    registry: {
      listMemoryEntries: (projectId) => registry.listMemoryEntries(projectId),
      applyMemoryEntryMutations: (projectId, mutations) => {
        applyCalls += 1;
        return registry.applyMemoryEntryMutations(projectId, mutations);
      },
    },
    calls: () => applyCalls,
  };
}

describe("runVerify — mutation semantics (fake git)", () => {
  it("contradiction closes an open row and owns the close", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor() }));
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: {}, attribution: { "src/a.ts": FALSIFIER } }),
    });
    expect(plan.contradicted).toEqual([{ id: E1, reason: "src/a.ts deleted", commit: FALSIFIER }]);
    const entry = registry.getMemoryEntry(E1);
    expect(entry?.stale).toBe(true);
    expect(entry?.validTo).toBe(NOW);
    expect(entry?.lastVerified).toEqual({
      headSha: HEAD,
      at: NOW,
      result: "contradicted",
      closedByCodeTruth: true,
    });
    expect(entry?.evidence).toContain(
      `code-truth: contradicted by ${FALSIFIER.slice(0, 7)} — src/a.ts deleted`,
    );
    // Verify is observation, not use — decay anchor untouched.
    expect(entry?.lastActiveAt).toBe(TS);
  });

  it("contradiction on an already-closed row leaves validTo, flag false", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor(), validTo: EARLIER }));
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: {}, attribution: { "src/a.ts": FALSIFIER } }),
    });
    expect(plan.contradicted).toHaveLength(1);
    const entry = registry.getMemoryEntry(E1);
    expect(entry?.stale).toBe(true);
    expect(entry?.validTo).toBe(EARLIER);
    expect(entry?.lastVerified?.closedByCodeTruth).toBe(false);
  });

  it("B1 REGRESSION: heal never reopens a close owned by the lineage channel", async () => {
    const registry = freshRegistry(ROOT);
    // Supersession closed this row (validTo set by lineage); a later verify
    // marked it contradicted WITHOUT owning the close (closedByCodeTruth
    // false because the row was already closed).
    registry.createMemoryEntry(
      mem({
        id: E1,
        anchor: fileAnchor(),
        stale: true,
        validTo: EARLIER,
        lastVerified: {
          headSha: OLD_HEAD,
          at: TS,
          result: "contradicted",
          closedByCodeTruth: false,
        },
      }),
    );
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: { "src/a.ts": "blob-old" } }),
    });
    expect(plan.healed).toEqual([E1]);
    const entry = registry.getMemoryEntry(E1);
    expect(entry?.stale).toBe(false);
    // The lineage close survives the heal — A must NOT resurrect alongside B.
    expect(entry?.validTo).toBe(EARLIER);
    expect(entry?.lastVerified?.result).toBe("healed");
  });

  it("heal reopens validTo when code-truth itself owned the close", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(
      mem({
        id: E1,
        anchor: fileAnchor(),
        stale: true,
        validTo: EARLIER,
        lastVerified: {
          headSha: OLD_HEAD,
          at: TS,
          result: "contradicted",
          closedByCodeTruth: true,
        },
      }),
    );
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: { "src/a.ts": "blob-old" } }),
    });
    expect(plan.healed).toEqual([E1]);
    const entry = registry.getMemoryEntry(E1);
    expect(entry?.validTo).toBeNull();
    expect(entry?.lastVerified).toEqual({
      headSha: HEAD,
      at: NOW,
      result: "healed",
      closedByCodeTruth: false,
    });
    expect(entry?.evidence).toContain(
      `code-truth: healed at ${HEAD.slice(0, 7)} — hash matches again`,
    );
  });

  it("verified no-op: repeat verify at unchanged head writes nothing", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(
      mem({
        id: E1,
        anchor: fileAnchor(),
        lastVerified: { headSha: HEAD, at: TS, result: "verified", closedByCodeTruth: false },
      }),
    );
    const spied = spy(registry);
    const plan = await runVerify({
      registry: spied.registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: { "src/a.ts": "blob-old" } }),
    });
    expect(plan.verified).toEqual([E1]);
    expect(spied.calls()).toBe(0);
    expect(registry.getMemoryEntry(E1)?.updatedAt).toBe(TS);
  });

  it("repeat contradiction at unchanged head appends no duplicate evidence", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(
      mem({
        id: E1,
        anchor: fileAnchor(),
        stale: true,
        validTo: EARLIER,
        lastVerified: { headSha: HEAD, at: TS, result: "contradicted", closedByCodeTruth: true },
        evidence: ["code-truth: contradicted by 3333333 — src/a.ts deleted"],
      }),
    );
    const spied = spy(registry);
    const plan = await runVerify({
      registry: spied.registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: {}, attribution: { "src/a.ts": FALSIFIER } }),
    });
    expect(plan.contradicted).toHaveLength(1);
    expect(spied.calls()).toBe(0);
    expect(registry.getMemoryEntry(E1)?.evidence).toHaveLength(1);
  });

  it("BLOCKER A: re-contradiction across a new HEAD keeps close ownership and heals", async () => {
    const HEAD_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const HEAD_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const HEAD_C = "cccccccccccccccccccccccccccccccccccccccc";
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor() }));

    // HEAD A: file gone ⇒ contradiction closes an open row and owns the close.
    await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD_A, blobs: {}, attribution: { "src/a.ts": FALSIFIER } }),
    });
    const afterA = registry.getMemoryEntry(E1);
    expect(afterA?.validTo).toBe(NOW);
    expect(afterA?.lastVerified?.closedByCodeTruth).toBe(true);
    expect(afterA?.evidence?.filter((line) => line.includes("contradicted"))).toHaveLength(1);

    // HEAD B: an UNRELATED commit moves HEAD; the file is still gone. The row
    // must STAY contradicted, keep close ownership, and grow NO duplicate
    // evidence — the old head-keyed guard clobbered closedByCodeTruth here.
    await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: LATER,
      execGit: fakeGit({ head: HEAD_B, blobs: {}, attribution: { "src/a.ts": FALSIFIER } }),
    });
    const afterB = registry.getMemoryEntry(E1);
    expect(afterB?.validTo).toBe(NOW);
    expect(afterB?.lastVerified?.closedByCodeTruth).toBe(true);
    expect(afterB?.evidence?.filter((line) => line.includes("contradicted"))).toHaveLength(1);

    // HEAD C: the file is restored ⇒ heal reopens the code-truth-owned close.
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: LATER,
      execGit: fakeGit({ head: HEAD_C, blobs: { "src/a.ts": "blob-old" } }),
    });
    expect(plan.healed).toEqual([E1]);
    const healed = registry.getMemoryEntry(E1);
    expect(healed?.validTo).toBeNull();
    expect(healed?.stale).toBe(false);
  });

  it("MAJOR F2: a concurrent evidence append survives runVerify's apply", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor() }));
    // Seam: a concurrent process (the post-commit hook, a SEPARATE process)
    // appends evidence AFTER the runner snapshots but BEFORE it applies. The
    // mutator recomputes from the fresh in-lock row, so the append survives.
    const raced: CoreRegistry = {
      ...registry,
      listMemoryEntries: (projectId) => {
        const snapshot = registry.listMemoryEntries(projectId);
        registry.updateMemoryEntry(E1, {
          evidence: ["concurrent: appended by another process"],
          updatedAt: LATER,
        });
        return snapshot;
      },
    };
    await runVerify({
      registry: raced,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: {}, attribution: { "src/a.ts": FALSIFIER } }),
    });
    const entry = registry.getMemoryEntry(E1);
    expect(entry?.evidence).toContain("concurrent: appended by another process");
    expect(entry?.evidence?.some((line) => line.includes("contradicted"))).toBe(true);
  });

  it("MINOR D: a concurrent delete skips the vanished id, applies the rest", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor() }));
    registry.createMemoryEntry(mem({ id: E2, anchor: fileAnchor("src/b.ts") }));
    // E2 is hard-deleted between the snapshot and the apply. The verify batch
    // must skip the vanished id, not abort — E1 still gets contradicted.
    const raced: CoreRegistry = {
      ...registry,
      listMemoryEntries: (projectId) => {
        const snapshot = registry.listMemoryEntries(projectId);
        registry.deleteMemoryEntry(E2);
        return snapshot;
      },
    };
    await runVerify({
      registry: raced,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({
        head: HEAD,
        blobs: {},
        attribution: { "src/a.ts": FALSIFIER, "src/b.ts": FALSIFIER },
      }),
    });
    expect(registry.getMemoryEntry(E1)?.stale).toBe(true);
    expect(registry.getMemoryEntry(E2)).toBeNull();
  });

  it("stamps lastVerified on first verify with ONE batch apply", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor() }));
    registry.createMemoryEntry(mem({ id: E2, anchor: fileAnchor() }));
    const spied = spy(registry);
    const plan = await runVerify({
      registry: spied.registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: { "src/a.ts": "blob-old" } }),
    });
    expect(plan.verified).toEqual([E1, E2]);
    expect(spied.calls()).toBe(1);
    expect(registry.getMemoryEntry(E1)?.lastVerified?.headSha).toBe(HEAD);
  });

  it("scope.changedPaths filters candidates to anchors citing a changed path", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor() }));
    registry.createMemoryEntry(mem({ id: E2, anchor: fileAnchor("src/other.ts") }));
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      scope: { changedPaths: ["src/a.ts"] },
      execGit: fakeGit({ head: HEAD, blobs: {}, attribution: { "src/a.ts": FALSIFIER } }),
    });
    expect(plan.contradicted.map((item) => item.id)).toEqual([E1]);
    expect(plan.verified).toEqual([]);
    expect(registry.getMemoryEntry(E2)?.lastVerified).toBeUndefined();
  });

  it("rename detection repoints the anchor instead of contradicting", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor() }));
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({
        head: HEAD,
        blobs: { "src/b.ts": "blob-new" },
        renames: "R100\tsrc/a.ts\tsrc/b.ts\n",
      }),
    });
    expect(plan.repointed).toEqual([{ id: E1, from: "src/a.ts", to: "src/b.ts" }]);
    expect(plan.contradicted).toEqual([]);
    expect(registry.getMemoryEntry(E1)?.anchor?.files[0]?.path).toBe("src/b.ts");
  });

  it("non-git project degrades to unanchored and writes nothing", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor() }));
    const failingGit: ExecGit = () => {
      throw new Error("not a git repository");
    };
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: failingGit,
    });
    expect(plan.unanchored).toEqual([E1]);
    expect(registry.getMemoryEntry(E1)?.lastVerified).toBeUndefined();
  });

  it("FINDING A: cat-file failure degrades to unanchored, never mass-contradicts", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor() }));
    const spied = spy(registry);
    // rev-parse succeeds (the repo IS git) but cat-file throws — a 3s timeout
    // or a fatal, NOT the normal per-object "missing" token. An UNDETERMINED
    // blob must never read as a deletion and close every file-anchored memory.
    const timingOutGit: ExecGit = (args) => {
      if (args[0] === "rev-parse") {
        return `${HEAD}\n`;
      }
      throw new Error("git timeout");
    };
    const plan = await runVerify({
      registry: spied.registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: timingOutGit,
    });
    expect(plan.unanchored).toEqual([E1]);
    expect(plan.contradicted).toEqual([]);
    expect(spied.calls()).toBe(0);
    const entry = registry.getMemoryEntry(E1);
    expect(entry?.stale).toBe(false);
    expect(entry?.validTo).toBeUndefined();
    expect(entry?.lastVerified).toBeUndefined();
  });

  it("FINDING C: extractor throw resolves without a false contradiction", async () => {
    const dir = mkdtempSync(join(tmpdir(), "megasaver-codetruth-extract-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/x.ts"), "export function foo() {}\n");
    const registry = freshRegistry(dir);
    registry.createMemoryEntry(
      mem({
        id: E1,
        anchor: {
          repoHead: OLD_HEAD,
          capturedAt: TS,
          files: [],
          symbols: [{ path: "src/x.ts", name: "foo", startLine: 1, endLine: 1, contentHash: "h" }],
        },
      }),
    );
    extractCtl.throwOnExtract = true;
    try {
      // A parser / loadExtractors fault must not reject the whole run, and an
      // undetermined symbol must never contradict (same rule as Finding A).
      const plan = await runVerify({
        registry,
        projectId: PROJECT_ID,
        rootPath: dir,
        now: NOW,
        execGit: fakeGit({ head: HEAD, blobs: { "src/x.ts": "blob-x" } }),
      });
      expect(plan.contradicted).toEqual([]);
      const entry = registry.getMemoryEntry(E1);
      expect(entry?.stale).toBe(false);
      expect(entry?.validTo).toBeUndefined();
    } finally {
      extractCtl.throwOnExtract = false;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("BLOCKER B: a transient (non-ENOENT) read fault degrades to undetermined", async () => {
    const dir = mkdtempSync(join(tmpdir(), "megasaver-codetruth-eisdir-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    // A directory at the symbol path makes readFileSync throw EISDIR — a
    // transient/unknown code, NOT ENOENT. It must never contradict (a disk
    // fault is not evidence the symbol is gone).
    mkdirSync(join(dir, "src/a.ts"), { recursive: true });
    const registry = freshRegistry(dir);
    registry.createMemoryEntry(
      mem({
        id: E1,
        anchor: {
          repoHead: OLD_HEAD,
          capturedAt: TS,
          files: [],
          symbols: [{ path: "src/a.ts", name: "foo", startLine: 1, endLine: 1, contentHash: "h" }],
        },
      }),
    );
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: dir,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: { "src/a.ts": "blob-x" } }),
    });
    expect(plan.contradicted).toEqual([]);
    const entry = registry.getMemoryEntry(E1);
    expect(entry?.stale).toBe(false);
    expect(entry?.validTo).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it("MINOR E: an unsupported-extension symbol path is undetermined, not contradicted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "megasaver-codetruth-unsupported-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    // A .txt file has no extractor ⇒ extractBlocksForFile returns undefined.
    // runVerify must treat it as undetermined (matching the spot-check), never
    // a false "symbol missing" contradiction.
    writeFileSync(join(dir, "src/notes.txt"), "plain prose, no code blocks\n");
    const registry = freshRegistry(dir);
    registry.createMemoryEntry(
      mem({
        id: E1,
        anchor: {
          repoHead: OLD_HEAD,
          capturedAt: TS,
          files: [],
          symbols: [
            { path: "src/notes.txt", name: "foo", startLine: 1, endLine: 1, contentHash: "h" },
          ],
        },
      }),
    );
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: dir,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: { "src/notes.txt": "blob-x" } }),
    });
    expect(plan.contradicted).toEqual([]);
    expect(registry.getMemoryEntry(E1)?.stale).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("runVerify — WOW loop on a real repo", () => {
  let repoDir: string;

  function git(args: string[]): string {
    return execFileSync("git", args, { cwd: repoDir, encoding: "utf8" });
  }

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "megasaver-codetruth-repo-"));
    git(["init"]);
    git(["config", "user.email", "t@t"]);
    git(["config", "user.name", "t"]);
    mkdirSync(join(repoDir, "src"), { recursive: true });
    writeFileSync(
      join(repoDir, "src/auth.ts"),
      [
        "export function verifyToken(token: string): boolean {",
        "  return token.length > 0;",
        "}",
        "",
        "export function parseToken(token: string): string {",
        "  return token.trim();",
        "}",
        "",
      ].join("\n"),
    );
    git(["add", "."]);
    git(["commit", "-m", "add auth"]);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("delete symbol -> commit -> contradicts naming the commit; revert -> heals", async () => {
    const anchorHead = git(["rev-parse", "HEAD"]).trim();
    const blobSha = git(["rev-parse", "HEAD:src/auth.ts"]).trim();
    const source = readFileSync(join(repoDir, "src/auth.ts"), "utf8");
    const extracted = await extractBlocksForFile("src/auth.ts", source);
    const symbol = extracted?.find((candidate) => candidate.name === "verifyToken");
    expect(symbol).toBeDefined();
    if (symbol === undefined) {
      throw new Error("fixture: verifyToken block not extracted");
    }

    const registry = freshRegistry(repoDir);
    registry.createMemoryEntry(
      mem({
        id: E1,
        anchor: {
          repoHead: anchorHead,
          capturedAt: TS,
          files: [{ path: "src/auth.ts", blobSha }],
          symbols: [
            {
              path: "src/auth.ts",
              name: "verifyToken",
              startLine: symbol.startLine,
              endLine: symbol.endLine,
              contentHash: symbol.contentHash,
            },
          ],
        },
      }),
    );

    // WOW step 1: a refactor deletes the anchored symbol.
    writeFileSync(
      join(repoDir, "src/auth.ts"),
      [
        "export function parseToken(token: string): string {",
        "  return token.trim();",
        "}",
        "",
      ].join("\n"),
    );
    git(["add", "."]);
    git(["commit", "-m", "remove verifyToken"]);
    const falsifier = git(["rev-parse", "HEAD"]).trim();

    const plan1 = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: repoDir,
      now: NOW,
    });
    expect(plan1.contradicted).toEqual([
      { id: E1, reason: "src/auth.ts#verifyToken missing", commit: falsifier },
    ]);
    const closed = registry.getMemoryEntry(E1);
    expect(closed?.stale).toBe(true);
    expect(closed?.validTo).toBe(NOW);
    expect(closed?.lastVerified?.closedByCodeTruth).toBe(true);
    expect(closed?.evidence?.some((line) => line.includes(falsifier.slice(0, 7)))).toBe(true);

    // WOW step 2: the code reverts — the memory heals, reopening the close
    // it owns.
    git(["revert", "--no-edit", "HEAD"]);
    const plan2 = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: repoDir,
      now: LATER,
    });
    expect(plan2.healed).toEqual([E1]);
    const healed = registry.getMemoryEntry(E1);
    expect(healed?.stale).toBe(false);
    expect(healed?.validTo).toBeNull();
    expect(healed?.lastVerified?.result).toBe("healed");
  }, 20000);
});
