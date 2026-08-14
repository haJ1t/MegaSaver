import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { readEvents, readOverlayEvents } from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestratorRegistry } from "../src/registry-port.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { runOutputExecCommand, runOverlayOutputExecCommand } from "../src/run-command.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const WK = "0123456789abcdef";
const LSID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-08-06T12:00:00.000Z";
const ROOT_PID = String(process.pid);

const OUTPUT = "ok: 12 tests passed\n";

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
};

function makeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

function spawnMock(child: FakeChild): RunCommandSpawn {
  return ((_c: string, _a: readonly string[], _o: Record<string, unknown>) =>
    child) as unknown as RunCommandSpawn;
}

function registry(projectRoot: string): OrchestratorRegistry {
  return {
    getSession: (id) =>
      id === SESSION_ID
        ? {
            projectId: PROJECT_ID,
            tokenSaver: { mode: "balanced", maxReturnedBytes: 12_000, storeRawOutput: true },
          }
        : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: projectRoot } : null),
    createSessionFailure: (failure) => failure,
    listSessionFailures: () => [],
    listMemoryEntries: () => [],
    listProjectRules: () => [],
  };
}

function execInput(child: FakeChild, newId: string) {
  return {
    registry: registry(projectRoot),
    storeRoot: store,
    sessionId: SESSION_ID,
    command: "grep",
    args: ["error"],
    intent: "verify the run",
    originPid: ROOT_PID,
    timeoutMs: 300_000,
    maxBytes: 20_000_000,
    now: () => NOW,
    newId: () => newId,
    loadPermissions: () => null,
    spawn: spawnMock(child),
  };
}

let store: string;
let projectRoot: string;

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "cg-receipt-store-"));
  projectRoot = await mkdtemp(join(tmpdir(), "cg-receipt-root-"));
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
  await rm(projectRoot, { recursive: true, force: true });
});

describe("exec receipts record the child exit code", () => {
  it("records 0 on a clean run", async () => {
    const child = makeChild();
    const pending = runOutputExecCommand(execInput(child, "cs-receipt-0"));
    child.stdout.emit("data", Buffer.from(OUTPUT));
    child.emit("close", 0);
    const outcome = await pending;
    expect(outcome.ok).toBe(true);

    const [event] = readEvents({ root: store }, PROJECT_ID, SESSION_ID);
    expect(event?.childExitCode).toBe(0);
  });

  it("records the real non-zero code, not a clamp", async () => {
    const child = makeChild();
    const pending = runOutputExecCommand(execInput(child, "cs-receipt-2"));
    child.stdout.emit("data", Buffer.from("FAIL 3 tests\n"));
    child.emit("close", 2);
    const outcome = await pending;
    expect(outcome.ok).toBe(true);

    const [event] = readEvents({ root: store }, PROJECT_ID, SESSION_ID);
    expect(event?.childExitCode).toBe(2);
  });

  it("records the overlay receipt exit code", async () => {
    const child = makeChild();
    const pending = runOverlayOutputExecCommand({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd: projectRoot,
      command: "grep",
      args: ["error"],
      intent: "verify the run",
      originPid: ROOT_PID,
      mode: "balanced",
      storeRawOutput: true,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => "cs-receipt-ov",
      spawn: spawnMock(child),
    } as unknown as Parameters<typeof runOverlayOutputExecCommand>[0]);
    child.stdout.emit("data", Buffer.from(OUTPUT));
    child.emit("close", 0);
    const outcome = await pending;
    expect(outcome.ok).toBe(true);

    expect(readOverlayEvents({ root: store }, WK, LSID)[0]?.childExitCode).toBe(0);
  });
});
