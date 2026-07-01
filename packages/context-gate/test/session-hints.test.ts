import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestratorRegistry, SessionFailureRecord } from "../src/registry-port.js";
import { runOutputExecCommand } from "../src/run-command.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { buildSessionHints } from "../src/session-hints.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;

function failure(errorOutput: string): SessionFailureRecord {
  return {
    id: "33333333-3333-4333-8333-333333333333" as SessionFailureRecord["id"],
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    command: "pnpm test",
    errorOutput,
    source: "proxy-classifier",
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("buildSessionHints", () => {
  it("maps each failure's errorOutput into recentFailures in order", () => {
    const registry = {
      listSessionFailures: (projectId: ProjectId, sessionId: SessionId) => {
        expect(projectId).toBe(PROJECT_ID);
        expect(sessionId).toBe(SESSION_ID);
        return [failure("boom one"), failure("boom two")];
      },
    };

    const hints = buildSessionHints(registry, PROJECT_ID, SESSION_ID);

    expect(hints.recentFailures).toEqual(["boom one", "boom two"]);
    expect(hints.recentMemory).toBeUndefined();
    expect(hints.recentFiles).toBeUndefined();
  });

  it("returns an empty recentFailures list when there are no failures", () => {
    const registry = {
      listSessionFailures: () => [],
    };

    const hints = buildSessionHints(registry, PROJECT_ID, SESSION_ID);

    expect(hints.recentFailures).toEqual([]);
  });
});

const ROOT_PID = String(process.pid);
const NOW = "2026-07-01T00:00:00.000Z";

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
};
function makeChild(): FakeChild {
  const c = new EventEmitter() as FakeChild;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.killed = false;
  c.kill = vi.fn(() => {
    c.killed = true;
    return true;
  });
  return c;
}
function spawnMock(child: FakeChild): RunCommandSpawn {
  return ((_c: string, _a: readonly string[], _o: Record<string, unknown>) =>
    child) as unknown as RunCommandSpawn;
}
function makeSharedRegistry(
  projectRoot: string,
  created: SessionFailureRecord[],
): OrchestratorRegistry {
  return {
    getSession: (id) =>
      id === SESSION_ID
        ? {
            projectId: PROJECT_ID,
            tokenSaver: { mode: "balanced", maxReturnedBytes: 12_000, storeRawOutput: true },
          }
        : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: projectRoot } : null),
    createSessionFailure: (failure) => {
      created.push(failure);
      return failure;
    },
    listSessionFailures: () => [...created],
  };
}

describe("runOutputExecCommand — failure-aware ranking (session hints wired)", () => {
  let store: string;
  let projectRoot: string;
  let idCounter: number;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-hints-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-hints-root-"));
    idCounter = 0;
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("ranks a chunk referencing a prior failure signature above unrelated noise", async () => {
    const created: SessionFailureRecord[] = [];
    const registry = makeSharedRegistry(projectRoot, created);

    // Command 1 fails; Slice-1 capture records a SessionFailure whose errorOutput
    // is the signature "TS2322". buildSessionHints later maps it into recentFailures.
    const failChild = makeChild();
    const failPromise = runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "pnpm",
      args: ["typecheck"],
      intent: "typecheck",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      loadPermissions: () => null,
      spawn: spawnMock(failChild),
    });
    failChild.stdout.emit("data", Buffer.from("TS2322"));
    failChild.emit("close", 1);
    const failOutcome = await failPromise;
    expect(failOutcome.ok).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]?.errorOutput).toBe("TS2322");

    // Command 2 succeeds; its output has a chunk referencing TS2322 plus a
    // separate noise-only chunk. With sessionHints + engineRanking wired, the
    // TS2322 chunk must earn a positive failureHistoryBoost and outrank noise.
    const noiseTail = Array.from({ length: 45 }, (_, i) => `info detail entry ${i}`).join("\n");
    const secondBody = `TS2322\n${noiseTail}\n`;
    const okChild = makeChild();
    const okPromise = runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "pnpm",
      args: ["build"],
      intent: "build the project",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      loadPermissions: () => null,
      spawn: spawnMock(okChild),
    });
    okChild.stdout.emit("data", Buffer.from(secondBody));
    okChild.emit("close", 0);
    const okOutcome = await okPromise;
    expect(okOutcome.ok).toBe(true);
    if (!okOutcome.ok) return;

    const excerpts = okOutcome.result.excerpts;
    const boostedIndex = excerpts.findIndex((e) => e.text.includes("TS2322"));
    const noiseIndex = excerpts.findIndex((e) => !e.text.includes("TS2322"));
    expect(boostedIndex).toBeGreaterThanOrEqual(0);
    expect(noiseIndex).toBeGreaterThanOrEqual(0);
    // Engine ranking is active: the boosted chunk carries a positive
    // failureHistoryBoost and the noise chunk does not.
    expect(excerpts[boostedIndex]?.engine?.failureHistoryBoost).toBeGreaterThan(0);
    expect(excerpts[noiseIndex]?.engine?.failureHistoryBoost).toBe(0);
    // …and it is ranked ahead of the noise chunk.
    expect(boostedIndex).toBeLessThan(noiseIndex);
  });
});
