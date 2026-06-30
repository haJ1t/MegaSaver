import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextPackSchema } from "@megasaver/context-pruner";
import { createInMemoryCoreRegistry, memoryEmbeddingsSidecarPath } from "@megasaver/core";
import { writeVectors } from "@megasaver/embeddings";
import { buildIndex } from "@megasaver/indexer";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";
import { McpBridgeError } from "../../src/errors.js";
import {
  handleGetContextBudgetReport,
  handleGetRelevantCodeBlocks,
  handleGetRelevantContext,
} from "../../src/tools/context-pruning.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-11T00:00:00.000Z";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup(): Promise<{
  env: { registry: ReturnType<typeof createInMemoryCoreRegistry>; storeRoot: string };
}> {
  const store = mkdtempSync(join(tmpdir(), "mcp-ctx-store-"));
  const repo = mkdtempSync(join(tmpdir(), "mcp-ctx-repo-"));
  dirs.push(store, repo);
  mkdirSync(join(repo, "src"));
  writeFileSync(
    join(repo, "src", "auth.ts"),
    "export function validateToken(t: string) {\n  return t.length > 0;\n}\n",
  );
  await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID as never });
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID as never,
    name: "demo",
    rootPath: repo,
    createdAt: TS,
    updatedAt: TS,
  });
  return { env: { registry, storeRoot: store } };
}

describe("context MCP tools", () => {
  it("get_relevant_context returns a schema-valid pack", async () => {
    const { env } = await setup();
    const pack = await handleGetRelevantContext(env, {
      projectId: PROJECT_ID,
      task: "fix validateToken",
    });
    expect(contextPackSchema.safeParse(pack).success).toBe(true);
    expect(pack.included.some((b) => b.name === "validateToken")).toBe(true);
  });

  it("get_relevant_code_blocks projects the included blocks", async () => {
    const { env } = await setup();
    const blocks = await handleGetRelevantCodeBlocks(env, {
      projectId: PROJECT_ID,
      task: "validateToken",
    });
    expect(Array.isArray(blocks)).toBe(true);
  });

  it("get_context_budget_report returns audit numbers", async () => {
    const { env } = await setup();
    const audit = await handleGetContextBudgetReport(env, { projectId: PROJECT_ID, task: "auth" });
    expect(audit.blocksConsidered).toBeGreaterThanOrEqual(1);
  });

  it("rejects a missing task", async () => {
    const { env } = await setup();
    await expect(handleGetRelevantContext(env, { projectId: PROJECT_ID })).rejects.toThrow(
      McpBridgeError,
    );
  });

  it("rejects an unknown project", async () => {
    const { env } = await setup();
    await expect(
      handleGetRelevantContext(env, {
        projectId: "22222222-2222-4222-8222-222222222222",
        task: "x",
      }),
    ).rejects.toThrowError(/project not found/);
  });
});

const CO_PROJECT_ID = "33333333-3333-4333-8333-333333333333";

function git(repo: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "ignore" });
}

// A repo whose migration always co-changes with the edit-site file but shares no
// task keywords with it: the only reason it can rank is git history.
async function setupCoChangeRepo(useGit: boolean): Promise<{
  env: { registry: ReturnType<typeof createInMemoryCoreRegistry>; storeRoot: string };
}> {
  const store = mkdtempSync(join(tmpdir(), "mcp-cochange-store-"));
  const repo = mkdtempSync(join(tmpdir(), "mcp-cochange-repo-"));
  dirs.push(store, repo);
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, "migrations"));
  writeFileSync(
    join(repo, "src", "auth.ts"),
    "export function validateToken() {\n  return true;\n}\n",
  );
  // .md so the indexer extracts it (it indexes ts/md/json, not sql) — the block
  // must exist in the pack for its co-change factor to be observable.
  writeFileSync(join(repo, "migrations", "001.md"), "# release notes\nschema bump\n");

  if (useGit) {
    git(repo, "init");
    git(repo, "config", "user.email", "t@t.t");
    git(repo, "config", "user.name", "t");
    // Three commits that touch auth.ts AND 001.md together → strong co-change.
    for (let i = 0; i < 3; i += 1) {
      writeFileSync(
        join(repo, "src", "auth.ts"),
        `export function validateToken() {\n  return ${i};\n}\n`,
      );
      writeFileSync(join(repo, "migrations", "001.md"), `# release notes v${i}\nschema bump\n`);
      git(repo, "add", "-A");
      git(repo, "commit", "-m", `change ${i}`);
    }
  }

  await buildIndex({ rootDir: repo, storeDir: store, projectId: CO_PROJECT_ID as never });
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: CO_PROJECT_ID as never,
    name: "cochange",
    rootPath: repo,
    createdAt: TS,
    updatedAt: TS,
  });
  return { env: { registry, storeRoot: store } };
}

type CoChangeEnv = Awaited<ReturnType<typeof setupCoChangeRepo>>["env"];

async function migrationFactor(env: CoChangeEnv): Promise<number | undefined> {
  const pack = await handleGetRelevantContext(env, {
    projectId: CO_PROJECT_ID,
    // A task with no overlap with "migration"/"sql" so semantic relevance can't
    // explain a rank bump — only co-change history can.
    task: "validateToken auth",
    changedFiles: ["src/auth.ts"],
  });
  const block = [...pack.included, ...pack.excluded].find(
    (b) => b.filePath === "migrations/001.md",
  );
  return block?.factors.coChangeRelevance;
}

describe("context MCP tools — git co-change wiring", () => {
  it("a co-changing migration outranks its no-history baseline through packFor", async () => {
    const withGit = await migrationFactor((await setupCoChangeRepo(true)).env);
    const baseline = await migrationFactor((await setupCoChangeRepo(false)).env);
    expect(baseline).toBe(0);
    expect(withGit).toBeGreaterThan(0);
  });
});

describe("context MCP tools — memoryRelevance wiring", () => {
  // An approved memory whose relatedFile is in play but whose PROSE shares no
  // word with the task. The old BM25-narrowed derivation dropped it; the
  // approvedMemoryFiles wiring must still feed its file to memoryRelevance.
  async function authFactor(env: {
    registry: ReturnType<typeof createInMemoryCoreRegistry>;
    storeRoot: string;
  }): Promise<number | undefined> {
    const pack = await handleGetRelevantContext(env, {
      projectId: PROJECT_ID,
      task: "zzz unrelated wording",
    });
    const block = [...pack.included, ...pack.excluded].find((b) => b.filePath === "src/auth.ts");
    return block?.factors.memoryRelevance;
  }

  it("an approved memory's relatedFile gets memoryRelevance even when the task does not match its text", async () => {
    const { env } = await setup();
    env.registry.createMemoryEntry({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as never,
      projectId: PROJECT_ID as never,
      sessionId: null,
      scope: "project",
      content: "totally different prose with no overlap",
      type: "decision",
      title: "an unrelated note",
      keywords: [],
      confidence: "medium",
      source: "manual",
      approval: "approved",
      relatedFiles: ["src/auth.ts"],
      createdAt: TS,
      updatedAt: TS,
    });
    expect(await authFactor(env)).toBe(1);
  });

  it("no memory → memoryRelevance stays 0 (no-op)", async () => {
    const { env } = await setup();
    expect(await authFactor(env)).toBe(0);
  });

  it("a SUGGESTED (unapproved) memory does not feed memoryRelevance", async () => {
    const { env } = await setup();
    env.registry.createMemoryEntry({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as never,
      projectId: PROJECT_ID as never,
      sessionId: null,
      scope: "project",
      content: "not yet approved",
      type: "decision",
      title: "pending",
      keywords: [],
      confidence: "medium",
      source: "agent",
      approval: "suggested",
      relatedFiles: ["src/auth.ts"],
      createdAt: TS,
      updatedAt: TS,
    });
    expect(await authFactor(env)).toBe(0);
  });
});

describe("context MCP tools — memoryRelevance task-scoping (M5)", () => {
  const MEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  // Injected task vector: any task → [1,0,0]. No model.
  const fakeEmbed = async () => [Float32Array.from([1, 0, 0])];

  function seedApprovedAuthMemory(env: {
    registry: ReturnType<typeof createInMemoryCoreRegistry>;
    storeRoot: string;
  }): void {
    env.registry.createMemoryEntry({
      id: MEM_ID as never,
      projectId: PROJECT_ID as never,
      sessionId: null,
      scope: "project",
      content: "totally different prose with no overlap",
      type: "decision",
      title: "an unrelated note",
      keywords: [],
      confidence: "medium",
      source: "manual",
      approval: "approved",
      relatedFiles: ["src/auth.ts"],
      createdAt: TS,
      updatedAt: TS,
    });
  }

  async function authMemoryFactor(env: {
    registry: ReturnType<typeof createInMemoryCoreRegistry>;
    storeRoot: string;
    embedFn?: (texts: readonly string[]) => Promise<Float32Array[]>;
  }): Promise<number | undefined> {
    const pack = await handleGetRelevantContext(env, {
      projectId: PROJECT_ID,
      task: "zzz unrelated wording",
    });
    const block = [...pack.included, ...pack.excluded].find((b) => b.filePath === "src/auth.ts");
    return block?.factors.memoryRelevance;
  }

  it("does NOT boost a task-irrelevant memory's file when a sidecar + task vector scope it", async () => {
    const { env } = await setup();
    seedApprovedAuthMemory(env);
    // Memory vector orthogonal to the [1,0,0] task vector → task-irrelevant.
    writeVectors(memoryEmbeddingsSidecarPath(env.storeRoot, PROJECT_ID as ProjectId), [
      { id: MEM_ID, vector: [0, 0, 1] },
    ]);
    expect(await authMemoryFactor({ ...env, embedFn: fakeEmbed })).toBe(0);
  });

  it("DOES boost a task-relevant memory's file when the sidecar vector is near the task", async () => {
    const { env } = await setup();
    seedApprovedAuthMemory(env);
    // Memory vector aligned with the [1,0,0] task vector → task-relevant.
    writeVectors(memoryEmbeddingsSidecarPath(env.storeRoot, PROJECT_ID as ProjectId), [
      { id: MEM_ID, vector: [0.95, 0.05, 0] },
    ]);
    expect(await authMemoryFactor({ ...env, embedFn: fakeEmbed })).toBe(1);
  });

  it("falls back to all-approved (factor 1) when no memory sidecar exists — identical to today", async () => {
    const { env } = await setup();
    seedApprovedAuthMemory(env);
    // No sidecar written → taskScopedMemoryFiles returns null → approvedMemoryFiles.
    expect(await authMemoryFactor({ ...env, embedFn: fakeEmbed })).toBe(1);
  });

  it("falls back to all-approved when embedding fails — best-effort, never throws", async () => {
    const { env } = await setup();
    seedApprovedAuthMemory(env);
    writeVectors(memoryEmbeddingsSidecarPath(env.storeRoot, PROJECT_ID as ProjectId), [
      { id: MEM_ID, vector: [0, 0, 1] },
    ]);
    const throwingEmbed = async () => {
      throw new Error("model unavailable");
    };
    expect(await authMemoryFactor({ ...env, embedFn: throwingEmbed })).toBe(1);
  });
});
