import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { handleFromSessionMemory } from "../../src/tools/from-session-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-06-30T00:00:00.000Z";
const NOW = "2026-06-30T12:00:00.000Z";

const FA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let counter = 0;
function env(registry: CoreRegistry) {
  counter = 0;
  return {
    registry,
    now: () => NOW,
    newId: () => `00000000-0000-4000-8000-${String(counter++).padStart(12, "0")}`,
  };
}

function addFailure(registry: CoreRegistry, id: string, over: Record<string, unknown>): void {
  registry.createFailedAttempt({
    id,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    task: "fix login",
    failedStep: "run auth tests",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: TS,
    ...over,
  } as never);
}

function seededRegistry(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "demo session",
    startedAt: TS,
    endedAt: null,
  });
  addFailure(registry, FA_A, {
    failedStep: "auth.test.ts > rejects expired token",
    errorOutput: "AssertionError: expected 200 to be 401",
    relatedFiles: ["src/middleware/auth.ts"],
  });
  addFailure(registry, FA_B, {
    failedStep: "build the cli bundle",
    errorOutput: "ENOENT: missing dist/cli.js",
  });
  return registry;
}

describe("handleFromSessionMemory", () => {
  it("stages suggested memories from the session's failures", async () => {
    const registry = seededRegistry();
    const result = await handleFromSessionMemory(env(registry), { sessionId: SESSION_ID });
    expect(result).toEqual({ suggested: 2, skipped: 0 });

    const created = registry.listMemoryEntries(PROJECT_ID);
    expect(created).toHaveLength(2);
    for (const m of created) {
      expect(m.approval).toBe("suggested");
      expect(m.scope).toBe("session");
      expect(m.sessionId).toBe(SESSION_ID);
    }
  });

  it("is idempotent — a second run stages nothing", async () => {
    const registry = seededRegistry();
    await handleFromSessionMemory(env(registry), { sessionId: SESSION_ID });
    const second = await handleFromSessionMemory(env(registry), { sessionId: SESSION_ID });
    expect(second).toEqual({ suggested: 0, skipped: 2 });
    expect(registry.listMemoryEntries(PROJECT_ID)).toHaveLength(2);
  });

  it("rejects an unknown session", async () => {
    const registry = seededRegistry();
    await expect(
      handleFromSessionMemory(env(registry), {
        sessionId: "99999999-9999-4999-8999-999999999999",
      }),
    ).rejects.toThrow();
  });

  it("rejects malformed input", async () => {
    const registry = seededRegistry();
    await expect(handleFromSessionMemory(env(registry), {})).rejects.toThrow();
  });
});
