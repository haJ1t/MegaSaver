import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestratorRegistry, SessionFailureRecord } from "../src/registry-port.js";
import { runOutputExecCommand } from "../src/run-command.js";
import type { RunCommandSpawn } from "../src/run-command.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const NOW = "2026-07-01T00:00:00.000Z";
const ROOT_PID = String(process.pid);

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
function makeFakeRegistry(
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

describe("session failure capture", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-fail-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-fail-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("records a SessionFailure when the command exits non-zero", async () => {
    const created: SessionFailureRecord[] = [];
    const child = makeChild();
    const p = runOutputExecCommand({
      registry: makeFakeRegistry(projectRoot, created),
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "pnpm",
      args: ["test"],
      intent: "run tests",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => "33333333-3333-4333-8333-333333333333",
      loadPermissions: () => null,
      spawn: spawnMock(child),
    });
    child.stdout.emit("data", Buffer.from("boom"));
    child.emit("close", 1);
    const res = await p;
    expect(res.ok).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]?.command).toBe("pnpm test");
    expect(created[0]?.errorOutput).toContain("boom");
    expect(created[0]?.source).toBe("proxy-classifier");
  });

  it("records nothing when the command exits zero", async () => {
    const created: SessionFailureRecord[] = [];
    const child = makeChild();
    const p = runOutputExecCommand({
      registry: makeFakeRegistry(projectRoot, created),
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "pnpm",
      args: ["test"],
      intent: "run tests",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => "33333333-3333-4333-8333-333333333333",
      loadPermissions: () => null,
      spawn: spawnMock(child),
    });
    child.stdout.emit("data", Buffer.from("ok"));
    child.emit("close", 0);
    const res = await p;
    expect(res.ok).toBe(true);
    expect(created).toHaveLength(0);
  });
});
