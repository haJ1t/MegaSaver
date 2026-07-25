import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleSaveMemory } from "../../src/tools/save-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const TS = "2026-07-14T00:00:00.000Z";
const HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BLOB_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

let repoDir: string;
beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "save-memory-anchor-"));
  mkdirSync(join(repoDir, "src"), { recursive: true });
  writeFileSync(
    join(repoDir, "src", "auth.ts"),
    "export function verifyToken(token: string): boolean {\n  return token.length > 0;\n}\n",
  );
});
afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

function registryAt(rootPath: string): CoreRegistry {
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

// Mirrors the git calls the contract pins for captureCodeAnchor:
// `rev-parse HEAD` (repo head) and `cat-file --batch-check` (all cited blobs
// in one spawn, `HEAD:<path>` queries on stdin). Any other invocation throws,
// which capture treats as a skip. If the core capture implementation added
// further git probes, extend this fake to answer them — do not weaken the
// assertions.
function fakeExecGit(args: string[], _cwd: string, input?: string): string {
  const joined = args.join(" ");
  if (joined === "rev-parse HEAD") return HEAD_SHA;
  if (joined === "cat-file --batch-check") {
    const queries = (input ?? "").split("\n").filter((line) => line !== "");
    return `${queries.map(() => `${BLOB_SHA} blob 12`).join("\n")}\n`;
  }
  throw new Error(`unexpected git call: ${joined}`);
}

describe("save_memory — code anchor capture (i6 §5/§5.1)", () => {
  it("accepts relatedSymbols and stores the captured anchor on the entry", async () => {
    const registry = registryAt(repoDir);
    const result = await handleSaveMemory(
      {
        registry,
        now: () => TS,
        newId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        execGit: fakeExecGit,
      },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "verifyToken must reject empty tokens",
        type: "decision",
        relatedFiles: ["src/auth.ts"],
        relatedSymbols: ["verifyToken"],
      },
    );
    const stored = registry.getMemoryEntry(result.id as MemoryEntryId);
    expect(stored).not.toBeNull();
    expect(stored?.relatedSymbols).toEqual(["verifyToken"]);
    expect(stored?.anchor).toBeDefined();
    expect(stored?.anchor?.repoHead).toBe(HEAD_SHA);
    expect(stored?.anchor?.capturedAt).toBe(TS);
    expect(stored?.anchor?.files).toEqual([{ path: "src/auth.ts", blobSha: BLOB_SHA }]);
    const symbol = stored?.anchor?.symbols[0];
    expect(symbol?.path).toBe("src/auth.ts");
    expect(symbol?.name).toBe("verifyToken");
    expect(symbol?.contentHash).toBeTruthy();
  });

  // `relatedFiles` is an uncapped agent-supplied argument, and capture runs
  // synchronously inside the stdio request: one git spawn per path freezes the
  // whole server. Counted at two sizes — flat, not proportional.
  it("does not spawn one git per relatedFiles entry", async () => {
    const spawnsFor = async (n: number, id: string): Promise<number> => {
      const calls: string[][] = [];
      const execGit = (args: string[], _cwd: string, input?: string): string => {
        calls.push(args);
        if (args.join(" ") === "rev-parse HEAD") return HEAD_SHA;
        if (args[0] === "rev-parse") return BLOB_SHA;
        if (args.join(" ") === "cat-file --batch-check") {
          const queries = (input ?? "").split("\n").filter((line) => line !== "");
          return `${queries.map(() => `${BLOB_SHA} blob 12`).join("\n")}\n`;
        }
        throw new Error(`unexpected git call: ${args.join(" ")}`);
      };
      const registry = registryAt(repoDir);
      const result = await handleSaveMemory(
        { registry, now: () => TS, newId: () => id, execGit },
        {
          projectId: PROJECT_ID,
          scope: "project",
          content: "big related file list",
          relatedFiles: Array.from({ length: n }, (_, i) => `src/gen/f${i}.ts`),
        },
      );
      expect(registry.getMemoryEntry(result.id as MemoryEntryId)?.anchor?.files).toHaveLength(n);
      return calls.length;
    };

    const small = await spawnsFor(20, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    const large = await spawnsFor(400, "ffffffff-ffff-4fff-8fff-ffffffffffff");
    expect(large).toBe(small);
    expect(large).toBeLessThanOrEqual(2);
  });

  it("saves unanchored when the project root is not a git repo", async () => {
    const registry = registryAt(repoDir);
    const result = await handleSaveMemory(
      {
        registry,
        now: () => TS,
        newId: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        execGit: () => {
          throw new Error("fatal: not a git repository");
        },
      },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "verifyToken must reject empty tokens",
        relatedFiles: ["src/auth.ts"],
        relatedSymbols: ["verifyToken"],
      },
    );
    const stored = registry.getMemoryEntry(result.id as MemoryEntryId);
    expect(stored).not.toBeNull();
    expect(stored?.anchor).toBeUndefined();
    expect(stored?.relatedSymbols).toEqual(["verifyToken"]);
  });

  // i1 gauntlet BLOCKER regression: anchor/lastVerified are server-authority
  // fields (set only by the code-truth verify path). The .strict() input schema
  // must reject an agent smuggling them into rawArgs — they are never agent data.
  it("rejects an agent-forged anchor in the input", async () => {
    const registry = registryAt(repoDir);
    await expect(
      handleSaveMemory(
        {
          registry,
          now: () => TS,
          newId: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          execGit: fakeExecGit,
        },
        {
          projectId: PROJECT_ID,
          scope: "project",
          content: "x",
          anchor: { repoHead: "deadbeef", capturedAt: TS, files: [], symbols: [] },
        },
      ),
    ).rejects.toThrow(/validation_failed|Unrecognized key/);
  });

  it("rejects an agent-forged lastVerified in the input", async () => {
    const registry = registryAt(repoDir);
    await expect(
      handleSaveMemory(
        {
          registry,
          now: () => TS,
          newId: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          execGit: fakeExecGit,
        },
        {
          projectId: PROJECT_ID,
          scope: "project",
          content: "x",
          lastVerified: {
            headSha: "deadbeef",
            at: TS,
            result: "verified",
            closedByCodeTruth: false,
          },
        },
      ),
    ).rejects.toThrow(/validation_failed|Unrecognized key/);
  });
});
