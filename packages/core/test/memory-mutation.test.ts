import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";
import { CoreRegistryError } from "../src/errors.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";
import { memoryEntrySchema } from "../src/memory-entry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001" as ProjectId;
const ID_A = "00000000-0000-4000-8000-00000000000a" as MemoryEntryId;
const ID_B = "00000000-0000-4000-8000-00000000000b" as MemoryEntryId;
const NOW = "2026-06-11T00:00:00.000Z";
const LATER = "2026-06-12T00:00:00.000Z";

function seedEntry(id: MemoryEntryId, content: string, over: Record<string, unknown> = {}) {
  return memoryEntrySchema.parse({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: content,
    content,
    keywords: [],
    confidence: "medium",
    source: "manual",
    stale: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRegistries(): Array<[string, CoreRegistry]> {
  const inMemory = createInMemoryCoreRegistry();
  const root = mkdtempSync(join(tmpdir(), "mega-mut-"));
  tmpDirs.push(root);
  const jsonDir = createJsonDirectoryCoreRegistry({ rootDir: root });
  for (const reg of [inMemory, jsonDir]) {
    reg.createProject({
      id: PROJECT_ID,
      name: "alpha",
      rootPath: "/tmp/alpha",
      createdAt: NOW,
      updatedAt: NOW,
    });
  }
  return [
    ["in-memory", inMemory],
    ["json-directory", jsonDir],
  ];
}

describe.each(makeRegistriesLabels())("%s memory mutation", (label) => {
  function registry(): CoreRegistry {
    const found = makeRegistries().find(([name]) => name === label);
    if (!found) throw new Error("unreachable");
    return found[1];
  }

  it("updateMemoryEntry patches mutable fields and bumps updatedAt", () => {
    const reg = registry();
    reg.createMemoryEntry(seedEntry(ID_A, "original"));
    const updated = reg.updateMemoryEntry(ID_A, {
      content: "patched",
      stale: true,
      confidence: "high",
      updatedAt: LATER,
    });
    expect(updated.content).toBe("patched");
    expect(updated.stale).toBe(true);
    expect(updated.confidence).toBe("high");
    expect(updated.updatedAt).toBe(LATER);
    expect(updated.createdAt).toBe(NOW);
    expect(reg.getMemoryEntry(ID_A)?.content).toBe("patched");
  });

  it("updateMemoryEntry rejects an unknown id", () => {
    const reg = registry();
    expect(() => reg.updateMemoryEntry(ID_A, { updatedAt: LATER })).toThrow(CoreRegistryError);
  });

  it("deleteMemoryEntry removes the entry", () => {
    const reg = registry();
    reg.createMemoryEntry(seedEntry(ID_A, "doomed"));
    reg.deleteMemoryEntry(ID_A);
    expect(reg.getMemoryEntry(ID_A)).toBeNull();
    expect(reg.listMemoryEntries(PROJECT_ID)).toHaveLength(0);
  });

  it("deleteMemoryEntry rejects an unknown id", () => {
    const reg = registry();
    expect(() => reg.deleteMemoryEntry(ID_A)).toThrow(CoreRegistryError);
  });

  it("searchMemoryEntries ranks project entries by text", () => {
    const reg = registry();
    reg.createMemoryEntry(seedEntry(ID_A, "JWT auth middleware decision", { keywords: ["auth"] }));
    reg.createMemoryEntry(seedEntry(ID_B, "navbar styling note"));
    const hits = reg.searchMemoryEntries(PROJECT_ID, { text: "auth middleware" });
    expect(hits[0]?.id).toBe(ID_A);
    expect(hits.map((e) => e.id)).not.toContain(ID_B);
  });
});

// describe.each needs the label list before the registries are built per-case.
function makeRegistriesLabels(): string[] {
  return ["in-memory", "json-directory"];
}
