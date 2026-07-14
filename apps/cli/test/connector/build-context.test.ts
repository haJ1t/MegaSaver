import { type MemoryEntry, type Project, memoryEntrySchema } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import {
  buildConnectorContext,
  filterMemoryEntriesForSession,
} from "../../src/commands/connector/shared.js";
import { KNOWN_TARGETS } from "../../src/known-targets.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PREDECESSOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUCCESSOR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TS = "2026-06-11T00:00:00.000Z";
const CLOSED_AT = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-12T00:00:00.000Z";

function mem(over: Partial<Record<string, unknown>> = {}): MemoryEntry {
  return memoryEntrySchema.parse({
    id: SUCCESSOR_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "use pnpm",
    content: "use pnpm for installs",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
    ...over,
  });
}

const project: Project = {
  id: PROJECT_ID as ProjectId,
  name: "demo",
  rootPath: "/tmp/demo",
  createdAt: TS,
  updatedAt: TS,
};

// biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess requires ! for array index
const target = KNOWN_TARGETS[0]!;

describe("connector validity gate + changedFrom (spec §3.3 / §4.4)", () => {
  const predecessor = mem({
    id: PREDECESSOR_ID,
    title: "use npm",
    content: "use npm for installs",
    validTo: CLOSED_AT,
  });
  const successor = mem({
    supersedesId: PREDECESSOR_ID,
    reason: "package manager switched",
  });

  it("filterMemoryEntriesForSession drops closed (superseded) rows", () => {
    const kept = filterMemoryEntriesForSession([predecessor, successor], null, NOW);
    expect(kept.map((e) => e.id)).toEqual([SUCCESSOR_ID]);
  });

  it("filterMemoryEntriesForSession drops archival-tier rows", () => {
    const archived = mem({ id: PREDECESSOR_ID, title: "old", tier: "archival" });
    const kept = filterMemoryEntriesForSession([archived, successor], null, NOW);
    expect(kept.map((e) => e.id)).toEqual([SUCCESSOR_ID]);
  });

  it("buildConnectorContext carries memoryChangedFrom for the successor", () => {
    const context = buildConnectorContext(target, project, [], [predecessor, successor], NOW);
    expect(context.memoryEntries.map((e) => e.id)).toEqual([SUCCESSOR_ID]);
    expect(context.memoryChangedFrom).toEqual({
      [SUCCESSOR_ID]: {
        title: "use npm",
        closedAt: CLOSED_AT,
        reason: "package manager switched",
      },
    });
  });

  it("omits memoryChangedFrom when the predecessor is reopened (validTo null)", () => {
    const reopened = mem({ id: PREDECESSOR_ID, title: "use npm", validTo: null });
    const context = buildConnectorContext(target, project, [], [reopened, successor], NOW);
    expect(context.memoryChangedFrom).toBeUndefined();
  });
});
