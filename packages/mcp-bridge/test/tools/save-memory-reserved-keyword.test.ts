import {
  type CoreRegistry,
  DEFAULT_AUTOPILOT_POLICY,
  createInMemoryCoreRegistry,
  runAutopilot,
} from "@megasaver/core";
import type { MemoryEntryId, ProjectId, SessionId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { handleSaveMemory } from "../../src/tools/save-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const PRIOR_SESSION = "22222222-2222-4222-8222-222222222222" as SessionId;
const CURRENT_SESSION = "33333333-3333-4333-8333-333333333333" as SessionId;
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";

function registryWithProject(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/nonexistent/never-a-git-repo",
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

function seedRecurringFailure(registry: CoreRegistry): void {
  for (const [id, startedAt] of [
    [PRIOR_SESSION, TS],
    [CURRENT_SESSION, NOW],
  ] as const) {
    registry.createSession({
      id,
      projectId: PROJECT_ID,
      agentId: "claude-code",
      riskLevel: "medium",
      title: "s",
      startedAt,
      endedAt: null,
    } as never);
  }
  // Same failure in TWO sessions => a genuine cross-session recurrence autopilot
  // must auto-approve.
  let n = 0;
  for (const sessionId of [PRIOR_SESSION, CURRENT_SESSION]) {
    n += 1;
    registry.createFailedAttempt({
      id: `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, "0")}`,
      projectId: PROJECT_ID,
      sessionId,
      task: "task",
      failedStep: "auth middleware crashes",
      errorOutput: "TypeError: x is undefined",
      relatedFiles: [],
      convertedToRule: false,
      createdAt: sessionId === PRIOR_SESSION ? TS : NOW,
    } as never);
  }
}

function runAuto(registry: CoreRegistry) {
  return runAutopilot({
    registry,
    projectId: PROJECT_ID,
    sessionId: CURRENT_SESSION,
    policy: DEFAULT_AUTOPILOT_POLICY,
    now: NOW,
    newId: () => crypto.randomUUID(),
  });
}

describe("save_memory reserves the from-session ledger namespace", () => {
  it("strips a reserved keyword from agent input, keeps the rest", async () => {
    const registry = registryWithProject();
    const result = await handleSaveMemory(
      { registry, now: () => TS, newId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "a real memory",
        keywords: ["from-session:cccccccc-cccc-4ccc-8ccc-000000000002:73b5e6cebe082b46", "auth"],
      },
    );
    const stored = registry.getMemoryEntry(result.id as MemoryEntryId);
    expect(stored?.keywords).toEqual(["auth"]);
  });

  it("a forged ledger keyword via save_memory can no longer suppress an autopilot capture", async () => {
    // The real ledger keyword autopilot would write for this recurrence.
    const probe = registryWithProject();
    seedRecurringFailure(probe);
    const baseline = await runAuto(probe);
    const forgedKeyword = baseline.autoApproved[0]?.keywords[0];
    expect(forgedKeyword).toMatch(/^from-session:/);
    if (forgedKeyword === undefined) return;

    // An agent pre-writes that exact keyword onto an unrelated memory to
    // suppress the capture — the vector this fix closes.
    const registry = registryWithProject();
    seedRecurringFailure(registry);
    await handleSaveMemory(
      { registry, now: () => NOW, newId: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "unrelated note the agent controls",
        keywords: [forgedKeyword],
      },
    );

    const result = await runAuto(registry);

    // Stripped at the boundary => the forge never lands => autopilot still
    // captures the lesson (pre-fix this was autoApproved 0, skippedExisting 1).
    expect(result.autoApproved).toHaveLength(1);
    expect(result.skippedExisting).toBe(0);
  });

  it("a CASE/whitespace-obfuscated forge cannot suppress either (schema normalizes it back)", async () => {
    const probe = registryWithProject();
    seedRecurringFailure(probe);
    const realKeyword = (await runAuto(probe)).autoApproved[0]?.keywords[0];
    expect(realKeyword).toMatch(/^from-session:/);
    if (realKeyword === undefined) return;
    // The agent obfuscates the prefix: keywordsSchema would `.trim().toLowerCase()`
    // it back to the exact reserved keyword on write. The strip must catch it raw.
    const obfuscated = `  ${realKeyword.replace("from-session:", "From-Session:")}`;

    const registry = registryWithProject();
    seedRecurringFailure(registry);
    await handleSaveMemory(
      { registry, now: () => NOW, newId: () => "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "obfuscated forge",
        keywords: [obfuscated],
      },
    );

    const result = await runAuto(registry);
    expect(result.autoApproved).toHaveLength(1);
    expect(result.skippedExisting).toBe(0);
  });
});
