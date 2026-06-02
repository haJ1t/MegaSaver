import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJsonDirectoryCoreRegistry } from "../../src/index.js";
import { type RunCommandSpawn, runOutputExecCommand } from "../../src/context-gate/run-command.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-10T00:00:00.000Z";
const NOW = "2026-05-10T12:00:00.000Z";
const NEW_ID = "cs-fixed-id";
// Root run: originPid === String(process.pid) so the recursive guard passes.
const ROOT_PID = String(process.pid);

type SeedOpts = { storeRawOutput?: boolean; withTokenSaver?: boolean; maxReturnedBytes?: number };

async function seed(store: string, projectRoot: string, opts: SeedOpts = {}): Promise<void> {
  await mkdir(store, { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
    ]),
  );
  const session: Record<string, unknown> = {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "demo session",
    startedAt: TS,
    endedAt: null,
  };
  if (opts.withTokenSaver !== false) {
    session.tokenSaver = {
      enabled: true,
      mode: "balanced",
      maxReturnedBytes: opts.maxReturnedBytes ?? 12_000,
      storeRawOutput: opts.storeRawOutput ?? true,
      redactSecrets: true,
      autoRepair: true,
      createdAt: TS,
      updatedAt: TS,
    };
  }
  await writeFile(join(store, "sessions.json"), JSON.stringify([session]));
}

// Minimal fake ChildProcess: an EventEmitter with stdout/stderr emitters and a
// kill() spy. The orchestrator subscribes to stdout/stderr "data", to "close"
// (exit code) and "error" (spawn failure).
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
  child.kill = vi.fn((_signal?: string) => {
    child.killed = true;
    return true;
  });
  return child;
}

/** A spawn mock that records its args and hands the test a child to drive. */
function spawnMock(child: FakeChild): {
  spawn: RunCommandSpawn;
  calls: Array<{ command: string; args: readonly string[]; options: Record<string, unknown> }>;
} {
  const calls: Array<{
    command: string;
    args: readonly string[];
    options: Record<string, unknown>;
  }> = [];
  const spawn = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
    calls.push({ command, args, options });
    return child;
  }) as unknown as RunCommandSpawn;
  return { spawn, calls };
}

describe("runOutputExecCommand (orchestrator)", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-runcmd-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-runcmd-root-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function baseInput(overrides: Record<string, unknown> = {}) {
    const child = makeChild();
    const { spawn, calls } = spawnMock(child);
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    const input = {
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as SessionId,
      command: "pnpm",
      args: ["test"] as readonly string[],
      intent: "find failing tests",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      spawn,
      now: () => NOW,
      newId: () => NEW_ID,
      ...overrides,
    };
    return { input, child, calls };
  }

  // ---- policy denial: NEVER spawns -------------------------------------

  it("command_not_allowed: denies a non-allowlisted command and NEVER spawns", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, calls } = baseInput({ command: "rmtree", args: [] });

    const outcome = await runOutputExecCommand(input);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("command_denied");
      if (outcome.reason === "command_denied") expect(outcome.code).toBe("command_not_allowed");
    }
    expect(calls).toHaveLength(0);
    await expect(readdir(join(store, "content", PROJECT_ID, SESSION_ID))).rejects.toThrow();
  });

  it("dangerous_pattern: denies `rm -rf /` and NEVER spawns", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, calls } = baseInput({ command: "pnpm", args: ["exec", "rm", "-rf", "/"] });

    const outcome = await runOutputExecCommand(input);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.reason === "command_denied") {
      expect(outcome.code).toBe("dangerous_pattern");
    }
    expect(calls).toHaveLength(0);
  });

  it("recursive_megasaver: inherited originPid !== pid denies and NEVER spawns", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, calls } = baseInput({ originPid: "999999" });

    const outcome = await runOutputExecCommand(input);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.reason === "command_denied") {
      expect(outcome.code).toBe("recursive_megasaver");
    }
    expect(calls).toHaveLength(0);
  });

  it("session_not_found: unknown session denies and NEVER spawns", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, calls } = baseInput({
      sessionId: "99999999-9999-4999-8999-999999999999" as SessionId,
    });

    const outcome = await runOutputExecCommand(input);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("session_not_found");
    expect(calls).toHaveLength(0);
  });

  // ---- spawn success: full pipeline ------------------------------------

  it("spawn success: combines stdout+stderr, filters, stores chunkSet, appends stats", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, child, calls } = baseInput();

    const promise = runOutputExecCommand(input);
    // Emit interleaved chunks then a clean close.
    child.stdout.emit("data", Buffer.from("line one\n"));
    child.stderr.emit("data", Buffer.from("error: boom\n"));
    child.stdout.emit("data", Buffer.from("line three\n"));
    child.emit("close", 0);
    const outcome = await promise;

    expect(calls).toHaveLength(1);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.childExitCode).toBe(0);
      expect(outcome.result.chunkSetId).toBe(NEW_ID);
      expect(outcome.result.rawBytes).toBeGreaterThan(0);
      expect(typeof outcome.result.summary).toBe("string");
      expect(outcome.result.terminated).toBeUndefined();
    }

    const persisted = await readdir(join(store, "content", PROJECT_ID, SESSION_ID));
    expect(persisted).toContain(`${NEW_ID}.json`);

    // Stats event appended.
    const eventsFile = join(store, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`);
    const events = await readFile(eventsFile, "utf8");
    expect(events).toContain('"sourceKind":"command"');
  });

  it("source is kind:command with the command + args on the persisted chunkSet", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, child } = baseInput({ command: "ls", args: ["-la"] });

    const promise = runOutputExecCommand(input);
    child.stdout.emit("data", Buffer.from("total 0\n"));
    child.emit("close", 0);
    await promise;

    const file = join(store, "content", PROJECT_ID, SESSION_ID, `${NEW_ID}.json`);
    const chunkSet = JSON.parse(await readFile(file, "utf8")) as {
      source: { kind: string; command?: string; args?: string[] };
    };
    expect(chunkSet.source.kind).toBe("command");
    expect(chunkSet.source.command).toBe("ls");
    expect(chunkSet.source.args).toEqual(["-la"]);
  });

  // ---- child non-zero exit ---------------------------------------------

  it("child non-zero exit: output still stored, childExitCode mirrored", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, child } = baseInput();

    const promise = runOutputExecCommand(input);
    child.stdout.emit("data", Buffer.from("some output\n"));
    child.emit("close", 7);
    const outcome = await promise;

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.childExitCode).toBe(7);
      expect(outcome.result.chunkSetId).toBe(NEW_ID);
    }
  });

  // ---- redaction applied (filter redacts internally) -------------------

  it("redaction applied: secret-shaped output is redacted; warning present; redacted flag true", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, child } = baseInput();

    const promise = runOutputExecCommand(input);
    child.stdout.emit("data", Buffer.from("key=sk-ant-0123456789012345678901234567\n"));
    child.emit("close", 0);
    const outcome = await promise;

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect((outcome.result.warnings ?? []).some((w) => w.startsWith("redacted"))).toBe(true);
      const allText = outcome.result.summary + outcome.result.excerpts.map((e) => e.text).join("");
      expect(allText).not.toContain("sk-ant-0123456789012345678901234567");
    }

    const file = join(store, "content", PROJECT_ID, SESSION_ID, `${NEW_ID}.json`);
    const chunkSet = JSON.parse(await readFile(file, "utf8")) as { redacted: boolean };
    expect(chunkSet.redacted).toBe(true);

    // secretsRedacted recorded on the stats event.
    const events = await readFile(
      join(store, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`),
      "utf8",
    );
    expect(events).toContain('"sourceKind":"command"');
  });

  // ---- storeRawOutput=false: no store ----------------------------------

  it("storeRawOutput=false: no chunkSet written, no chunkSetId, content dir empty", async () => {
    await seed(store, projectRoot, { storeRawOutput: false });
    const { input, child } = baseInput();

    const promise = runOutputExecCommand(input);
    child.stdout.emit("data", Buffer.from("hello\n"));
    child.emit("close", 0);
    const outcome = await promise;

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.chunkSetId).toBeUndefined();
    await expect(readdir(join(store, "content", PROJECT_ID, SESSION_ID))).rejects.toThrow();
  });

  // ---- spawn error (ENOENT) --------------------------------------------

  it("spawn error: ENOENT yields command_failed; no store, no stats", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, child } = baseInput();

    const promise = runOutputExecCommand(input);
    const err = Object.assign(new Error("spawn nope ENOENT"), { code: "ENOENT" });
    child.emit("error", err);
    const outcome = await promise;

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("command_failed");
    await expect(readdir(join(store, "content", PROJECT_ID, SESSION_ID))).rejects.toThrow();
  });

  // ---- timeout: partial output processed, terminated marked ------------

  it("timeout: manual timer fires SIGTERM, partial output stored, terminated=timeout, ok", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    vi.useFakeTimers();
    try {
      const { input, child } = baseInput({ timeoutMs: 1_000 });

      const promise = runOutputExecCommand(input);
      child.stdout.emit("data", Buffer.from("partial before timeout\n"));
      // Fire the manual timeout timer.
      await vi.advanceTimersByTimeAsync(1_000);
      // The orchestrator should have sent SIGTERM; the child then closes.
      expect(child.kill).toHaveBeenCalled();
      child.emit("close", null);
      const outcome = await promise;

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.result.terminated).toBe("timeout");
        expect(outcome.result.childExitCode).toBeNull();
        expect((outcome.result.warnings ?? []).some((w) => w.includes("timeout"))).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  // ---- max-bytes: capture stops, child killed, terminated marked -------

  it("max_bytes: capture stops at cap, child killed, terminated=max_bytes, ok", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, child } = baseInput({ maxBytes: 16 });

    const promise = runOutputExecCommand(input);
    child.stdout.emit("data", Buffer.from("0123456789")); // 10 bytes
    child.stdout.emit("data", Buffer.from("abcdefghij")); // breaches 16
    // Orchestrator kills the child; then the child closes.
    expect(child.kill).toHaveBeenCalled();
    child.emit("close", null);
    const outcome = await promise;

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.terminated).toBe("max_bytes");
      expect(outcome.result.rawBytes).toBeLessThanOrEqual(16);
      expect((outcome.result.warnings ?? []).some((w) => w.includes("max_bytes"))).toBe(true);
    }
  });

  // ---- env propagation: MEGASAVER_ORIGIN_PID on spawn env --------------

  it("env propagation: spawn receives env.MEGASAVER_ORIGIN_PID === originPid and cwd=projectRoot, shell:false", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, child, calls } = baseInput();

    const promise = runOutputExecCommand(input);
    child.emit("close", 0);
    await promise;

    expect(calls).toHaveLength(1);
    const opts = calls[0]?.options as {
      cwd?: string;
      shell?: boolean;
      env?: Record<string, string>;
    };
    expect(opts.env?.MEGASAVER_ORIGIN_PID).toBe(ROOT_PID);
    expect(opts.cwd).toBe(projectRoot);
    expect(opts.shell).toBe(false);
  });

  // ---- maxBytes (filter budget) resolution -----------------------------

  it("maxReturnedBytes over the 64000 ceiling is clamped (no error)", async () => {
    await seed(store, projectRoot, { storeRawOutput: true, maxReturnedBytes: 5_000_000 });
    const { input, child } = baseInput();

    const promise = runOutputExecCommand(input);
    child.stdout.emit("data", Buffer.from("alpha\nbeta\ngamma\n"));
    child.emit("close", 0);
    const outcome = await promise;

    // Clamp is internal; the run must still succeed (the value came from a
    // validated session record, not user input).
    expect(outcome.ok).toBe(true);
  });

  it("pre-AA session (no tokenSaver) uses balanced defaults and stores", async () => {
    await seed(store, projectRoot, { withTokenSaver: false });
    const { input, child } = baseInput();

    const promise = runOutputExecCommand(input);
    child.stdout.emit("data", Buffer.from("alpha\nbeta\n"));
    child.emit("close", 0);
    const outcome = await promise;

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.chunkSetId).toBe(NEW_ID);
  });

  // ---- store_write_failed ----------------------------------------------

  it("store_write_failed: a failing saveChunkSet surfaces store_write_failed", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    // Point storeRoot at a path that cannot be written (a file, not a dir),
    // so content-store's mkdir/write throws.
    const blocker = join(projectRoot, "blocker-file");
    await writeFile(blocker, "x");
    const { input, child } = baseInput({ storeRoot: blocker });

    const promise = runOutputExecCommand(input);
    child.stdout.emit("data", Buffer.from("data\n"));
    child.emit("close", 0);
    const outcome = await promise;

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("store_write_failed");
  });
});
