import * as fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type MemoryConfidence,
  type MemoryEntry,
  type MemoryScope,
  type MemorySource,
  type MemoryType,
  backfillMemoryEntry,
  isCurrent,
  memoryConfidenceSchema,
  memoryEntrySchema,
  memoryEntryUpdatePatchSchema,
  memoryScopeSchema,
  memorySourceSchema,
  memoryTypeSchema,
  overlayMemoryEntrySchema,
} from "../src/memory-entry.js";

const MEMORY_ENTRY_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = "2026-05-04T12:30:00.000Z";

const validProjectMemory = {
  id: MEMORY_ENTRY_ID,
  projectId: PROJECT_ID,
  sessionId: null,
  scope: "project",
  type: "decision",
  title: "Use JWT middleware for protected routes",
  content: "Repo uses strict ESM.",
  keywords: ["auth", "jwt"],
  confidence: "high",
  source: "manual",
  approval: "approved",
  stale: false,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

const validSessionMemory = {
  ...validProjectMemory,
  sessionId: SESSION_ID,
  scope: "session",
};

describe("memoryTypeSchema", () => {
  it("accepts all ten engineering memory types", () => {
    for (const type of [
      "decision",
      "bug",
      "architecture",
      "todo",
      "user_preference",
      "failed_attempt",
      "code_pattern",
      "project_rule",
      "dependency",
      "test_behavior",
    ]) {
      expect(memoryTypeSchema.parse(type)).toBe(type);
    }
  });

  it("rejects unknown types", () => {
    expect(memoryTypeSchema.safeParse("idea").success).toBe(false);
  });

  it("preserves the roadmap declaration order", () => {
    expect(memoryTypeSchema.options).toEqual([
      "decision",
      "bug",
      "architecture",
      "todo",
      "user_preference",
      "failed_attempt",
      "code_pattern",
      "project_rule",
      "dependency",
      "test_behavior",
    ]);
  });
});

describe("memoryConfidenceSchema", () => {
  it("parses low/medium/high in ascending order", () => {
    expect(memoryConfidenceSchema.options).toEqual(["low", "medium", "high"]);
  });

  it("rejects unknown confidence", () => {
    expect(memoryConfidenceSchema.safeParse("certain").success).toBe(false);
  });
});

describe("memorySourceSchema", () => {
  it("parses the five provenance sources in roadmap order", () => {
    expect(memorySourceSchema.options).toEqual([
      "manual",
      "agent",
      "test_failure",
      "git_diff",
      "session_summary",
    ]);
  });

  it("rejects unknown source", () => {
    expect(memorySourceSchema.safeParse("import").success).toBe(false);
  });
});

describe("memoryScopeSchema", () => {
  it("parses project and session scopes", () => {
    expect(memoryScopeSchema.parse("project")).toBe("project");
    expect(memoryScopeSchema.parse("session")).toBe("session");
  });

  it("rejects unknown scopes", () => {
    expect(memoryScopeSchema.safeParse("global").success).toBe(false);
  });

  it("preserves semantic order project→session — AA3 convention", () => {
    expect(memoryScopeSchema.options).toEqual(["project", "session"]);
  });
});

describe("memoryEntrySchema", () => {
  it("parses a typed project-scoped memory", () => {
    expect(memoryEntrySchema.parse(validProjectMemory)).toEqual(validProjectMemory);
  });

  it("parses a typed session-scoped memory", () => {
    expect(memoryEntrySchema.parse(validSessionMemory)).toEqual(validSessionMemory);
  });

  it("trims content", () => {
    expect(
      memoryEntrySchema.parse({
        ...validProjectMemory,
        content: "  Keep evidence lines.  ",
      }).content,
    ).toBe("Keep evidence lines.");
  });

  it("rejects empty content after trimming", () => {
    const result = memoryEntrySchema.safeParse({
      ...validProjectMemory,
      content: "   ",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["content"]);
    }
  });

  it("requires the new typed fields", () => {
    const { type, title, keywords, confidence, source, updatedAt, ...withoutTyped } =
      validProjectMemory;
    const result = memoryEntrySchema.safeParse(withoutTyped);

    expect(result.success).toBe(false);
    if (!result.success) {
      const missing = new Set(result.error.issues.map((issue) => issue.path.join(".")));
      expect(missing).toEqual(
        new Set(["type", "title", "keywords", "confidence", "source", "updatedAt"]),
      );
    }
  });

  it("normalizes keywords: lowercase, trim, dedupe, drop empties", () => {
    expect(
      memoryEntrySchema.parse({
        ...validProjectMemory,
        keywords: ["Auth", " JWT ", "auth", "", "JWT"],
      }).keywords,
    ).toEqual(["auth", "jwt"]);
  });

  it("defaults stale to false when omitted", () => {
    const { stale, ...withoutStale } = validProjectMemory;
    expect(memoryEntrySchema.parse(withoutStale).stale).toBe(false);
  });

  it("accepts optional metadata", () => {
    const enriched = {
      ...validProjectMemory,
      reason: "Tenant isolation requires per-request validation.",
      goal: "Secure protected routes.",
      evidence: ["src/middleware/auth.ts:42"],
      relatedFiles: ["src/middleware/auth.ts", "src/lib/jwt.ts"],
      relatedSymbols: ["verifyJwt"],
      expiresAt: "2026-12-31T00:00:00.000Z",
    };
    expect(memoryEntrySchema.parse(enriched)).toEqual(enriched);
  });

  it("accepts a null expiresAt", () => {
    expect(
      memoryEntrySchema.parse({ ...validProjectMemory, expiresAt: null }).expiresAt,
    ).toBeNull();
  });

  it("rejects an invalid title", () => {
    const result = memoryEntrySchema.safeParse({ ...validProjectMemory, title: "bad\ntitle" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["title"]);
    }
  });

  it("requires sessionId for session-scoped memory", () => {
    const result = memoryEntrySchema.safeParse({
      ...validSessionMemory,
      sessionId: null,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["sessionId"]);
      expect(result.error.issues[0]?.message).toBe("Session-scoped memory requires sessionId.");
    }
  });

  it("forbids sessionId for project-scoped memory", () => {
    const result = memoryEntrySchema.safeParse({
      ...validProjectMemory,
      sessionId: SESSION_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["sessionId"]);
      expect(result.error.issues[0]?.message).toBe(
        "Project-scoped memory cannot include sessionId.",
      );
    }
  });

  it("rejects invalid ids and datetimes", () => {
    const result = memoryEntrySchema.safeParse({
      ...validProjectMemory,
      id: "not-a-uuid",
      projectId: "not-a-uuid",
      createdAt: "today",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = new Set(result.error.issues.map((issue) => issue.path.join(".")));
      expect(paths).toEqual(new Set(["id", "projectId", "createdAt"]));
    }
  });

  it("rejects unknown fields", () => {
    const result = memoryEntrySchema.safeParse({
      ...validProjectMemory,
      embedding: [0.1, 0.2],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  it("property: non-empty content is accepted after trimming", () => {
    fc.assert(
      fc.property(
        fc.string().filter((value) => value.trim().length > 0),
        (content) => {
          expect(memoryEntrySchema.safeParse({ ...validProjectMemory, content }).success).toBe(
            true,
          );
        },
      ),
    );
  });

  it("backfills a v0.1-shaped row to the typed schema", () => {
    const legacy = {
      id: MEMORY_ENTRY_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      content: "Repo uses strict ESM.",
      createdAt: CREATED_AT,
    };
    const upgraded = memoryEntrySchema.parse(backfillMemoryEntry(legacy));
    expect(upgraded).toMatchObject({
      type: "todo",
      title: "Repo uses strict ESM.",
      keywords: [],
      confidence: "low",
      source: "manual",
      stale: false,
      approval: "approved",
      updatedAt: CREATED_AT,
    });
  });

  it("backfill is idempotent — already-typed approved rows pass through unchanged", () => {
    expect(backfillMemoryEntry(validProjectMemory)).toEqual(validProjectMemory);
  });

  it("adds approval to a corrupt row but it still fails schema validation", () => {
    const corrupt = {
      id: MEMORY_ENTRY_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      content: "no timestamp",
    };
    expect(backfillMemoryEntry(corrupt)).toEqual({ ...corrupt, approval: "approved" });
    expect(() => memoryEntrySchema.parse(backfillMemoryEntry(corrupt))).toThrow();
  });

  it("backfills a typed Phase 1-9 row without approval to approved", () => {
    // Build a typed row that genuinely lacks the `approval` key (no undefined
    // property — `"approval" in raw` must return false for the gate to fire).
    const { approval: _omit, ...typedNoApproval } = validProjectMemory;
    void _omit;
    const upgraded = memoryEntrySchema.parse(backfillMemoryEntry(typedNoApproval));
    expect(upgraded.approval).toBe("approved");
  });

  it("exports inferred types", () => {
    expectTypeOf<MemoryScope>().toEqualTypeOf<"project" | "session">();
    expectTypeOf<MemoryType>().toEqualTypeOf<
      | "decision"
      | "bug"
      | "architecture"
      | "todo"
      | "user_preference"
      | "failed_attempt"
      | "code_pattern"
      | "project_rule"
      | "dependency"
      | "test_behavior"
    >();
    expectTypeOf<MemoryConfidence>().toEqualTypeOf<"low" | "medium" | "high">();
    expectTypeOf<MemorySource>().toEqualTypeOf<
      "manual" | "agent" | "test_failure" | "git_diff" | "session_summary"
    >();
    expectTypeOf<MemoryEntry>().toMatchTypeOf<{
      id: string;
      projectId: string;
      sessionId: string | null;
      scope: "project" | "session";
      type: MemoryType;
      title: string;
      content: string;
      keywords: string[];
      confidence: MemoryConfidence;
      source: MemorySource;
      stale: boolean;
      createdAt: string;
      updatedAt: string;
    }>();
  });
});

describe("memoryApprovalSchema", () => {
  it("approval defaults to approved when omitted", () => {
    const parsed = memoryEntrySchema.parse({ ...validProjectMemory, approval: undefined });
    expect(parsed.approval).toBe("approved");
  });

  it("approval accepts the three lifecycle members", () => {
    for (const a of ["suggested", "approved", "rejected"] as const) {
      expect(memoryEntrySchema.parse({ ...validProjectMemory, approval: a }).approval).toBe(a);
    }
  });

  it("approval rejects an unknown value", () => {
    expect(() => memoryEntrySchema.parse({ ...validProjectMemory, approval: "maybe" })).toThrow();
  });

  it("update patch accepts approval", () => {
    const patch = memoryEntryUpdatePatchSchema.parse({
      approval: "approved",
      updatedAt: CREATED_AT,
    });
    expect(patch.approval).toBe("approved");
  });
});

const VALID_FROM = "2026-06-01T00:00:00.000Z";
const VALID_TO = "2026-06-20T00:00:00.000Z";

describe("bi-temporal validity fields", () => {
  it("memoryEntrySchema accepts validFrom, validTo, and supersedesId", () => {
    const parsed = memoryEntrySchema.parse({
      ...validProjectMemory,
      validFrom: VALID_FROM,
      validTo: VALID_TO,
      supersedesId: "44444444-4444-4444-8444-444444444444",
    });
    expect(parsed.validFrom).toBe(VALID_FROM);
    expect(parsed.validTo).toBe(VALID_TO);
    expect(parsed.supersedesId).toBe("44444444-4444-4444-8444-444444444444");
  });

  it("memoryEntrySchema accepts validTo: null (still valid)", () => {
    const parsed = memoryEntrySchema.parse({ ...validProjectMemory, validTo: null });
    expect(parsed.validTo).toBeNull();
  });

  it("memoryEntrySchema still parses rows lacking the temporal fields (back-compat)", () => {
    const parsed = memoryEntrySchema.parse(validProjectMemory);
    expect(parsed.validFrom).toBeUndefined();
    expect(parsed.validTo).toBeUndefined();
    expect(parsed.supersedesId).toBeUndefined();
  });

  it("overlayMemoryEntrySchema mirrors the temporal fields", () => {
    const parsed = overlayMemoryEntrySchema.parse({
      id: MEMORY_ENTRY_ID,
      workspaceKey: "ws",
      liveSessionId: null,
      scope: "project",
      type: "decision",
      title: "t",
      content: "c",
      keywords: [],
      confidence: "high",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      validFrom: VALID_FROM,
      validTo: null,
      supersedesId: "44444444-4444-4444-8444-444444444444",
    });
    expect(parsed.validFrom).toBe(VALID_FROM);
    expect(parsed.validTo).toBeNull();
    expect(parsed.supersedesId).toBe("44444444-4444-4444-8444-444444444444");
  });

  it("update patch accepts validTo (closing validity)", () => {
    const patch = memoryEntryUpdatePatchSchema.parse({ validTo: VALID_TO, updatedAt: CREATED_AT });
    expect(patch.validTo).toBe(VALID_TO);
  });
});

describe("isCurrent", () => {
  const withBounds = (validFrom?: string, validTo?: string | null): MemoryEntry =>
    memoryEntrySchema.parse({
      ...validProjectMemory,
      ...(validFrom !== undefined ? { validFrom } : {}),
      ...(validTo !== undefined ? { validTo } : {}),
    });

  it("treats a row with no bounds as current", () => {
    expect(isCurrent(withBounds(), VALID_TO)).toBe(true);
  });

  it("is not current before validFrom", () => {
    expect(isCurrent(withBounds(VALID_FROM), "2026-05-31T00:00:00.000Z")).toBe(false);
  });

  it("is current at validFrom", () => {
    expect(isCurrent(withBounds(VALID_FROM), VALID_FROM)).toBe(true);
  });

  it("is current strictly within bounds", () => {
    expect(isCurrent(withBounds(VALID_FROM, VALID_TO), "2026-06-10T00:00:00.000Z")).toBe(true);
  });

  it("is not current at validTo (half-open upper bound)", () => {
    expect(isCurrent(withBounds(VALID_FROM, VALID_TO), VALID_TO)).toBe(false);
  });

  it("is not current after validTo", () => {
    expect(isCurrent(withBounds(VALID_FROM, VALID_TO), "2026-07-01T00:00:00.000Z")).toBe(false);
  });

  it("is current when validTo is null", () => {
    expect(isCurrent(withBounds(VALID_FROM, null), "2026-07-01T00:00:00.000Z")).toBe(true);
  });
});
