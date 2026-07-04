import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReplayTraces } from "@megasaver/output-filter";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestratorRegistry } from "../src/registry-port.js";
import { runOutputExecCommand } from "../src/run-command.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { runOutputPipeline } from "../src/run.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const NOW = "2026-07-02T12:00:00.000Z";
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
function makeFakeRegistry(projectRoot: string): OrchestratorRegistry {
  return {
    getSession: (id) =>
      id === SESSION_ID
        ? {
            projectId: PROJECT_ID,
            tokenSaver: { mode: "balanced", maxReturnedBytes: 12_000, storeRawOutput: true },
          }
        : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: projectRoot } : null),
    createSessionFailure: (f) => f,
    listSessionFailures: () => [],
    listMemoryEntries: () => [],
    listProjectRules: () => [],
  };
}

describe("replay trace recording (seam phase 2 P2.6)", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-trace-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-trace-root-"));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  const tracesPath = () =>
    join(store, "stats", PROJECT_ID, `${SESSION_ID}-traces`, "replay-traces.jsonl");

  function runExec() {
    const child = makeChild();
    const p = runOutputExecCommand({
      registry: makeFakeRegistry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "pnpm",
      args: ["test"],
      intent: "run tests",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => "cs-trace-exec",
      loadPermissions: () => null,
      spawn: spawnMock(child),
    });
    child.stdout.emit("data", Buffer.from("token validation fix in src/auth.ts\n"));
    child.emit("close", 0);
    return p;
  }

  it("exec appends a per-session replay trace when MEGASAVER_SEAM_TRACE=true", async () => {
    vi.stubEnv("MEGASAVER_SEAM_TRACE", "true");
    const res = await runExec();
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const traces = readReplayTraces(tracesPath());
    expect(traces).toHaveLength(1);
    expect(traces[0]?.ranking.engineRanking).toBe(true);
    expect(traces[0]?.toolName).toBe("proxy_run_command");
    expect(traces[0]?.sessionId).toBe(SESSION_ID);
    expect(traces[0]?.projectId).toBe(PROJECT_ID);
    expect(traces[0]?.chunkSetId).toBe(res.result.chunkSetId);
    // The seam applied engine ranking to the delivered excerpts.
    expect(res.result.excerpts.some((e) => e.engine !== undefined)).toBe(true);
    // The trace is measurement data on disk, never agent-visible payload.
    expect(res.result).not.toHaveProperty("trace");
  });

  it("MEGASAVER_ENGINE_RANKING=false records a seam-off trace with no engine scores", async () => {
    vi.stubEnv("MEGASAVER_SEAM_TRACE", "true");
    vi.stubEnv("MEGASAVER_ENGINE_RANKING", "false");
    const res = await runExec();
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const traces = readReplayTraces(tracesPath());
    expect(traces).toHaveLength(1);
    expect(traces[0]?.ranking.engineRanking).toBe(false);
    expect(res.result.excerpts.every((e) => e.engine === undefined)).toBe(true);
  });

  it("read pipeline appends a replay trace alongside the exec path", async () => {
    vi.stubEnv("MEGASAVER_SEAM_TRACE", "true");
    const notesPath = join(projectRoot, "notes.log");
    await writeFile(notesPath, "auth token notes referencing src/auth.ts\n");
    const outcome = await runOutputPipeline({
      registry: makeFakeRegistry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      path: notesPath,
      intent: "auth token validation",
      now: () => NOW,
      newId: () => "cs-trace-read",
      loadPermissions: () => null,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const traces = readReplayTraces(tracesPath());
    expect(traces).toHaveLength(1);
    expect(traces[0]?.toolName).toBe("proxy_read_file");
    expect(traces[0]?.ranking.engineRanking).toBe(true);
    expect(traces[0]?.chunkSetId).toBe(outcome.result.chunkSetId);
    expect(outcome.result).not.toHaveProperty("trace");
  });

  it("MEGASAVER_SEAM_TRACE unset → exec writes a trace (on by default)", async () => {
    const res = await runExec();
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Tracing is on by default now: an unset env still records the causal trace.
    expect(res.result.excerpts.some((e) => e.engine !== undefined)).toBe(true);
    const traces = readReplayTraces(tracesPath());
    expect(traces).toHaveLength(1);
    expect(traces[0]?.toolName).toBe("proxy_run_command");
  });

  it("MEGASAVER_SEAM_TRACE=false → exec writes no trace file (kill switch)", async () => {
    vi.stubEnv("MEGASAVER_SEAM_TRACE", "false");
    const res = await runExec();
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Delivery is untouched; only the measurement side channel is disabled.
    expect(res.result.excerpts.some((e) => e.engine !== undefined)).toBe(true);
    expect(existsSync(tracesPath())).toBe(false);
    expect(existsSync(join(store, "stats", PROJECT_ID, `${SESSION_ID}-traces`))).toBe(false);
  });

  it("MEGASAVER_SEAM_TRACE unset → read pipeline writes a trace (on by default)", async () => {
    const notesPath = join(projectRoot, "notes.log");
    await writeFile(notesPath, "auth token notes referencing src/auth.ts\n");
    const outcome = await runOutputPipeline({
      registry: makeFakeRegistry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      path: notesPath,
      intent: "auth token validation",
      now: () => NOW,
      newId: () => "cs-trace-read",
      loadPermissions: () => null,
    });
    expect(outcome.ok).toBe(true);
    const traces = readReplayTraces(tracesPath());
    expect(traces).toHaveLength(1);
    expect(traces[0]?.toolName).toBe("proxy_read_file");
  });

  it("MEGASAVER_SEAM_TRACE=false → read pipeline writes no trace file (kill switch)", async () => {
    vi.stubEnv("MEGASAVER_SEAM_TRACE", "false");
    const notesPath = join(projectRoot, "notes.log");
    await writeFile(notesPath, "auth token notes referencing src/auth.ts\n");
    const outcome = await runOutputPipeline({
      registry: makeFakeRegistry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      path: notesPath,
      intent: "auth token validation",
      now: () => NOW,
      newId: () => "cs-trace-read",
      loadPermissions: () => null,
    });
    expect(outcome.ok).toBe(true);
    expect(existsSync(tracesPath())).toBe(false);
  });

  it("MEGASAVER_SEAM_TRACE=1 also enables trace recording", async () => {
    vi.stubEnv("MEGASAVER_SEAM_TRACE", "1");
    const res = await runExec();
    expect(res.ok).toBe(true);
    expect(readReplayTraces(tracesPath())).toHaveLength(1);
  });

  // Slice A: redaction is stamped inline on the registry trace at BOTH seams.
  // The copy-paste-twin risk is that only one seam gets it — assert exec AND
  // read each carry the redaction fact for a secret-bearing output.
  const SECRET = "ghp_0123456789abcdefghijABCDEFGHIJ0123456789";

  it("exec seam stamps redaction inline when the output carries a secret", async () => {
    vi.stubEnv("MEGASAVER_SEAM_TRACE", "true");
    const child = makeChild();
    const p = runOutputExecCommand({
      registry: makeFakeRegistry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "pnpm",
      args: ["test"],
      intent: "run tests",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => "cs-trace-exec-secret",
      loadPermissions: () => null,
      spawn: spawnMock(child),
    });
    child.stdout.emit("data", Buffer.from(`export TOKEN=${SECRET}\n`));
    child.emit("close", 0);
    const res = await p;
    expect(res.ok).toBe(true);

    const traces = readReplayTraces(tracesPath());
    expect(traces).toHaveLength(1);
    expect(traces[0]?.redaction?.redacted).toBe(true);
    expect(traces[0]?.redaction?.secretsRedacted).toBeGreaterThan(0);
  });

  it("read seam stamps redaction inline when the file carries a secret", async () => {
    vi.stubEnv("MEGASAVER_SEAM_TRACE", "true");
    const notesPath = join(projectRoot, "secret.log");
    await writeFile(notesPath, `api key ${SECRET} for the service\n`);
    const outcome = await runOutputPipeline({
      registry: makeFakeRegistry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      path: notesPath,
      intent: "api key",
      now: () => NOW,
      newId: () => "cs-trace-read-secret",
      loadPermissions: () => null,
    });
    expect(outcome.ok).toBe(true);

    const traces = readReplayTraces(tracesPath());
    expect(traces).toHaveLength(1);
    expect(traces[0]?.redaction?.redacted).toBe(true);
    expect(traces[0]?.redaction?.secretsRedacted).toBeGreaterThan(0);
  });
});
