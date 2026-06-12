/**
 * Exit proof: team-shared memory via approval gate.
 *
 * Demonstrates the Phase 10 exit criterion: a single shared store (shared
 * --store path simulating two teammates) correctly gates suggested memory out
 * of all agent config files, then exposes it once a human approves it.
 *
 * Flow:
 *   1. Seed a "suggested" project memory in the shared store via
 *      registry.createMemoryEntry (the agent default of save_memory →
 *      "suggested" is proven separately in the mcp-bridge save-memory test).
 *   2. Sync to claude-code + cursor: both files MUST NOT contain the content.
 *   3. Human approves via runMemoryApprove.
 *   4. Re-sync both: both files MUST contain the content — same approved
 *      memory from one shared store now visible to two agents.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry } from "@megasaver/core";
import { memoryEntryIdSchema, projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConnectorSync } from "../src/commands/connector/sync.js";
import { runMemoryApprove } from "../src/commands/memory/approve.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const MEMORY_ID = memoryEntryIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const TS = "2026-06-12T00:00:00.000Z";
const MEMORY_CONTENT = "Use dependency injection for all service constructors.";

describe("team-shared memory — approval gate exit proof", () => {
  let store: string;
  let projectRoot: string;
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mega-team-proof-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mega-team-proof-root-"));
    stdoutLines.length = 0;
    stderrLines.length = 0;
    await seedStore();
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedStore(): Promise<void> {
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  function makeStoreEnv() {
    return {
      storeFlag: store,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
    };
  }

  async function syncTarget(target: string): Promise<0 | 1> {
    return runConnectorSync({
      ...makeStoreEnv(),
      projectName: "demo",
      targetFlag: target,
      json: false,
      stdout: (line) => stdoutLines.push(line),
      stderr: (line) => stderrLines.push(line),
    });
  }

  async function readSyncedFile(relativePath: string): Promise<string> {
    return readFile(join(projectRoot, relativePath), "utf8").catch(() => "");
  }

  it("suggested memory is excluded from synced files; approved memory appears in both", async () => {
    // Step 1: Seed a suggested memory directly in the shared store.
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    await mkdir(join(store, "memory"), { recursive: true });
    registry.createMemoryEntry({
      id: MEMORY_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "architecture",
      title: "Dependency injection pattern",
      content: MEMORY_CONTENT,
      keywords: ["di", "architecture"],
      confidence: "high",
      source: "agent",
      approval: "suggested",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    });

    // Step 2: Sync to both claude-code and cursor — neither should include the
    // suggested memory content because the gate blocks it.
    const code1 = await syncTarget("claude-code");
    expect(code1).toBe(0);
    const code2 = await syncTarget("cursor");
    expect(code2).toBe(0);

    const claudeContent = await readSyncedFile("CLAUDE.md");
    const cursorContent = await readSyncedFile(".cursor/rules/megasaver.mdc");

    expect(claudeContent).not.toContain(MEMORY_CONTENT);
    expect(cursorContent).not.toContain(MEMORY_CONTENT);

    // Step 3: Human approves the memory entry.
    const approveCode = await runMemoryApprove({
      ...makeStoreEnv(),
      memoryEntryId: MEMORY_ID,
      approval: "approved",
      jsonFlag: false,
      stdout: (line) => stdoutLines.push(line),
      stderr: (line) => stderrLines.push(line),
      now: () => TS,
    });
    expect(approveCode).toBe(0);

    // Step 4: Re-sync both targets — approved memory MUST now appear in both
    // agent config files from the single shared store.
    const code3 = await syncTarget("claude-code");
    expect(code3).toBe(0);
    const code4 = await syncTarget("cursor");
    expect(code4).toBe(0);

    const claudeContentAfter = await readSyncedFile("CLAUDE.md");
    const cursorContentAfter = await readSyncedFile(".cursor/rules/megasaver.mdc");

    expect(claudeContentAfter).toContain(MEMORY_CONTENT);
    expect(cursorContentAfter).toContain(MEMORY_CONTENT);
  });
});
