import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CoreRegistry,
  type ToolDefinitionInput,
  createInMemoryCoreRegistry,
  createJsonDirectoryCoreRegistry,
} from "@megasaver/core";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;

function clockFrom(ids: string[]): { now: () => string; newId: () => string } {
  let i = 0;
  return { now: () => "2026-06-12T00:00:00.000Z", newId: () => ids[i++] ?? "overflow" };
}

const GREP: ToolDefinitionInput = {
  name: "grep",
  description: "search files for a pattern",
  category: "search",
  risk: "safe",
  keywords: ["search"],
} as ToolDefinitionInput;

const SHIP: ToolDefinitionInput = {
  name: "ship",
  description: "deploy to production",
  category: "deploy",
  risk: "dangerous",
  keywords: ["deploy"],
} as ToolDefinitionInput;

const TOOL_ID = "e0000000-0000-4000-8000-000000000001";
const SHIP_ID = "e0000000-0000-4000-8000-000000000002";

const tmpRoots: string[] = [];
afterEach(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
  tmpRoots.length = 0;
});

function backends(): { name: string; make: () => CoreRegistry }[] {
  return [
    { name: "in-memory", make: () => createInMemoryCoreRegistry() },
    {
      name: "json-directory",
      make: () => {
        const root = mkdtempSync(join(tmpdir(), "mega-tools-reg-"));
        tmpRoots.push(root);
        return createJsonDirectoryCoreRegistry({ rootDir: root });
      },
    },
  ];
}

function seedProject(registry: CoreRegistry): void {
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
  } as Parameters<CoreRegistry["createProject"]>[0]);
}

describe.each(backends())("$name registry — tool definitions", ({ make }) => {
  it("createToolDefinition mints id + createdAt, defaults opaque schemas to null", () => {
    const registry = make();
    seedProject(registry);
    const created = registry.createToolDefinition(PROJECT_ID, GREP, clockFrom([TOOL_ID]));
    expect(created.id).toBe(TOOL_ID);
    expect(created.createdAt).toBe("2026-06-12T00:00:00.000Z");
    expect(created.inputSchema).toBeNull();
    expect(created.outputSchema).toBeNull();
    expect(registry.getToolDefinition(created.id)).toEqual(created);
  });

  it("createToolDefinition requires the project", () => {
    const registry = make();
    expect(() => registry.createToolDefinition(PROJECT_ID, GREP, clockFrom([TOOL_ID]))).toThrow(
      /project_not_found|does not exist/,
    );
  });

  it("createToolDefinition rejects a duplicate id", () => {
    const registry = make();
    seedProject(registry);
    registry.createToolDefinition(PROJECT_ID, GREP, clockFrom([TOOL_ID]));
    expect(() => registry.createToolDefinition(PROJECT_ID, SHIP, clockFrom([TOOL_ID]))).toThrow(
      /tool_definition_already_exists|already exists/,
    );
  });

  it("listToolDefinitions is project-scoped", () => {
    const registry = make();
    seedProject(registry);
    registry.createToolDefinition(PROJECT_ID, GREP, clockFrom([TOOL_ID]));
    expect(registry.listToolDefinitions(PROJECT_ID).map((t) => t.id)).toEqual([TOOL_ID]);
  });

  it("getToolDefinition returns null on miss", () => {
    const registry = make();
    expect(registry.getToolDefinition(TOOL_ID as never)).toBeNull();
  });

  it("routeToolsForTask gates dangerous tools and ranks the rest", () => {
    const registry = make();
    seedProject(registry);
    registry.createToolDefinition(PROJECT_ID, GREP, clockFrom([TOOL_ID]));
    registry.createToolDefinition(PROJECT_ID, SHIP, clockFrom([SHIP_ID]));
    const res = registry.routeToolsForTask(PROJECT_ID, "search files");
    expect(res.allowedTools.map((t) => t.id)).toEqual([TOOL_ID]);
    expect(res.blockedTools.map((t) => t.id)).toEqual([SHIP_ID]);
    expect(res.reason).toContain("blocked as dangerous/deploy/database");
  });

  it("routeToolsForTask requires the project", () => {
    const registry = make();
    expect(() => registry.routeToolsForTask(PROJECT_ID, "x")).toThrow(
      /project_not_found|does not exist/,
    );
  });
});

// Approval parity guard: both impls must round-trip a non-default `approval`
// value identically. If either impl silently drops the field (e.g. on read-
// back from disk), this test catches it immediately.
const MEMORY_ID = "33333333-3333-4333-8333-333333333333" as MemoryEntryId;
const TS = "2026-06-12T00:00:00.000Z";

describe.each(backends())("$name registry — memory approval parity", ({ make }) => {
  it("round-trips a suggested memory entry with approval: suggested", () => {
    const registry = make();
    seedProject(registry);
    const entry = registry.createMemoryEntry({
      id: MEMORY_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "Suggested entry",
      content: "This is a suggested memory for parity.",
      keywords: [],
      confidence: "medium",
      source: "agent",
      approval: "suggested",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    });
    expect(entry.approval).toBe("suggested");
    const readBack = registry.getMemoryEntry(MEMORY_ID);
    expect(readBack?.approval).toBe("suggested");
  });

  it("round-trips approval: approved and approval: rejected", () => {
    const registry = make();
    seedProject(registry);
    const approvedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as MemoryEntryId;
    const rejectedId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as MemoryEntryId;
    registry.createMemoryEntry({
      id: approvedId,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "architecture",
      title: "Approved entry",
      content: "This entry is approved.",
      keywords: [],
      confidence: "high",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    });
    registry.createMemoryEntry({
      id: rejectedId,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "bug",
      title: "Rejected entry",
      content: "This entry was rejected.",
      keywords: [],
      confidence: "low",
      source: "agent",
      approval: "rejected",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    });
    expect(registry.getMemoryEntry(approvedId)?.approval).toBe("approved");
    expect(registry.getMemoryEntry(rejectedId)?.approval).toBe("rejected");
  });
});
