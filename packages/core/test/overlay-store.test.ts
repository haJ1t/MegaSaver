import { describe, expect, it } from "vitest";
import { overlayMemoryEntrySchema } from "../src/memory-entry.js";

const BASE_MEMORY = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceKey: "0123456789abcdef",
  type: "decision" as const,
  title: "use overlay store",
  content: "store memory keyed by workspaceKey",
  keywords: [],
  confidence: "high" as const,
  source: "manual" as const,
  approval: "approved" as const,
  stale: false,
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

describe("overlayMemoryEntrySchema", () => {
  it("accepts a session-scoped row with non-null liveSessionId", () => {
    const parsed = overlayMemoryEntrySchema.parse({
      ...BASE_MEMORY,
      scope: "session",
      liveSessionId: "00000000-0000-4000-8000-0000000000aa",
    });
    expect(parsed.scope).toBe("session");
    expect(parsed.liveSessionId).toBe("00000000-0000-4000-8000-0000000000aa");
  });

  it("accepts a project-scoped row with null liveSessionId", () => {
    const parsed = overlayMemoryEntrySchema.parse({
      ...BASE_MEMORY,
      scope: "project",
      liveSessionId: null,
    });
    expect(parsed.liveSessionId).toBeNull();
  });

  it("rejects scope:session with null liveSessionId", () => {
    expect(() =>
      overlayMemoryEntrySchema.parse({
        ...BASE_MEMORY,
        scope: "session",
        liveSessionId: null,
      }),
    ).toThrow();
  });

  it("rejects scope:project with non-null liveSessionId", () => {
    expect(() =>
      overlayMemoryEntrySchema.parse({
        ...BASE_MEMORY,
        scope: "project",
        liveSessionId: "00000000-0000-4000-8000-0000000000aa",
      }),
    ).toThrow();
  });

  it("rejects a row carrying projectId or sessionId (strict)", () => {
    expect(() =>
      overlayMemoryEntrySchema.parse({
        ...BASE_MEMORY,
        scope: "project",
        liveSessionId: null,
        projectId: "00000000-0000-4000-8000-000000000099",
      }),
    ).toThrow();
    expect(() =>
      overlayMemoryEntrySchema.parse({
        ...BASE_MEMORY,
        scope: "session",
        liveSessionId: "00000000-0000-4000-8000-0000000000aa",
        sessionId: "00000000-0000-4000-8000-000000000099",
      }),
    ).toThrow();
  });
});
