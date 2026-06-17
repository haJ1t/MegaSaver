import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "../src/memory-entry.js";
import { validateSave } from "../src/save-validator.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MEM_ID = "00000000-0000-4000-8000-0000000000a1";

function candidate(over: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: MEM_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use strict ESM",
    content: "The repo uses strict ESM with NodeNext resolution.",
    keywords: ["esm"],
    confidence: "medium",
    source: "agent",
    approval: "suggested",
    stale: false,
    createdAt: "2026-06-16T12:00:00.000Z",
    updatedAt: "2026-06-16T12:00:00.000Z",
    ...over,
  } as MemoryEntry;
}

describe("validateSave hard checks", () => {
  it("a human save with no evidence is valid (humans assert directly)", () => {
    const r = validateSave({ candidate: candidate({ source: "manual" }), evidenceIds: [], unresolvedSecret: false });
    expect(r.status).toBe("valid");
  });

  it("an agent save with no evidence is quarantined (non-human needs evidence)", () => {
    const r = validateSave({ candidate: candidate({ source: "agent" }), evidenceIds: [], unresolvedSecret: false });
    expect(r.status).toBe("quarantined");
    expect(r.reasons).toContain("missing_evidence");
  });

  it("an agent save with evidence and no flags is valid", () => {
    const r = validateSave({ candidate: candidate({ source: "agent" }), evidenceIds: ["ev-1"], unresolvedSecret: false });
    expect(r.status).toBe("valid");
  });

  it("an unresolved secret finding is rejected regardless of source", () => {
    const r = validateSave({ candidate: candidate({ source: "manual" }), evidenceIds: ["ev-1"], unresolvedSecret: true });
    expect(r.status).toBe("rejected");
    expect(r.reasons).toContain("unresolved_secret");
  });

  it("an absolute or traversal relatedFiles path is rejected", () => {
    const r = validateSave({
      candidate: candidate({ relatedFiles: ["/etc/shadow"] }),
      evidenceIds: ["ev-1"],
      unresolvedSecret: false,
    });
    expect(r.status).toBe("rejected");
    expect(r.reasons).toContain("unsafe_related_file");
  });

  it("over-long content is rejected (bounded)", () => {
    const r = validateSave({
      candidate: candidate({ content: "x".repeat(8001) }),
      evidenceIds: ["ev-1"],
      unresolvedSecret: false,
    });
    expect(r.status).toBe("rejected");
    expect(r.reasons).toContain("content_too_long");
  });
});

describe("validateSave advisory heuristics", () => {
  it("high confidence with zero evidence is needs_approval (confidence exceeds evidence)", () => {
    const r = validateSave({
      candidate: candidate({ source: "manual", confidence: "high" }),
      evidenceIds: [],
      unresolvedSecret: false,
    });
    expect(r.status).toBe("needs_approval");
    expect(r.reasons).toContain("confidence_exceeds_evidence");
  });

  it("a transcript-fragment-looking content is needs_approval", () => {
    const r = validateSave({
      candidate: candidate({ content: "@@ -1,4 +1,4 @@ const x = 1;\n+const y = 2;\n-const z = 3;" }),
      evidenceIds: ["ev-1"],
      unresolvedSecret: false,
    });
    expect(r.status).toBe("needs_approval");
    expect(r.reasons).toContain("looks_like_transcript_fragment");
  });

  it("advisory never overrides a hard rejection", () => {
    const r = validateSave({
      candidate: candidate({ source: "manual", confidence: "high", content: "x".repeat(8001) }),
      evidenceIds: [],
      unresolvedSecret: false,
    });
    expect(r.status).toBe("rejected"); // content_too_long wins
  });
});
