import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type OverlayMemoryEntry, overlayMemoryEntrySchema } from "../src/memory-entry.js";
import {
  readOverlayMemory,
  readOverlayTaskPlans,
  writeOverlayMemory,
  writeOverlayTaskPlans,
} from "../src/overlay-store.js";
import { type OverlayTaskPlan, overlayTaskPlanSchema } from "../src/task-plan.js";

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

const WK_A = "0123456789abcdef";
const WK_B = "fedcba9876543210";

const projRow: OverlayMemoryEntry = overlayMemoryEntrySchema.parse({
  ...BASE_MEMORY,
  scope: "project",
  liveSessionId: null,
});
const sessRow: OverlayMemoryEntry = overlayMemoryEntrySchema.parse({
  ...BASE_MEMORY,
  id: "00000000-0000-4000-8000-000000000002",
  scope: "session",
  liveSessionId: "00000000-0000-4000-8000-0000000000aa",
});

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mega-overlay-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("overlay memory store", () => {
  it("round-trips both project- and session-scoped rows under memory/<wk>.jsonl", () => {
    writeOverlayMemory(root, WK_A, [projRow, sessRow]);
    expect(existsSync(join(root, "memory", `${WK_A}.jsonl`))).toBe(true);
    const read = readOverlayMemory(root, WK_A);
    expect(read).toHaveLength(2);
    expect(read.map((r) => r.scope).sort()).toEqual(["project", "session"]);
  });

  it("deletes the file when the set becomes empty", () => {
    writeOverlayMemory(root, WK_A, [projRow]);
    writeOverlayMemory(root, WK_A, []);
    expect(existsSync(join(root, "memory", `${WK_A}.jsonl`))).toBe(false);
    expect(readOverlayMemory(root, WK_A)).toEqual([]);
  });

  it("isolates rows between two workspaceKeys", () => {
    writeOverlayMemory(root, WK_A, [projRow]);
    writeOverlayMemory(root, WK_B, [sessRow]);
    expect(readOverlayMemory(root, WK_A).map((r) => r.id)).toEqual([projRow.id]);
    expect(readOverlayMemory(root, WK_B).map((r) => r.id)).toEqual([sessRow.id]);
  });

  it("returns [] for a missing workspace file", () => {
    expect(readOverlayMemory(root, WK_A)).toEqual([]);
  });
});

const plan: OverlayTaskPlan = overlayTaskPlanSchema.parse(BASE_PLAN);
const workspacePlan: OverlayTaskPlan = overlayTaskPlanSchema.parse({
  ...BASE_PLAN,
  id: "00000000-0000-4000-8000-000000000b02",
  liveSessionId: null,
});

const LSID = "00000000-0000-4000-8000-0000000000aa";

describe("overlay task-plan store", () => {
  it("round-trips plans under tasks/<wk>/<lsid>.jsonl", () => {
    writeOverlayTaskPlans(root, WK_A, LSID, [plan]);
    expect(existsSync(join(root, "tasks", WK_A, `${LSID}.jsonl`))).toBe(true);
    const read = readOverlayTaskPlans(root, WK_A, LSID);
    expect(read).toHaveLength(1);
    expect(read[0]?.id).toBe(plan.id);
  });

  it("stores a workspace-level (null lsid) plan under tasks/<wk>/_workspace.jsonl", () => {
    writeOverlayTaskPlans(root, WK_A, null, [workspacePlan]);
    expect(existsSync(join(root, "tasks", WK_A, "_workspace.jsonl"))).toBe(true);
    const raw = readFileSync(join(root, "tasks", WK_A, "_workspace.jsonl"), "utf8");
    expect(raw).toContain(workspacePlan.id);
    expect(readOverlayTaskPlans(root, WK_A, null)).toHaveLength(1);
  });

  it("deletes the file when the plan set becomes empty", () => {
    writeOverlayTaskPlans(root, WK_A, LSID, [plan]);
    writeOverlayTaskPlans(root, WK_A, LSID, []);
    expect(existsSync(join(root, "tasks", WK_A, `${LSID}.jsonl`))).toBe(false);
    expect(readOverlayTaskPlans(root, WK_A, LSID)).toEqual([]);
  });

  it("isolates plans between liveSessionIds in the same workspace", () => {
    writeOverlayTaskPlans(root, WK_A, LSID, [plan]);
    expect(readOverlayTaskPlans(root, WK_A, "00000000-0000-4000-8000-0000000000bb")).toEqual([]);
  });
});
