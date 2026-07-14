import type { MemoryEntryId, ProjectId, SessionId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";
import { applySupersession } from "../src/supersession.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333" as SessionId;
const TARGET_ID = "00000000-0000-4000-8000-0000000000a1" as MemoryEntryId;
const ENTRY_ID = "00000000-0000-4000-8000-0000000000a2" as MemoryEntryId;
const MISSING_ID = "00000000-0000-4000-8000-0000000000ff" as MemoryEntryId;
const TS = "2026-07-13T00:00:00.000Z";
const NOW = "2026-07-13T12:00:00.000Z";
const EARLIER = "2026-07-10T00:00:00.000Z";
const now = () => NOW;

function mem(over: Omit<Partial<MemoryEntry>, "id"> & { id: string }): MemoryEntry {
  return memoryEntrySchema.parse({
    id: over.id,
    projectId: over.projectId ?? PROJECT_ID,
    sessionId: over.sessionId ?? null,
    scope: over.scope ?? "project",
    type: over.type ?? "decision",
    title: over.title ?? "use npm for installs",
    content: over.content ?? "use npm for installs",
    keywords: over.keywords ?? [],
    confidence: "medium",
    source: "manual",
    approval: over.approval ?? "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
    ...(over.supersedesId !== undefined ? { supersedesId: over.supersedesId } : {}),
    ...(over.validTo !== undefined ? { validTo: over.validTo } : {}),
  });
}

function freshRegistry(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("applySupersession", () => {
  it("closes an open same-project same-scope target and reports it", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: TARGET_ID }));
    const entry = mem({ id: ENTRY_ID, content: "use pnpm for installs", supersedesId: TARGET_ID });

    const result = applySupersession(registry, entry, now);

    expect(result).toEqual({
      closed: true,
      superseded: { id: TARGET_ID, title: "use npm for installs" },
    });
    const target = registry.getMemoryEntry(TARGET_ID);
    expect(target?.validTo).toBe(NOW);
    expect(target?.updatedAt).toBe(NOW);
  });

  it("entry without supersedesId -> closed false, nothing touched", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: TARGET_ID }));
    const entry = mem({ id: ENTRY_ID, content: "use pnpm for installs" });

    expect(applySupersession(registry, entry, now)).toEqual({ closed: false });
    expect(registry.getMemoryEntry(TARGET_ID)?.validTo).toBeUndefined();
  });

  it("missing target -> closed false", () => {
    const registry = freshRegistry();
    const entry = mem({ id: ENTRY_ID, supersedesId: MISSING_ID });

    expect(applySupersession(registry, entry, now)).toEqual({ closed: false });
  });

  it("self-referencing supersedesId -> closed false, target stays open", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: TARGET_ID }));
    const entry = mem({ id: TARGET_ID, supersedesId: TARGET_ID });

    expect(applySupersession(registry, entry, now)).toEqual({ closed: false });
    expect(registry.getMemoryEntry(TARGET_ID)?.validTo).toBeUndefined();
  });

  it("cross-project target -> closed false, target stays open", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: TARGET_ID }));
    // The superseding entry is NOT persisted — applySupersession only reads
    // its fields, mirroring the approve-memory call shape.
    const entry = memoryEntrySchema.parse({
      ...mem({ id: ENTRY_ID, supersedesId: TARGET_ID }),
      projectId: OTHER_PROJECT_ID,
    });

    expect(applySupersession(registry, entry, now)).toEqual({ closed: false });
    expect(registry.getMemoryEntry(TARGET_ID)?.validTo).toBeUndefined();
  });

  it("cross-scope target -> closed false, target stays open", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: TARGET_ID }));
    const entry = mem({
      id: ENTRY_ID,
      scope: "session",
      sessionId: SESSION_ID,
      supersedesId: TARGET_ID,
    });

    expect(applySupersession(registry, entry, now)).toEqual({ closed: false });
    expect(registry.getMemoryEntry(TARGET_ID)?.validTo).toBeUndefined();
  });

  it("already-closed target -> closed false, validTo unchanged (idempotent)", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: TARGET_ID }));
    registry.updateMemoryEntry(TARGET_ID, { validTo: EARLIER, updatedAt: EARLIER });
    const entry = mem({ id: ENTRY_ID, content: "use pnpm for installs", supersedesId: TARGET_ID });

    expect(applySupersession(registry, entry, now)).toEqual({ closed: false });
    expect(registry.getMemoryEntry(TARGET_ID)?.validTo).toBe(EARLIER);
  });
});
