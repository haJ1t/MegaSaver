import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runContextBuild } from "../src/commands/context/build.js";
import { loadPack } from "../src/commands/context/shared.js";
import { indexBuildCommand } from "../src/commands/index/build.js";
import { ensureStoreReady } from "../src/store.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-11T00:00:00.000Z";

// The CLI context boundary has no pre-computed task vector, so task-scoping is
// best-effort: it only kicks in when a memory sidecar exists (the orchestrator
// embeds the task itself). The CLI test repo has NO sidecar, so the path is the
// FALLBACK path — approvedMemoryFiles, identical to today's behavior. This test
// pins that fallback: an approved memory's relatedFile is still boosted, and the
// build path never throws. (Real task-scoping is covered model-free at the core +
// MCP boundaries with injected vectors.)
describe("mega context — memoryRelevance fallback (no sidecar, M5)", () => {
  let store: string;
  let repo: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cli-taskscope-store-"));
    repo = await mkdtemp(join(tmpdir(), "cli-taskscope-repo-"));
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(
      join(repo, "src", "auth.ts"),
      "export function validateToken(t: string) {\n  return t.length > 0;\n}\n",
    );
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: repo, createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  const env = () => ({
    storeFlag: store,
    cwd: store,
    home: "/nonexistent-home",
    xdgDataHome: undefined,
    platform: "linux" as const,
    localAppData: undefined,
  });

  // biome-ignore lint/suspicious/noExplicitAny: citty run() arg shape
  const runCmd = (cmd: any, args: Record<string, unknown>): Promise<void> =>
    cmd.run({ args: { ...args, store }, cmd, rawArgs: [], data: undefined });

  async function seedApprovedAuthMemory(): Promise<void> {
    const { registry } = await ensureStoreReady(store);
    registry.createMemoryEntry({
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
      stale: false,
      relatedFiles: ["src/auth.ts"],
      createdAt: TS,
      updatedAt: TS,
    });
  }

  it("boosts an approved memory's relatedFile via the all-approved fallback (no sidecar)", async () => {
    await runCmd(indexBuildCommand, { projectName: "demo" });
    await seedApprovedAuthMemory();

    const loaded = await loadPack({
      ...env(),
      projectName: "demo",
      task: "zzz unrelated wording",
      changedFiles: [],
      failingTests: [],
      limitFlag: undefined,
      maxTokensFlag: undefined,
      stderr: () => {},
    });
    expect(loaded).not.toBeNull();
    const block = [...(loaded?.pack.included ?? []), ...(loaded?.pack.excluded ?? [])].find(
      (b) => b.filePath === "src/auth.ts",
    );
    expect(block?.factors.memoryRelevance).toBe(1);
  });

  it("never throws on the build path when memory is present but no sidecar exists", async () => {
    await runCmd(indexBuildCommand, { projectName: "demo" });
    await seedApprovedAuthMemory();
    const out: string[] = [];
    const code = await runContextBuild({
      ...env(),
      projectName: "demo",
      task: "zzz unrelated wording",
      changedFiles: [],
      failingTests: [],
      limitFlag: undefined,
      maxTokensFlag: undefined,
      jsonFlag: false,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
  });
});
