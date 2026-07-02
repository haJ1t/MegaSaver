import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { approvedMemoryFiles, staleMemoryFiles } from "../src/approved-memory-files.js";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";

const PROJECT = "00000000-0000-4000-8000-000000000001" as ProjectId;

function entry(
  over: Omit<Partial<MemoryEntry>, "id"> & { id: string; relatedFiles?: string[] },
): MemoryEntry {
  return memoryEntrySchema.parse({
    id: over.id,
    projectId: PROJECT,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: over.title ?? "t",
    content: over.content ?? "c",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: over.approval ?? "approved",
    stale: over.stale ?? false,
    relatedFiles: over.relatedFiles ?? [],
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
  });
}

describe("approvedMemoryFiles", () => {
  it("returns relatedFiles of approved, non-stale entries only", () => {
    const entries = [
      entry({ id: "00000000-0000-4000-8000-0000000000a1", relatedFiles: ["src/a.ts"] }),
      entry({
        id: "00000000-0000-4000-8000-0000000000a2",
        approval: "suggested",
        relatedFiles: ["src/suggested.ts"],
      }),
      entry({
        id: "00000000-0000-4000-8000-0000000000a3",
        stale: true,
        relatedFiles: ["src/stale.ts"],
      }),
      entry({ id: "00000000-0000-4000-8000-0000000000a4", relatedFiles: ["src/b.ts"] }),
    ];
    expect(approvedMemoryFiles(entries).sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("includes ALL approved files, not just those matching some query text", () => {
    // The whole point of the fix: a memory whose prose does not lexically match
    // any task still contributes its relatedFiles to the memory signal.
    const entries = [
      entry({
        id: "00000000-0000-4000-8000-0000000000b1",
        title: "unrelated wording",
        content: "nothing about the task here",
        relatedFiles: ["src/critical.ts"],
      }),
    ];
    expect(approvedMemoryFiles(entries)).toEqual(["src/critical.ts"]);
  });

  it("dedupes repeated files and ignores entries with no relatedFiles", () => {
    const entries = [
      entry({ id: "00000000-0000-4000-8000-0000000000c1", relatedFiles: ["src/a.ts"] }),
      entry({ id: "00000000-0000-4000-8000-0000000000c2", relatedFiles: ["src/a.ts"] }),
      entry({ id: "00000000-0000-4000-8000-0000000000c3", relatedFiles: [] }),
    ];
    expect(approvedMemoryFiles(entries)).toEqual(["src/a.ts"]);
  });
});

describe("staleMemoryFiles", () => {
  it("returns relatedFiles of approved STALE entries (the stale penalty signal)", () => {
    const entries = [
      entry({
        id: "00000000-0000-4000-8000-0000000000d1",
        stale: true,
        relatedFiles: ["src/old.ts"],
      }),
      entry({ id: "00000000-0000-4000-8000-0000000000d2", relatedFiles: ["src/fresh.ts"] }),
    ];
    expect(staleMemoryFiles(entries)).toEqual(["src/old.ts"]);
  });
});
