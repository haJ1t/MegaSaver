import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execCommandFromPositionals, runOutputExec } from "../../src/commands/output/exec.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-10T00:00:00.000Z";
const NOW = "2026-05-10T12:00:00.000Z";
const NEW_ID = "cs-fixed-id";
const ROOT_PID = String(process.pid);

type SeedOpts = { storeRawOutput?: boolean };

async function seed(store: string, projectRoot: string, opts: SeedOpts = {}): Promise<void> {
  await mkdir(store, { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
    ]),
  );
  await writeFile(
    join(store, "sessions.json"),
    JSON.stringify([
      {
        id: SESSION_ID,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: "demo session",
        startedAt: TS,
        endedAt: null,
        tokenSaver: {
          enabled: true,
          mode: "balanced",
          maxReturnedBytes: 12_000,
          storeRawOutput: opts.storeRawOutput ?? true,
          redactSecrets: true,
          autoRepair: true,
          createdAt: TS,
          updatedAt: TS,
        },
      },
    ]),
  );
}

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function makeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => true);
  return child;
}

type Script = {
  stdout?: readonly string[];
  stderr?: readonly string[];
  // "close" with the given code (default 0), or "error" with the given message.
  close?: number | null;
  error?: string;
};

// A spawn mock that drives the child on setImmediate AFTER it is invoked. The
// orchestrator subscribes to the child synchronously inside its Promise
// executor (same tick as the spawn call), but the CLI adapter awaits
// ensureStoreReady first — so emitting synchronously from the test would race
// the subscription. Scheduling on setImmediate guarantees listeners are
// attached before any event fires.
function scriptedSpawn(child: FakeChild, script: Script) {
  const calls: unknown[] = [];
  const spawn = ((...a: unknown[]) => {
    calls.push(a);
    setImmediate(() => {
      for (const chunk of script.stdout ?? []) child.stdout.emit("data", Buffer.from(chunk));
      for (const chunk of script.stderr ?? []) child.stderr.emit("data", Buffer.from(chunk));
      if (script.error !== undefined) {
        child.emit("error", new Error(script.error));
        return;
      }
      child.emit("close", script.close ?? 0);
    });
    return child as unknown;
    // biome-ignore lint/suspicious/noExplicitAny: cast for the orchestrator's spawn slot
  }) as any;
  return { spawn, calls };
}

// A spawn mock that records the call but never drives the child — used for the
// denial branches where spawn must NEVER be invoked.
function inertSpawn() {
  const calls: unknown[] = [];
  const spawn = ((...a: unknown[]) => {
    calls.push(a);
    return makeChild() as unknown;
    // biome-ignore lint/suspicious/noExplicitAny: cast for the orchestrator's spawn slot
  }) as any;
  return { spawn, calls };
}

function capture(): { out: string[]; err: string[] } {
  return { out: [], err: [] };
}

describe("runOutputExec", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-exec-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-exec-root-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  // For denial branches: an inert spawn (records calls, never drives a child).
  function baseInput(overrides: Record<string, unknown> = {}) {
    const { spawn, calls } = inertSpawn();
    const { out, err } = capture();
    const input = {
      sessionId: SESSION_ID,
      intentFlag: "find the error",
      command: "pnpm",
      args: ["test"] as readonly string[],
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (l: string) => out.push(l),
      stderr: (l: string) => err.push(l),
      json: false,
      originPid: ROOT_PID,
      spawn,
      now: () => NOW,
      newId: () => NEW_ID,
      ...overrides,
    };
    return { input, calls, out, err };
  }

  // For spawn-success / child-exit / termination branches: a scripted spawn.
  function scriptedInput(script: Script, overrides: Record<string, unknown> = {}) {
    const child = makeChild();
    const { spawn, calls } = scriptedSpawn(child, script);
    const { out, err } = capture();
    const input = {
      sessionId: SESSION_ID,
      intentFlag: "find the error",
      command: "pnpm",
      args: ["test"] as readonly string[],
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (l: string) => out.push(l),
      stderr: (l: string) => err.push(l),
      json: false,
      originPid: ROOT_PID,
      spawn,
      now: () => NOW,
      newId: () => NEW_ID,
      ...overrides,
    };
    return { input, child, calls, out, err };
  }

  // ---- intent_required -------------------------------------------------

  it("missing --intent → exit 1, intent_required on stderr, never spawns", async () => {
    await seed(store, projectRoot);
    const { input, calls, out, err } = baseInput({ intentFlag: undefined });

    const code = await runOutputExec(input);

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("intent_required"))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("empty --intent → exit 1, intent_required, never spawns", async () => {
    await seed(store, projectRoot);
    const { input, calls, err } = baseInput({ intentFlag: "" });
    const code = await runOutputExec(input);
    expect(code).toBe(1);
    expect(err.some((e) => e.includes("intent_required"))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  // ---- invalid session id ----------------------------------------------

  it("invalid session id → exit 1, never spawns", async () => {
    await seed(store, projectRoot);
    const { input, calls, out, err } = baseInput({ sessionId: "not-a-uuid" });

    const code = await runOutputExec(input);

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => /invalid session id/.test(e))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  // ---- command_denied: command_not_allowed -----------------------------

  it("non-allowlisted command → command_denied: command_not_allowed, exit 1, no spawn", async () => {
    await seed(store, projectRoot);
    const { input, calls, out, err } = baseInput({ command: "rmtree", args: [] });

    const code = await runOutputExec(input);

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("command_denied: command_not_allowed"))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  // ---- command_denied: dangerous_pattern -------------------------------

  it("`rm -rf /` → command_denied: dangerous_pattern, exit 1, no spawn", async () => {
    await seed(store, projectRoot);
    const { input, calls, err } = baseInput({ command: "pnpm", args: ["exec", "rm", "-rf", "/"] });

    const code = await runOutputExec(input);

    expect(code).toBe(1);
    expect(err.some((e) => e.includes("command_denied: dangerous_pattern"))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  // ---- session_not_found -----------------------------------------------

  it("unknown session → exit 1, no spawn", async () => {
    await seed(store, projectRoot);
    const { input, calls, out, err } = baseInput({
      sessionId: "99999999-9999-4999-8999-999999999999",
    });

    const code = await runOutputExec(input);

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => /not found/.test(e))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  // ---- spawn success (text) --------------------------------------------

  it("spawn success (text): exit 0, `Ran <cmd> for <id> (...)` with chunkSetId", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, out, err } = scriptedInput({
      stdout: ["line one\nerror: boom\nline three\n"],
      close: 0,
    });

    const code = await runOutputExec(input);

    expect(code).toBe(0);
    expect(err).toHaveLength(0);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toContain(`Ran pnpm test for ${SESSION_ID}`);
    expect(out.join("\n")).toContain(`chunkSetId=${NEW_ID}`);

    const persisted = await readdir(join(store, "content", PROJECT_ID, SESSION_ID));
    expect(persisted).toContain(`${NEW_ID}.json`);
  });

  // ---- spawn success (json) --------------------------------------------

  it("spawn success (--json): exit 0, single-line { sessionId, result } with childExitCode", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, out } = scriptedInput({ stdout: ["hello world\n"], close: 0 }, { json: true });

    const code = await runOutputExec(input);

    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0] ?? "") as {
      sessionId: string;
      result: { childExitCode: number | null; chunkSetId?: string };
    };
    expect(parsed.sessionId).toBe(SESSION_ID);
    expect(parsed.result.childExitCode).toBe(0);
    expect(parsed.result.chunkSetId).toBe(NEW_ID);
  });

  // ---- child non-zero exit mirror --------------------------------------

  it("child exits 7 → process exit 7, success stdout written, note on stderr", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, out, err } = scriptedInput({ stdout: ["some output\n"], close: 7 });

    const code = await runOutputExec(input);

    expect(code).toBe(7);
    expect(out.length).toBeGreaterThan(0); // success summary still on stdout
    expect(out[0]).toContain("Ran pnpm test");
    expect(err.some((e) => e.includes("command exited 7"))).toBe(true);
  });

  it("child non-zero exit with --json → exit code mirrored, JSON still on stdout", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, out } = scriptedInput({ stdout: ["x\n"], close: 3 }, { json: true });

    const code = await runOutputExec(input);

    expect(code).toBe(3);
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0] ?? "") as { result: { childExitCode: number } };
    expect(parsed.result.childExitCode).toBe(3);
  });

  // ---- spawn error -----------------------------------------------------

  it("spawn error (ENOENT) → command_failed, exit 1, nothing on stdout", async () => {
    await seed(store, projectRoot);
    const { input, out, err } = scriptedInput({ error: "spawn nope ENOENT" });

    const code = await runOutputExec(input);

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("command_failed"))).toBe(true);
  });

  // ---- forced termination is exit 1 ------------------------------------

  it("max-bytes termination + --json → exit 1, NO success JSON on stdout", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, out, err } = scriptedInput(
      { stdout: ["0123456789abcdef"], close: null }, // 16 bytes breaches 8
      { maxBytes: 8, json: true },
    );

    const code = await runOutputExec(input);

    expect(code).toBe(1);
    // A failed run must NOT emit a success envelope. stdout stays empty even in
    // --json mode; machine consumers see only the non-zero exit + stderr line.
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("command_failed: terminated: max_bytes"))).toBe(true);
    // No stderr line is parseable JSON (proves no envelope leaked to stderr).
    for (const line of err) expect(() => JSON.parse(line)).toThrow();
  });

  it("max-bytes termination + text mode → exit 1, nothing on stdout", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const { input, out, err } = scriptedInput(
      { stdout: ["0123456789abcdef"], close: null },
      { maxBytes: 8 },
    );

    const code = await runOutputExec(input);

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("command_failed: terminated: max_bytes"))).toBe(true);
  });

  // ---- unexpected throw → exit 2 ---------------------------------------

  it("unexpected throw inside the adapter → exit 2, unexpected failure on stderr", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const err: string[] = [];
    // A stdout writer that throws AFTER a successful run forces an unexpected,
    // non-typed failure; the adapter's outer catch must map it to exit 2 with a
    // plain-text stderr line (§6).
    const { input } = scriptedInput(
      { stdout: ["data\n"], close: 0 },
      {
        stdout: () => {
          throw new Error("kaboom");
        },
        stderr: (l: string) => err.push(l),
      },
    );

    const code = await runOutputExec(input);

    expect(code).toBe(2);
    expect(err.some((e) => e.includes("unexpected failure"))).toBe(true);
  });
});

// citty merges the consumed sessionId positional and the post-`--` tokens into
// args._ as [sessionId, command, ...commandArgs]. These lock that the command
// is read from index 1, not 0 — reading 0 fed the session UUID to the policy
// gate and denied every real `mega output exec` as command_not_allowed.
describe("execCommandFromPositionals", () => {
  it("reads the command from index 1 (sessionId is index 0)", () => {
    const { command, commandArgs } = execCommandFromPositionals([SESSION_ID, "ls", "-la"]);
    expect(command).toBe("ls");
    expect(commandArgs).toEqual(["-la"]);
  });

  it("command with no extra args", () => {
    const { command, commandArgs } = execCommandFromPositionals([SESSION_ID, "pnpm"]);
    expect(command).toBe("pnpm");
    expect(commandArgs).toEqual([]);
  });

  it("missing command (only sessionId) yields empty command", () => {
    const { command, commandArgs } = execCommandFromPositionals([SESSION_ID]);
    expect(command).toBe("");
    expect(commandArgs).toEqual([]);
  });

  it("empty positionals yield empty command", () => {
    const { command, commandArgs } = execCommandFromPositionals([]);
    expect(command).toBe("");
    expect(commandArgs).toEqual([]);
  });
});
