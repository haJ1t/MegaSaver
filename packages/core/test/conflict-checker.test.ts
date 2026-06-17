import { describe, expect, it } from "vitest";
import { checkConflicts } from "../src/conflict-checker.js";
import type { MemoryEntry } from "../src/memory-entry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const mk = (id: string, over: Partial<MemoryEntry> = {}): MemoryEntry =>
  ({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "t",
    content: "use pnpm not npm",
    keywords: ["pnpm"],
    confidence: "medium",
    source: "agent",
    approval: "approved",
    stale: false,
    relatedFiles: ["package.json"],
    createdAt: "2026-06-16T12:00:00.000Z",
    updatedAt: "2026-06-16T12:00:00.000Z",
    ...over,
  }) as MemoryEntry;

describe("checkConflicts", () => {
  it("exact duplicate of an approved memory -> duplicate (link, do not re-commit)", () => {
    const existing = [mk("00000000-0000-4000-8000-0000000000b1")];
    const r = checkConflicts(mk("00000000-0000-4000-8000-0000000000b2"), existing);
    expect(r.outcome).toBe("duplicate");
    expect(r.conflictIds).toEqual(["00000000-0000-4000-8000-0000000000b1"]);
  });

  it("same file + same type, different conclusion -> supersession (needs explicit supersedes)", () => {
    const existing = [mk("00000000-0000-4000-8000-0000000000b1", { content: "use pnpm not npm" })];
    const cand = mk("00000000-0000-4000-8000-0000000000b2", {
      content: "use npm not pnpm",
      keywords: ["npm"],
    });
    const r = checkConflicts(cand, existing);
    expect(r.outcome).toBe("supersession");
  });

  it("a contradiction (shared files + opposite keyword) -> contradiction (quarantine)", () => {
    const existing = [
      mk("00000000-0000-4000-8000-0000000000b1", {
        content: "tests must pass before merge",
        keywords: ["merge", "pass"],
      }),
    ];
    const cand = mk("00000000-0000-4000-8000-0000000000b2", {
      type: "project_rule",
      content: "merge without waiting for tests",
      keywords: ["merge", "skip"],
    });
    const r = checkConflicts(cand, existing);
    // existing type=decision, candidate type=project_rule → supersession's
    // same-type guard is false, so the contradiction branch fires.
    expect(r.outcome).toBe("contradiction");
  });

  it("an unrelated fact -> continue", () => {
    const existing = [
      mk("00000000-0000-4000-8000-0000000000b1", {
        content: "use pnpm",
        relatedFiles: ["package.json"],
      }),
    ];
    const cand = mk("00000000-0000-4000-8000-0000000000b2", {
      content: "auth uses JWT",
      keywords: ["jwt"],
      relatedFiles: ["src/auth.ts"],
    });
    const r = checkConflicts(cand, existing);
    expect(r.outcome).toBe("unrelated");
  });
});
