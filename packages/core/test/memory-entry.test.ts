import * as fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type MemoryEntry,
  type MemoryScope,
  memoryEntrySchema,
  memoryScopeSchema,
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
  content: "Repo uses strict ESM.",
  createdAt: CREATED_AT,
};

const validSessionMemory = {
  ...validProjectMemory,
  sessionId: SESSION_ID,
  scope: "session",
};

describe("memoryScopeSchema", () => {
  it("parses project and session scopes", () => {
    expect(memoryScopeSchema.parse("project")).toBe("project");
    expect(memoryScopeSchema.parse("session")).toBe("session");
  });

  it("rejects unknown scopes", () => {
    expect(memoryScopeSchema.safeParse("global").success).toBe(false);
  });
});

describe("memoryEntrySchema", () => {
  it("parses project-scoped memory", () => {
    expect(memoryEntrySchema.parse(validProjectMemory)).toEqual(
      validProjectMemory,
    );
  });

  it("parses session-scoped memory", () => {
    expect(memoryEntrySchema.parse(validSessionMemory)).toEqual(
      validSessionMemory,
    );
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

  it("requires sessionId for session-scoped memory", () => {
    const result = memoryEntrySchema.safeParse({
      ...validSessionMemory,
      sessionId: null,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["sessionId"]);
      expect(result.error.issues[0]?.message).toBe(
        "Session-scoped memory requires sessionId.",
      );
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
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual([
        "id",
        "projectId",
        "createdAt",
      ]);
    }
  });

  it("property: non-empty content is accepted after trimming", () => {
    fc.assert(
      fc.property(
        fc.string().filter((value) => value.trim().length > 0),
        (content) => {
          expect(
            memoryEntrySchema.safeParse({ ...validProjectMemory, content })
              .success,
          ).toBe(true);
        },
      ),
    );
  });

  it("exports inferred MemoryEntry and MemoryScope types", () => {
    expectTypeOf<MemoryScope>().toEqualTypeOf<"project" | "session">();
    expectTypeOf<MemoryEntry>().toMatchTypeOf<{
      id: string;
      projectId: string;
      sessionId: string | null;
      scope: "project" | "session";
      content: string;
      createdAt: string;
    }>();
  });
});
