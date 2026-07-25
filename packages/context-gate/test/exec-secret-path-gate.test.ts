import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProjectPermissions } from "@megasaver/policy";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestratorRegistry } from "../src/registry-port.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { runOutputExecCommand, runOverlayOutputExecCommand } from "../src/run-command.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const NOW = "2026-07-25T12:00:00.000Z";
const ROOT_PID = String(process.pid);
const WK = "wk-secret-path";
const LSID = "ls-secret-path";

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
function spawnSpy(child: FakeChild): RunCommandSpawn & ReturnType<typeof vi.fn> {
  return vi.fn(() => child) as unknown as RunCommandSpawn & ReturnType<typeof vi.fn>;
}
// Spawn spy for the denial cases: it must never be called, but if the gate is
// missing it has to complete the run so the assertion fails on the verdict
// instead of hanging on a child that never closes.
function leakingSpawn(): RunCommandSpawn & ReturnType<typeof vi.fn> {
  return vi.fn(() => {
    const child = makeChild();
    setImmediate(() => {
      child.stdout.emit("data", Buffer.from("LEAKED SECRET BODY\n"));
      child.emit("close", 0);
    });
    return child;
  }) as unknown as RunCommandSpawn & ReturnType<typeof vi.fn>;
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

describe("exec path — secret-path denylist on command args", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-exec-secret-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-exec-secret-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function exec(
    command: string,
    args: readonly string[],
    spawn: RunCommandSpawn,
    loadPermissions: () => ReturnType<typeof parseProjectPermissions> | null = () => null,
  ) {
    return runOutputExecCommand({
      registry: registry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      command,
      args,
      intent: "read the secret",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => "cs-0",
      loadPermissions,
      spawn,
    });
  }

  // The exact arg vector `buildGrepArgs` (mcp-bridge search-code) emits for
  // `proxy_search_code({query: "=", include_globs: [".env"]})`.
  it("denies grep --include=<denied glob> before spawn", async () => {
    const spawn = leakingSpawn();
    const outcome = await exec("grep", ["-r", "-n", "--include=.env", "-e", "=", "."], spawn);
    expect(outcome).toEqual({ ok: false, reason: "command_denied", code: "secret_path_read" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("denies an absolute denied path handed to cat before spawn", async () => {
    const spawn = leakingSpawn();
    const outcome = await exec("cat", ["/Users/dev/.aws/credentials"], spawn);
    expect(outcome).toEqual({ ok: false, reason: "command_denied", code: "secret_path_read" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("denies a project deny.read glob handed to tail before spawn", async () => {
    const spawn = leakingSpawn();
    const permissions = parseProjectPermissions({ deny: { read: ["**/*.secret"] } });
    const outcome = await exec("tail", ["-n", "50", "config/app.secret"], spawn, () => permissions);
    expect(outcome).toEqual({ ok: false, reason: "command_denied", code: "secret_path_read" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("still runs a grep whose args touch no denied path", async () => {
    const child = makeChild();
    const spawn = spawnSpy(child);
    const promise = exec("grep", ["-r", "-n", "--include=*.ts", "-e", "error", "src"], spawn);
    child.stdout.emit("data", Buffer.from("src/a.ts:1:error: boom\n"));
    child.emit("close", 0);
    const outcome = await promise;
    expect(outcome.ok).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("denies a denied path on the overlay exec twin before spawn", async () => {
    const spawn = leakingSpawn();
    const outcome = await runOverlayOutputExecCommand({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd: projectRoot,
      command: "cat",
      args: [".env.production"],
      intent: "read the secret",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: true,
      permissions: null,
      spawn,
      now: () => NOW,
      newId: () => "cs-0",
    });
    expect(outcome).toEqual({ ok: false, reason: "command_denied", code: "secret_path_read" });
    expect(spawn).not.toHaveBeenCalled();
  });
});
