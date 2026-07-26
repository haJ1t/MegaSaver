import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry } from "@megasaver/core";
import { recallRegistryHandler } from "@megasaver/daemon";
import { handleGetRelevantMemories, handleSearchMemory } from "@megasaver/mcp-bridge";
import { rankProjectMemories } from "@megasaver/memory-recall";
import { memoryEntryIdSchema, projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";
import { runMemorySearch } from "../../src/commands/memory/search.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const SESSION_ID = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const NOW = "2026-07-26T00:00:00.000Z";
const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "megasaver-hybrid-recall-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("LM2 product-memory recall surfaces", () => {
  it("uses one Safe order across adapter, MCP, daemon, and CLI", async () => {
    const storeRoot = makeRoot();
    const registry = createJsonDirectoryCoreRegistry({ rootDir: storeRoot });
    registry.createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: storeRoot,
      createdAt: NOW,
      updatedAt: NOW,
    });
    registry.createSession({
      id: SESSION_ID,
      projectId: PROJECT_ID,
      agentId: "codex",
      riskLevel: "medium",
      title: "demo",
      startedAt: NOW,
      endedAt: null,
    });
    for (const entry of [
      {
        id: memoryEntryIdSchema.parse("33333333-3333-4333-8333-333333333333"),
        sessionId: SESSION_ID,
        scope: "session" as const,
        title: "Rollback release",
        content: "Rollback the deployment if the health check fails.",
      },
      {
        id: memoryEntryIdSchema.parse("44444444-4444-4444-8444-444444444444"),
        sessionId: null,
        scope: "project" as const,
        title: "Rollback runbook",
        content: "Deploy rollback requires the release owner approval.",
      },
      {
        id: memoryEntryIdSchema.parse("55555555-5555-4555-8555-555555555555"),
        sessionId: null,
        scope: "project" as const,
        title: "Suggested rollback",
        content: "Do not inject this proposal.",
      },
    ]) {
      registry.createMemoryEntry({
        ...entry,
        projectId: PROJECT_ID,
        type: "decision",
        keywords: [],
        confidence: "high",
        source: "manual",
        approval: entry.id.startsWith("555") ? "suggested" : "approved",
        stale: false,
        createdAt: NOW,
        updatedAt: NOW,
      });
    }

    const task = "deploy rollback";
    const direct = await rankProjectMemories({
      projectId: PROJECT_ID,
      entries: registry.listMemoryEntries(PROJECT_ID),
      task,
      storeRoot,
      query: { text: task },
    });
    const relevant = await handleGetRelevantMemories(
      { registry, storeRoot },
      { projectId: PROJECT_ID, task },
    );
    const search = await handleSearchMemory(
      { registry, storeRoot },
      { projectId: PROJECT_ID, text: task },
    );
    const daemon = await recallRegistryHandler(storeRoot, { sessionId: SESSION_ID, intent: task });
    const lines: string[] = [];
    const exitCode = await runMemorySearch({
      projectName: "demo",
      queryFlag: task,
      typeFlag: undefined,
      confidenceFlag: undefined,
      scopeFlag: undefined,
      includeStale: false,
      limitFlag: undefined,
      storeFlag: storeRoot,
      jsonFlag: true,
      cwd: storeRoot,
      home: storeRoot,
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line) => lines.push(line),
      stderr: () => undefined,
    });

    const expected = direct.memory.map((entry) => entry.id);
    const daemonJson = daemon.json as { memory: { id: string }[]; hybrid: unknown };
    const daemonMemory = daemonJson.memory;
    const cliMemory = JSON.parse(lines[0] ?? "[]") as { id: string }[];
    expect(exitCode).toBe(0);
    expect([...expected].sort()).toEqual([
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ]);
    expect(relevant.memory.map((entry) => entry.id)).toEqual(expected);
    expect(search.memory.map((entry) => entry.id)).toEqual(expected);
    expect(daemonMemory.map((entry) => entry.id)).toEqual(expected);
    expect(cliMemory.map((entry) => entry.id)).toEqual(expected);
    expect(relevant.hybrid).toMatchObject({ profile: "safe" });
    expect(search.hybrid).toMatchObject({ profile: "safe" });
    expect(daemonJson.hybrid).toMatchObject({ profile: "safe" });
  });
});
