import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "../src/memory-entry.js";
import {
  WRITE_VERIFY_DEFAULT_TTL_DAYS,
  type WriteResolution,
  classifyEvidencePointer,
  defaultWriteExpiresAt,
  verifyMemoryWrite,
} from "../src/write-verify.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CAND_ID = "22222222-2222-4222-8222-222222222222";
const APPROVED_ID = "33333333-3333-4333-8333-333333333333";
const CS_ID = `cs-${"a".repeat(32)}`;
const LEDGER_ID = "44444444-4444-4444-8444-444444444444";

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
    confidence: "high",
    source: "agent",
    approval: "approved",
    stale: false,
    relatedFiles: ["package.json"],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  }) as MemoryEntry;

const resolution = (over: Partial<WriteResolution> = {}): WriteResolution => ({
  resolutions: [],
  unresolvedSecret: false,
  hasRevoked: false,
  hasCrossWorkspace: false,
  resolverUnavailable: false,
  ...over,
});

const base = {
  candidate: mk(CAND_ID),
  callerConfidence: "high" as const,
  callerApproval: "approved" as const,
  approvedActive: [],
  droppedCitedFiles: [],
};

describe("classifyEvidencePointer (closed-form, Decision 3)", () => {
  it.each([
    ["possible-supersedes:xyz", "lineage_note"],
    [CS_ID, "chunk_set"],
    ["cs-not-32-hex", "ledger"],
    [LEDGER_ID, "ledger"],
  ])("%s -> %s", (pointer, kind) => {
    expect(classifyEvidencePointer(pointer)).toBe(kind);
  });
});

describe("verifyMemoryWrite rubric (Decision 4)", () => {
  it("all pointers resolve, nothing dropped -> verified; caller approval passes through", () => {
    const v = verifyMemoryWrite({
      ...base,
      resolution: resolution({
        resolutions: [
          { pointer: CS_ID, kind: "chunk_set", resolved: true },
          { pointer: LEDGER_ID, kind: "ledger", resolved: true },
        ],
      }),
    });
    expect(v.outcome).toBe("verified");
    expect(v.confidence).toBe("high");
    expect(v.approval).toBe("approved");
    expect(v.validationStatus).toBe("valid");
  });

  it("zero recognized pointers -> unverified + low + forced suggested + quarantined", () => {
    const v = verifyMemoryWrite({ ...base, resolution: resolution() });
    expect(v.outcome).toBe("unverified");
    expect(v.confidence).toBe("low");
    expect(v.approval).toBe("suggested");
    expect(v.validationStatus).toBe("quarantined");
    expect(v.reasons).toContain("zero_evidence_pointers");
  });

  it("one of two resolves -> partial, medium cap, needs_approval, forced suggested", () => {
    const v = verifyMemoryWrite({
      ...base,
      resolution: resolution({
        resolutions: [
          { pointer: LEDGER_ID, kind: "ledger", resolved: true },
          { pointer: CS_ID, kind: "chunk_set", resolved: false, reason: "chunk_set_not_found" },
        ],
      }),
    });
    expect(v.outcome).toBe("partial");
    expect(v.confidence).toBe("medium");
    expect(v.approval).toBe("suggested");
    expect(v.validationStatus).toBe("needs_approval");
    expect(v.reasons).toContain("chunk_set_not_found");
  });

  it.each([
    ["unresolvedSecret", { unresolvedSecret: true }, "unresolved_secret"],
    ["hasRevoked", { hasRevoked: true }, "revoked_evidence"],
    ["hasCrossWorkspace", { hasCrossWorkspace: true }, "cross_workspace_evidence"],
  ] as const)(
    "hard flag %s -> unverified even when every pointer resolves",
    (_n, flags, reason) => {
      const v = verifyMemoryWrite({
        ...base,
        resolution: resolution({
          ...flags,
          resolutions: [{ pointer: LEDGER_ID, kind: "ledger", resolved: true }],
        }),
      });
      expect(v.outcome).toBe("unverified");
      expect(v.confidence).toBe("low");
      expect(v.reasons).toContain(reason);
    },
  );

  it("contradiction against the approved corpus is a hard flag with conflictIds", () => {
    // existing type=decision vs candidate project_rule + shared file + negation
    // divergence -> contradiction branch (conflict-checker.ts:55-69).
    const approved = mk(APPROVED_ID, {
      content: "tests must pass before merge",
      keywords: ["merge", "pass"],
    });
    const v = verifyMemoryWrite({
      ...base,
      candidate: mk(CAND_ID, {
        type: "project_rule",
        content: "merge without waiting for tests",
        keywords: ["merge", "skip"],
      }),
      approvedActive: [approved],
      resolution: resolution({
        resolutions: [{ pointer: LEDGER_ID, kind: "ledger", resolved: true }],
      }),
    });
    expect(v.outcome).toBe("unverified");
    expect(v.reasons).toContain("conflict_contradiction");
    expect(v.conflictIds).toEqual([APPROVED_ID]);
  });

  it("a supersession conflict is NOT a hard flag — resolving pointers still verify", () => {
    const approved = mk(APPROVED_ID, { content: "use npm not pnpm", keywords: ["npm"] });
    const v = verifyMemoryWrite({
      ...base,
      approvedActive: [approved],
      resolution: resolution({
        resolutions: [{ pointer: LEDGER_ID, kind: "ledger", resolved: true }],
      }),
    });
    expect(v.outcome).toBe("verified");
  });

  it("caps never raise: verified caller-low stays low; partial caller-high drops to medium", () => {
    const verified = verifyMemoryWrite({
      ...base,
      callerConfidence: "low",
      resolution: resolution({
        resolutions: [{ pointer: LEDGER_ID, kind: "ledger", resolved: true }],
      }),
    });
    expect(verified.confidence).toBe("low");
    const partial = verifyMemoryWrite({
      ...base,
      resolution: resolution({
        resolutions: [
          { pointer: LEDGER_ID, kind: "ledger", resolved: true },
          { pointer: CS_ID, kind: "chunk_set", resolved: false, reason: "chunk_set_not_found" },
        ],
      }),
    });
    expect(partial.confidence).toBe("medium");
  });

  it("a cited file dropped by the anchor blocks verified (partial when a pointer resolves)", () => {
    const v = verifyMemoryWrite({
      ...base,
      droppedCitedFiles: ["src/ghost.ts"],
      resolution: resolution({
        resolutions: [{ pointer: LEDGER_ID, kind: "ledger", resolved: true }],
      }),
    });
    expect(v.outcome).toBe("partial");
    expect(v.reasons).toContain("anchor_dropped:src/ghost.ts");
  });

  it("resolver unavailable -> never verified, reason resolver_unavailable (Decision 5)", () => {
    const v = verifyMemoryWrite({
      ...base,
      resolution: resolution({
        resolverUnavailable: true,
        resolutions: [
          { pointer: LEDGER_ID, kind: "ledger", resolved: false, reason: "resolver_unavailable" },
        ],
      }),
    });
    expect(v.outcome).toBe("unverified");
    expect(v.approval).toBe("suggested");
    expect(v.reasons).toContain("resolver_unavailable");
  });
});

describe("defaultWriteExpiresAt (Decision 6)", () => {
  it("stamps createdAt + 90 days", () => {
    expect(WRITE_VERIFY_DEFAULT_TTL_DAYS).toBe(90);
    expect(defaultWriteExpiresAt("2026-08-01T00:00:00.000Z")).toBe("2026-10-30T00:00:00.000Z");
  });
  it("fails loud on an invalid createdAt", () => {
    expect(() => defaultWriteExpiresAt("not-a-date")).toThrowError(TypeError);
  });
});
