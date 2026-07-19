import { describe, expect, it } from "vitest";
import { applyHandoffMemories } from "../src/handoff-import.js";
import type { HandoffPacket } from "../src/handoff-packet.js";
import type { MemoryEntry } from "../src/memory-entry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const NOW = "2026-07-18T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
let seq = 0;
const newId = () => `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

function makeProject(registry: CoreRegistry, id: string, name: string) {
  return registry.createProject({
    id,
    name,
    rootPath: `/tmp/${name}`,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
}

function mem(over: Record<string, unknown> = {}): MemoryEntry {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: "0f0e0d0c-0b0a-4900-8807-060504030201",
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "t",
    content: "use ndjson",
    keywords: [],
    confidence: "high",
    source: "agent",
    approval: "approved",
    stale: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as unknown as MemoryEntry;
}

function packetWith(memories: MemoryEntry[], failures: unknown[] = []): HandoffPacket {
  return {
    manifest: {
      schemaVersion: "1",
      kind: "megahandoff",
      sourceProject: { name: "alpha" },
      sourceAgent: "claude-code",
      targetAgent: "codex",
      createdAt: NOW,
      expiresAt: "2026-07-19T12:00:00.000Z",
      payloadSha256: "0".repeat(64),
      redactionFindings: 0,
      secretPathsExcluded: 0,
      counts: { memories: memories.length, failures: failures.length, diffFiles: 0, commits: 0 },
    },
    payload: {
      taskSummary: { text: "brief", tokenEstimate: 10 },
      resumeInstructions: "resume here",
      git: null,
      failures,
      memories,
    },
  } as HandoffPacket;
}

function target() {
  const registry = createInMemoryCoreRegistry();
  const project = makeProject(registry, "0f0e0d0c-0b0a-4900-8807-060504030299", "beta");
  return { registry, project };
}

describe("applyHandoffMemories", () => {
  it("imports as suggested, project-scoped, reminted id, provenance, stripped keywords", () => {
    const { registry, project } = target();
    const sessionScoped = mem({
      scope: "session",
      sessionId: "99999999-9999-4999-8999-999999999999",
      keywords: ["from-session:forged", "zod"],
      supersedesId: "11111111-1111-4111-8111-111111111110",
    });
    const report = applyHandoffMemories({
      registry,
      projectId: project.id,
      packet: packetWith([sessionScoped]),
      now: NOW_MS,
      newId,
    });
    expect(report.imported).toBe(1);
    expect(report.skipped).toBe(0);
    const [m] = registry.listMemoryEntries(project.id);
    expect(m?.approval).toBe("suggested");
    expect(m?.scope).toBe("project");
    expect(m?.sessionId).toBeNull();
    expect(m?.projectId).toBe(project.id);
    expect(m?.id).not.toBe("11111111-1111-4111-8111-111111111111");
    expect(m?.evidence).toContain("handoff:alpha");
    expect(m?.keywords).toEqual(["zod"]);
    expect(m?.supersedesId).toBeUndefined();
  });

  it("dedupes by content within the packet and against the store; re-run is idempotent", () => {
    const { registry, project } = target();
    const packet = packetWith([
      mem(),
      mem({ id: "22222222-2222-4222-8222-222222222222", title: "same content twice" }),
    ]);
    const first = applyHandoffMemories({
      registry,
      projectId: project.id,
      packet,
      now: NOW_MS,
      newId,
    });
    expect(first.imported).toBe(1);
    expect(first.skipped).toBe(1);
    const second = applyHandoffMemories({
      registry,
      projectId: project.id,
      packet,
      now: NOW_MS,
      newId,
    });
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);
    expect(registry.listMemoryEntries(project.id)).toHaveLength(1);
  });

  it("recomputes badges locally over the created entries", () => {
    const { registry, project } = target();
    const anchored = mem({
      content: "anchored fact",
      anchor: { repoHead: "abc123", capturedAt: NOW, files: [], symbols: [] },
    });
    const report = applyHandoffMemories({
      registry,
      projectId: project.id,
      packet: packetWith([anchored, mem()]),
      now: NOW_MS,
      newId,
    });
    expect(report.badges.map((b) => b.badge)).toEqual(["verified", "unanchored"]);
    const created = registry.listMemoryEntries(project.id);
    expect(report.badges.map((b) => b.memoryId).sort()).toEqual(
      created.map((c) => c.id as string).sort(),
    );
  });

  it("drops the packet's lastVerified stamp but keeps the anchor", () => {
    const { registry, project } = target();
    const stamped = mem({
      content: "stamped fact",
      anchor: { repoHead: "abc123", capturedAt: NOW, files: [], symbols: [] },
      lastVerified: { headSha: "abc123", at: NOW, result: "verified", closedByCodeTruth: true },
    });
    const report = applyHandoffMemories({
      registry,
      projectId: project.id,
      packet: packetWith([stamped]),
      now: NOW_MS,
      newId,
    });
    const [m] = registry.listMemoryEntries(project.id);
    expect(m?.lastVerified).toBeUndefined();
    expect(m?.anchor).toBeDefined();
    expect(report.badges.map((b) => b.badge)).toEqual(["verified"]);
  });

  it("never imports failures — memories only in v1", () => {
    const { registry, project } = target();
    const failure = {
      id: "33333333-3333-4333-8333-333333333333",
      projectId: "0f0e0d0c-0b0a-4900-8807-060504030201",
      sessionId: null,
      task: "import",
      failedStep: "hash",
      relatedFiles: [],
      convertedToRule: false,
      createdAt: NOW,
    };
    applyHandoffMemories({
      registry,
      projectId: project.id,
      packet: packetWith([mem()], [failure]),
      now: NOW_MS,
      newId,
    });
    expect(registry.listFailedAttempts(project.id)).toHaveLength(0);
  });

  it("redacts an exotic-format secret in memory content and counts it", () => {
    const { registry, project } = target();
    const token = `ghp_${"c".repeat(36)}`;
    const secretMem = mem({ content: `use token ${token} to auth`, title: `key ${token}` });
    const report = applyHandoffMemories({
      registry,
      projectId: project.id,
      packet: packetWith([secretMem]),
      now: NOW_MS,
      newId,
    });
    const [m] = registry.listMemoryEntries(project.id);
    expect(m?.content).not.toContain(token);
    expect(m?.content).toContain("gh*_[REDACTED]");
    expect(m?.title).not.toContain(token);
    expect(report.redactionFindings).toBe(2);
  });

  it("throws on unknown target project", () => {
    const registry = createInMemoryCoreRegistry();
    expect(() =>
      applyHandoffMemories({
        registry,
        projectId: "0f0e0d0c-0b0a-4900-8807-060504039999" as never,
        packet: packetWith([mem()]),
        now: NOW_MS,
        newId,
      }),
    ).toThrowError(/not found|not exist/i);
  });
});
