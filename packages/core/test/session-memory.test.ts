import { describe, expect, it } from "vitest";
import type { FailedAttempt } from "../src/failed-attempt.js";
import { isRecallable, memoryEntrySchema } from "../src/memory-entry.js";
import { searchMemoryEntries } from "../src/memory-search.js";
import { extractSessionMemories } from "../src/session-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-06-30T00:00:00.000Z";

function fa(id: string, over: Partial<FailedAttempt>): FailedAttempt {
  return {
    id,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    task: "fix login",
    failedStep: "run auth tests",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: TS,
    ...over,
  } as FailedAttempt;
}

// id helpers (UUID v4 shape, distinct)
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("extractSessionMemories", () => {
  it("turns a test-shaped failure into a test_behavior candidate", () => {
    const failure = fa(A, {
      failedStep: "auth.test.ts > rejects expired token",
      errorOutput: "AssertionError: expected 200 to be 401\n  at auth.test.ts:42",
      relatedFiles: ["src/middleware/auth.ts"],
      suspectedCause: "expiry check uses < not <=",
    });

    const out = extractSessionMemories({
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      failedAttempts: [failure],
    });

    const [c] = out;
    expect(c).toBeDefined();
    if (c === undefined) return;
    expect(c.type).toBe("test_behavior");
    expect(c.source).toBe("test_failure");
    expect(c.approval).toBe("suggested");
    expect(c.scope).toBe("session");
    expect(c.confidence).toBe("low");
    expect(c.title).toBe("auth.test.ts > rejects expired token");
    expect(c.content).toContain("expected 200 to be 401");
    expect(c.content).toContain("expiry check uses < not <=");
    expect(c.relatedFiles).toEqual(["src/middleware/auth.ts"]);
    expect(c.dedupeKey).toBe(`${A}:${c.contentHash}`);
  });

  it("classifies a non-test failure as a bug candidate", () => {
    const failure = fa(B, {
      failedStep: "build the cli bundle",
      errorOutput: "ENOENT: no such file or directory, open 'dist/cli.js'",
    });

    const out = extractSessionMemories({
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      failedAttempts: [failure],
    });

    expect(out).toHaveLength(1);
    expect(out.map((c) => c.type)).toEqual(["bug"]);
  });

  it("collapses identical failures within the session to one candidate", () => {
    const dupA = fa(A, { failedStep: "run auth tests", errorOutput: "boom 401" });
    // Same content, different source-failure id -> still one candidate (dedupe by content).
    const dupB = fa(B, { failedStep: "run auth tests", errorOutput: "boom 401" });
    const distinct = fa(C, { failedStep: "run lint", errorOutput: "no-unused-vars" });

    const out = extractSessionMemories({
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      failedAttempts: [dupA, dupB, distinct],
    });

    expect(out).toHaveLength(2);
    const titles = out.map((c) => c.title).sort();
    expect(titles).toEqual(["run auth tests", "run lint"]);
  });

  it("emits a decision candidate from a DECISION: marker", () => {
    const failure = fa(A, {
      failedStep: "run auth tests",
      errorOutput: "tests failed",
      suspectedCause: "DECISION: switch to <= for expiry comparison",
    });

    const out = extractSessionMemories({
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      failedAttempts: [failure],
    });

    const decision = out.find((c) => c.type === "decision");
    expect(decision).toBeDefined();
    if (decision === undefined) return;
    expect(decision.source).toBe("session_summary");
    expect(decision.content).toContain("switch to <= for expiry comparison");
  });

  it("returns nothing for a session with no failures", () => {
    expect(
      extractSessionMemories({
        sessionId: SESSION_ID,
        projectId: PROJECT_ID,
        failedAttempts: [],
      }),
    ).toEqual([]);
  });

  it("a staged candidate is NOT recallable until approved", () => {
    const [candidate] = extractSessionMemories({
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      failedAttempts: [fa(A, { failedStep: "run auth tests", errorOutput: "boom 401" })],
    });
    expect(candidate).toBeDefined();
    if (candidate === undefined) return;
    const entry = memoryEntrySchema.parse({
      id: A,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      scope: candidate.scope,
      type: candidate.type,
      title: candidate.title,
      content: candidate.content,
      keywords: [`from-session:${candidate.dedupeKey}`],
      confidence: candidate.confidence,
      source: candidate.source,
      approval: candidate.approval,
      createdAt: TS,
      updatedAt: TS,
    });

    // suggested ⇒ excluded from default recall and from BM25 search.
    expect(isRecallable(entry, TS)).toBe(false);
    expect(searchMemoryEntries([entry], { text: "auth", asOf: TS })).toEqual([]);
    // only an explicit unapproved view surfaces it (the human approval gate).
    expect(
      searchMemoryEntries([entry], { text: "auth", asOf: TS, includeUnapproved: true }),
    ).toHaveLength(1);
  });
});
