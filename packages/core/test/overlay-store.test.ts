import { describe, expect, it } from "vitest";
import { overlayMemoryEntrySchema } from "../src/memory-entry.js";
import { overlayTaskPlanSchema } from "../src/task-plan.js";

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

const STEP_A = "00000000-0000-4000-8000-000000000a01";
const STEP_B = "00000000-0000-4000-8000-000000000a02";

const BASE_PLAN = {
  id: "00000000-0000-4000-8000-000000000b01",
  workspaceKey: "0123456789abcdef",
  liveSessionId: "00000000-0000-4000-8000-0000000000aa",
  task: "ship overlay store",
  status: "planned" as const,
  steps: [
    {
      id: STEP_A,
      type: "scan" as const,
      title: "scan repo",
      dependsOn: [],
      status: "pending" as const,
      startedAt: null,
      completedAt: null,
    },
    {
      id: STEP_B,
      type: "edit" as const,
      title: "write store",
      dependsOn: [STEP_A],
      status: "pending" as const,
      startedAt: null,
      completedAt: null,
    },
  ],
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

describe("overlayTaskPlanSchema", () => {
  it("accepts a plan keyed by workspaceKey + liveSessionId", () => {
    const parsed = overlayTaskPlanSchema.parse(BASE_PLAN);
    expect(parsed.workspaceKey).toBe("0123456789abcdef");
    expect(parsed.liveSessionId).toBe("00000000-0000-4000-8000-0000000000aa");
    expect(parsed.steps).toHaveLength(2);
  });

  it("accepts a workspace-level plan with null liveSessionId", () => {
    const parsed = overlayTaskPlanSchema.parse({ ...BASE_PLAN, liveSessionId: null });
    expect(parsed.liveSessionId).toBeNull();
  });

  it("rejects duplicate step ids", () => {
    expect(() =>
      overlayTaskPlanSchema.parse({
        ...BASE_PLAN,
        steps: [BASE_PLAN.steps[0], BASE_PLAN.steps[0]],
      }),
    ).toThrow();
  });

  it("rejects dependsOn referencing an unknown step", () => {
    expect(() =>
      overlayTaskPlanSchema.parse({
        ...BASE_PLAN,
        steps: [{ ...BASE_PLAN.steps[0], dependsOn: ["00000000-0000-4000-8000-000000000fff"] }],
      }),
    ).toThrow();
  });

  it("rejects a plan carrying projectId (strict)", () => {
    expect(() =>
      overlayTaskPlanSchema.parse({
        ...BASE_PLAN,
        projectId: "00000000-0000-4000-8000-000000000099",
      }),
    ).toThrow();
  });
});
