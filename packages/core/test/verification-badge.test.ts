import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";
import { verificationBadgeFor } from "../src/verification-badge.js";

const PROJECT = "00000000-0000-4000-8000-000000000001" as ProjectId;
const TS = "2026-07-01T00:00:00.000Z";
const HEAD = "1111111111111111111111111111111111111111";

const ANCHOR = {
  repoHead: HEAD,
  capturedAt: TS,
  files: [],
  symbols: [],
};

function entry(over: Partial<MemoryEntry>): MemoryEntry {
  return memoryEntrySchema.parse({
    id: "00000000-0000-4000-8000-0000000000a1",
    projectId: PROJECT,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "badge fixture",
    content: "badge fixture",
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

describe("verificationBadgeFor", () => {
  it("returns unanchored when no anchor", () => {
    expect(verificationBadgeFor(entry({}))).toBe("unanchored");
  });

  it("returns verified when anchored with no stored contradiction", () => {
    expect(verificationBadgeFor(entry({ anchor: ANCHOR }))).toBe("verified");
  });

  it("returns verified when anchored and last verification passed", () => {
    const badge = verificationBadgeFor(
      entry({
        anchor: ANCHOR,
        lastVerified: { headSha: HEAD, at: TS, result: "verified", closedByCodeTruth: false },
      }),
    );
    expect(badge).toBe("verified");
  });

  it("returns contradicted-by-code when a contradiction is stored", () => {
    const badge = verificationBadgeFor(
      entry({
        anchor: ANCHOR,
        lastVerified: { headSha: HEAD, at: TS, result: "contradicted", closedByCodeTruth: true },
      }),
    );
    expect(badge).toBe("contradicted-by-code");
  });

  it("anchor decides first: unanchored even with a stored contradiction", () => {
    const badge = verificationBadgeFor(
      entry({
        lastVerified: { headSha: HEAD, at: TS, result: "contradicted", closedByCodeTruth: false },
      }),
    );
    expect(badge).toBe("unanchored");
  });
});
