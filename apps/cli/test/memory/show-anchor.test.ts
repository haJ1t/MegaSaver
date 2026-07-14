import { memoryEntrySchema } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import {
  formatMemoryExplainLines,
  formatMemoryShowLines,
} from "../../src/commands/memory/shared.js";

const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";
const HEAD = "aaaabbbbccccddddeeeeffff0000111122223333";
const BLOB = "1111222233334444555566667777888899990000";
const EVIDENCE = "code-truth: contradicted by aaaabbb — src/a.ts#foo symbol hash changed";

const base = {
  id: "55555555-5555-4555-8555-555555555555",
  projectId: "11111111-1111-4111-8111-111111111111",
  sessionId: null,
  scope: "project",
  type: "decision",
  title: "anchored row",
  content: "anchored row",
  keywords: [],
  confidence: "medium",
  source: "manual",
  approval: "approved",
  stale: false,
  createdAt: TS,
  updatedAt: TS,
};

const anchored = memoryEntrySchema.parse({
  ...base,
  evidence: [EVIDENCE],
  anchor: {
    repoHead: HEAD,
    capturedAt: TS,
    files: [{ path: "src/a.ts", blobSha: BLOB }],
    symbols: [{ path: "src/a.ts", name: "foo", startLine: 1, endLine: 3, contentHash: "h1" }],
  },
  lastVerified: {
    headSha: HEAD,
    at: NOW,
    result: "contradicted",
    closedByCodeTruth: false,
  },
});

const plain = memoryEntrySchema.parse(base);

describe("show/explain anchor + verification lines", () => {
  it("show renders the anchor summary and the verification badge", () => {
    const lines = formatMemoryShowLines(anchored);
    expect(lines).toContain(`${"anchor".padEnd(12)}1 files, 1 symbols @ aaaabbb`);
    expect(lines).toContain(`${"verified".padEnd(12)}contradicted @ aaaabbb (${NOW})`);
  });

  it("show renders no anchor/badge lines for a legacy row", () => {
    const lines = formatMemoryShowLines(plain);
    expect(lines.some((l) => l.startsWith("anchor"))).toBe(false);
    expect(lines.some((l) => l.startsWith("verified"))).toBe(false);
  });

  it("explain renders anchor, verification, and the code-truth evidence trail", () => {
    const lines = formatMemoryExplainLines(anchored);
    expect(lines).toContain(`${"anchor".padEnd(16)}1 files, 1 symbols @ aaaabbb`);
    expect(lines).toContain(`${"verification".padEnd(16)}contradicted @ aaaabbb (${NOW})`);
    // evidence[] already renders — code-truth strings need no new plumbing
    expect(lines.find((l) => l.startsWith("evidence"))).toContain(EVIDENCE);
  });

  it("explain renders no anchor/verification lines for a legacy row", () => {
    const lines = formatMemoryExplainLines(plain);
    expect(lines.some((l) => l.startsWith("anchor"))).toBe(false);
    expect(lines.some((l) => l.startsWith("verification"))).toBe(false);
  });
});
