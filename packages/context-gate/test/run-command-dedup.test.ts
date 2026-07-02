import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestratorRegistry } from "../src/registry-port.js";
import { runOutputExecCommand, runOverlayOutputExecCommand } from "../src/run-command.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { runOutputPipeline, runOverlayOutputPipeline } from "../src/run.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const NOW = "2026-06-10T12:00:00.000Z";
const ROOT_PID = String(process.pid);
const BODY = "line one\nerror: boom\nline three\n";

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

describe("runOutputExecCommand — grep-then-read dedup (shared session index)", () => {
  let store: string;
  let projectRoot: string;
  let idCounter: number;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-exec-dedup-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-exec-dedup-root-"));
    idCounter = 0;
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("exec records an excerpt; a later read of the same text is suppressed", async () => {
    const child = makeChild();
    const execPromise = runOutputExecCommand({
      registry: registry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "grep",
      args: ["error"],
      intent: "find the error",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      loadPermissions: () => null,
      spawn: spawnMock(child),
    });
    child.stdout.emit("data", Buffer.from(BODY));
    child.emit("close", 0);
    const execOutcome = await execPromise;
    expect(execOutcome.ok).toBe(true);
    if (!execOutcome.ok) return;
    // biome-ignore lint/style/noNonNullAssertion: storeRawOutput true guarantees chunkSetId
    const grepChunkSetId = execOutcome.result.chunkSetId!;
    // biome-ignore lint/style/noNonNullAssertion: non-empty grep output yields >=1 excerpt
    const grepText = execOutcome.result.excerpts[0]!.text;

    const filePath = join(projectRoot, "f.txt");
    await writeFile(filePath, BODY);
    const readOutcome = await runOutputPipeline({
      registry: registry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      path: filePath,
      intent: "find the error",
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      loadPermissions: () => null,
    });
    expect(readOutcome.ok).toBe(true);
    if (!readOutcome.ok) return;
    expect(readOutcome.result.deduped?.priorChunkSetIds).toContain(grepChunkSetId);
    expect(readOutcome.result.excerpts.map((e) => e.text)).not.toContain(grepText);
    const grepRaw = await readFile(
      join(store, "content", PROJECT_ID, SESSION_ID, `${grepChunkSetId}.json`),
      "utf8",
    );
    expect(grepRaw).toContain("error: boom");
  });

  it("fresh exec with no prior hit suppresses nothing", async () => {
    const child = makeChild();
    const p = runOutputExecCommand({
      registry: registry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "grep",
      args: ["x"],
      intent: "x",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      loadPermissions: () => null,
      spawn: spawnMock(child),
    });
    child.stdout.emit("data", Buffer.from("unique exec output\n"));
    child.emit("close", 0);
    const o = await p;
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect("deduped" in o.result).toBe(false);
  });
});

const WK = "0123456789abcdef";
const LSID = "33333333-3333-4333-8333-333333333333";

describe("runOverlayOutputExecCommand — grep-then-read dedup (overlay)", () => {
  let store: string;
  let cwd: string;
  let idCounter: number;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-ov-exec-dedup-store-"));
    cwd = await mkdtemp(join(tmpdir(), "cg-ov-exec-dedup-cwd-"));
    idCounter = 0;
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it("overlay exec records; later overlay read of same text is suppressed", async () => {
    const child = makeChild();
    const execPromise = runOverlayOutputExecCommand({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd,
      command: "grep",
      args: ["error"],
      intent: "find the error",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: true,
      permissions: null,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      spawn: spawnMock(child),
    });
    child.stdout.emit("data", Buffer.from(BODY));
    child.emit("close", 0);
    const execOutcome = await execPromise;
    expect(execOutcome.ok).toBe(true);
    if (!execOutcome.ok) return;
    // biome-ignore lint/style/noNonNullAssertion: storeRawOutput true guarantees chunkSetId
    const grepChunkSetId = execOutcome.result.chunkSetId!;

    const filePath = join(cwd, "f.txt");
    await writeFile(filePath, BODY);
    const readOutcome = await runOverlayOutputPipeline({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd,
      path: filePath,
      intent: "find the error",
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: true,
      permissions: null,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
    });
    expect(readOutcome.ok).toBe(true);
    if (!readOutcome.ok) return;
    expect(readOutcome.result.deduped?.priorChunkSetIds).toContain(grepChunkSetId);
    const grepRaw = await readFile(
      join(store, "content", WK, LSID, `${grepChunkSetId}.json`),
      "utf8",
    );
    expect(grepRaw).toContain("error: boom");
  });
});
