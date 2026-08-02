import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir as readTemporaryDirectory } from "node:os";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { workspaceKeySchema } from "@megasaver/shared";
import {
  type TaskKickoffEvent,
  appendTaskKickoffEvent,
  readTaskKickoffEvents,
  taskKickoffEventPath,
} from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type TaskKickoffProcessWorker,
  type TaskKickoffWorkerData,
  runTaskKickoffProcess,
} from "../../src/hooks/task-kickoff-process.js";
import {
  createTaskKickoffSessionClaim,
  hasTaskKickoffSessionClaim,
} from "../../src/hooks/task-kickoff-store.js";

const WORKSPACE_KEY = workspaceKeySchema.parse("1a2b3c4d5e6f7a8b");
const SESSION_ID = "delivery-session";
const ENVELOPE =
  '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"kickoff"}}';
const tmpdir = () => realpathSync(readTemporaryDirectory());
const require = createRequire(import.meta.url);
const FS_EXT_MODULE_PATH = require.resolve("fs-ext");
const DESCRIPTOR_LOCK_PROCESS = `
import { closeSync, openSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const [path, flockModulePath] = process.argv.slice(2);
const { flockSync } = require(flockModulePath);
const descriptor = openSync(path, "a+", 0o600);
flockSync(descriptor, "exnb");
process.stdout.write("locked\\n");
const keeper = setInterval(() => undefined, 1_000);
process.stdin.once("data", () => {
  clearInterval(keeper);
  closeSync(descriptor);
  process.exit(0);
});
`;
const EVENT: TaskKickoffEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceKey: WORKSPACE_KEY,
  sessionId: SESSION_ID,
  createdAt: "2026-08-01T10:00:00.000Z",
  tokenCount: 321,
};

let storeRoot: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-process-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

class ControlledWorker implements TaskKickoffProcessWorker {
  readonly posted: unknown[] = [];
  terminated = false;
  unrefed = false;
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly exitListeners = new Set<(exitCode: number) => void>();

  onMessage(listener: (message: unknown) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onExit(listener: (exitCode: number) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): Promise<number> {
    this.terminated = true;
    return new Promise(() => {});
  }

  unref(): void {
    this.unrefed = true;
  }

  emitMessage(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }

  emitError(error: Error): void {
    if (this.errorListeners.size === 0) throw error;
    for (const listener of this.errorListeners) listener(error);
  }

  emitExit(exitCode: number): void {
    for (const listener of this.exitListeners) listener(exitCode);
  }
}

class DeferredWritable extends Writable {
  readonly chunks: string[] = [];
  readonly started: Promise<void>;
  private notifyStarted!: () => void;
  private pendingCallback: ((error?: Error | null) => void) | undefined;

  constructor(highWaterMark?: number) {
    super(highWaterMark === undefined ? undefined : { highWaterMark });
    this.started = new Promise((resolve) => {
      this.notifyStarted = resolve;
    });
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    this.pendingCallback = callback;
    this.notifyStarted();
  }

  finishWrite(error?: Error): void {
    const callback = this.pendingCallback;
    if (callback === undefined) throw new Error("stdout write has not started");
    this.pendingCallback = undefined;
    callback(error);
  }
}

function payload(sessionId = SESSION_ID): Record<string, string> {
  return { prompt: "repair auth", cwd: "/workspace", session_id: sessionId };
}

function ready(worker: ControlledWorker): void {
  queueMicrotask(() => worker.emitMessage({ kind: "ready", envelope: ENVELOPE, event: EVENT }));
}

function processInput(worker: ControlledWorker, stdout: Writable, deadlineMs = 1_000) {
  return {
    payload: payload(),
    storeRoot,
    deadlineAtMs: Date.now() + Math.min(deadlineMs, 500),
    stdout,
    recordEvent: () => undefined,
    createWorker: (workerData: TaskKickoffWorkerData) => {
      expect(structuredClone(workerData)).toEqual(workerData);
      expect(Object.keys(workerData).sort()).toEqual(["deadlineAtMs", "payload", "storeRoot"]);
      expect(workerData.deadlineAtMs).toBeGreaterThan(Date.now());
      return worker;
    },
  };
}

function startDescriptorLock(path: string) {
  const script = join(storeRoot, "descriptor-lock-process.mjs");
  writeFileSync(script, DESCRIPTOR_LOCK_PROCESS);
  const child = spawn(process.execPath, [script, path, FS_EXT_MODULE_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const locked = new Promise<void>((resolve, reject) => {
    child.stdout.once("data", (chunk) =>
      String(chunk).includes("locked") ? resolve() : reject(new Error(String(chunk))),
    );
    child.once("error", reject);
  });
  return { child, locked };
}

describe("runTaskKickoffProcess", () => {
  it("returns at the parent deadline when worker preparation never completes", async () => {
    const worker = new ControlledWorker();
    const stdout = new DeferredWritable();
    const startedAt = performance.now();

    await expect(runTaskKickoffProcess(processInput(worker, stdout, 500))).resolves.toEqual({
      wrote: false,
    });
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeLessThan(550);
    expect(worker.terminated).toBe(true);
    expect(worker.unrefed).toBe(true);
    expect(stdout.chunks.join("")).toBe("");
    expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);
    expect(() => worker.emitError(new Error("late worker failure"))).not.toThrow();
  });

  it.skipIf(process.platform === "win32")(
    "keeps a claim terminal when the deadline terminates its worker before ready",
    async () => {
      const worker = new ControlledWorker();
      const stdout = new DeferredWritable();
      let claimCreated!: () => void;
      const created = new Promise<void>((resolve) => {
        claimCreated = resolve;
      });
      const sessionId = "claimed-before-ready";
      const result = runTaskKickoffProcess({
        ...processInput(worker, stdout, 100),
        payload: payload(sessionId),
        createWorker: (workerData) => {
          expect(structuredClone(workerData)).toEqual(workerData);
          queueMicrotask(async () => {
            const claimed = await createTaskKickoffSessionClaim(
              storeRoot,
              sessionId,
              {
                workspaceKey: WORKSPACE_KEY,
                eventId: EVENT.id,
                createdAt: EVENT.createdAt,
              },
              new AbortController().signal,
            );
            expect(claimed).toBe(true);
            claimCreated();
          });
          return worker;
        },
      });

      await created;
      expect(hasTaskKickoffSessionClaim(storeRoot, sessionId)).toBe(true);
      await expect(result).resolves.toEqual({ wrote: false });

      expect(hasTaskKickoffSessionClaim(storeRoot, sessionId)).toBe(true);
      expect(stdout.chunks.join("")).toBe("");
      expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);
    },
  );

  it("returns false for a queued pre-deadline write whose callback completes late", async () => {
    const worker = new ControlledWorker();
    const stdout = new DeferredWritable();
    ready(worker);

    const result = runTaskKickoffProcess(processInput(worker, stdout, 75));
    await stdout.started;
    await expect(result).resolves.toEqual({ wrote: false });

    expect(stdout.chunks.join("")).toBe(ENVELOPE);
    expect(worker.posted).toEqual([]);
    expect(worker.terminated).toBe(true);
    expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);
    stdout.finishWrite();
    await new Promise((resolve) => setImmediate(resolve));
    expect(worker.posted).toEqual([]);
    expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);
  });

  it("returns empty when the worker exits before exposing a ready envelope", async () => {
    const worker = new ControlledWorker();
    const stdout = new DeferredWritable();
    queueMicrotask(() => worker.emitExit(1));

    await expect(runTaskKickoffProcess(processInput(worker, stdout))).resolves.toEqual({
      wrote: false,
    });

    expect(stdout.chunks.join("")).toBe("");
    expect(worker.posted).toEqual([]);
    expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);
  });

  it("does not request accounting when the stdout callback reports failure", async () => {
    const worker = new ControlledWorker();
    const stdout = new DeferredWritable();
    ready(worker);

    const result = runTaskKickoffProcess(processInput(worker, stdout));
    await stdout.started;
    stdout.finishWrite(new Error("broken pipe"));

    await expect(result).resolves.toEqual({ wrote: false });
    expect(worker.posted).toEqual([]);
    expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);
  });

  it("does not request accounting when stdout.write throws synchronously", async () => {
    const worker = new ControlledWorker();
    const stdout = Object.assign(new Writable(), {
      write: () => {
        throw new Error("closed stdout");
      },
    });
    ready(worker);

    await expect(runTaskKickoffProcess(processInput(worker, stdout))).resolves.toEqual({
      wrote: false,
    });

    expect(worker.posted).toEqual([]);
    expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);
  });

  it("treats a duplicate ready while stdout is pending as a terminal protocol failure", async () => {
    const worker = new ControlledWorker();
    const stdout = new DeferredWritable();
    ready(worker);

    const result = runTaskKickoffProcess(processInput(worker, stdout));
    await stdout.started;
    worker.emitMessage({ kind: "ready", envelope: ENVELOPE, event: EVENT });
    stdout.finishWrite();

    await expect(result).resolves.toEqual({ wrote: true });
    expect(worker.posted).toEqual([]);
    expect(worker.terminated).toBe(true);
    expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);
  });

  it("returns after stdout succeeds while retaining the worker through the intent ACK", async () => {
    const worker = new ControlledWorker();
    const stdout = new DeferredWritable();
    ready(worker);

    const result = runTaskKickoffProcess(processInput(worker, stdout));
    await stdout.started;
    expect(stdout.chunks.join("")).toBe(ENVELOPE);
    expect(worker.posted).toEqual([]);
    expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);

    stdout.finishWrite();
    await expect(result).resolves.toEqual({ wrote: true });
    expect(worker.posted).toEqual([]);
    expect(worker.unrefed).toBe(false);
    expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);

    await new Promise((resolve) => setImmediate(resolve));
    expect(worker.posted).toEqual([{ kind: "record" }]);
    expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);
    expect(worker.unrefed).toBe(false);
    worker.emitMessage({ kind: "intentDone" });
    expect(worker.unrefed).toBe(true);
  });

  it("records a delivered event from the parent after settling stdout delivery", async () => {
    const worker = new ControlledWorker();
    const stdout = new DeferredWritable();
    const recorded: TaskKickoffEvent[] = [];
    ready(worker);

    const result = runTaskKickoffProcess({
      ...processInput(worker, stdout),
      recordEvent: (_storeRoot: string, event: TaskKickoffEvent) => recorded.push(event),
    } as never);
    await stdout.started;
    stdout.finishWrite();

    await expect(result).resolves.toEqual({ wrote: true });
    expect(recorded).toEqual([]);

    await new Promise((resolve) => setImmediate(resolve));
    expect(recorded).toEqual([EVENT]);
    expect(worker.posted).toEqual([{ kind: "record" }]);
  });

  it.skipIf(process.platform === "win32")(
    "stops a locked event append at the absolute Task Kickoff deadline",
    async () => {
      const worker = new ControlledWorker();
      const stdout = new DeferredWritable();
      const deadlineAtMs = Date.now() + 300;
      const eventPath = taskKickoffEventPath(storeRoot, WORKSPACE_KEY);
      mkdirSync(dirname(eventPath), { recursive: true });
      const lock = startDescriptorLock(eventPath);
      await lock.locked;
      ready(worker);
      const result = runTaskKickoffProcess({
        ...processInput(worker, stdout),
        deadlineAtMs,
        recordEvent: (root, event, deadline) =>
          appendTaskKickoffEvent({ root, deadlineAtMs: deadline }, event),
      });
      await stdout.started;
      while (Date.now() < deadlineAtMs - 50) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      const callbackAt = performance.now();
      stdout.finishWrite();

      await expect(result).resolves.toEqual({ wrote: true });
      await new Promise((resolve) => setTimeout(resolve, 70));
      expect(performance.now() - callbackAt).toBeLessThan(140);
      expect(worker.terminated).toBe(true);
      expect(worker.unrefed).toBe(true);
      expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);
      lock.child.kill();
    },
  );

  it("treats backpressure as delivered when the stdout callback succeeds", async () => {
    const worker = new ControlledWorker();
    const stdout = new DeferredWritable(1);
    ready(worker);

    const result = runTaskKickoffProcess(processInput(worker, stdout));
    await stdout.started;
    stdout.finishWrite();

    await expect(result).resolves.toEqual({ wrote: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(worker.posted).toEqual([{ kind: "record" }]);
    expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);
  });

  it("keeps a successful stdout write when posting the accounting request throws", async () => {
    const worker = new ControlledWorker();
    const stdout = new DeferredWritable();
    worker.postMessage = () => {
      throw new Error("worker already exited");
    };
    ready(worker);

    const result = runTaskKickoffProcess(processInput(worker, stdout));
    await stdout.started;
    stdout.finishWrite();

    await expect(result).resolves.toEqual({ wrote: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(worker.terminated).toBe(true);
    expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "keeps successful delivery when worker accounting refuses a stable event symlink",
    async () => {
      const worker = new ControlledWorker();
      const stdout = new DeferredWritable();
      const eventPath = join(storeRoot, "stats", WORKSPACE_KEY, "task-kickoff.jsonl");
      const outside = join(storeRoot, "outside.jsonl");
      writeFileSync(outside, "outside\n", { mode: 0o644 });
      mkdirSync(join(storeRoot, "stats", WORKSPACE_KEY), { recursive: true });
      symlinkSync(outside, eventPath);
      ready(worker);

      const result = runTaskKickoffProcess({
        ...processInput(worker, stdout),
        recordEvent: (root: string, event: TaskKickoffEvent) =>
          appendTaskKickoffEvent({ root }, event),
      } as never);
      await stdout.started;
      stdout.finishWrite();

      await expect(result).resolves.toEqual({ wrote: true });
      await new Promise((resolve) => setImmediate(resolve));
      expect(worker.posted).toEqual([{ kind: "record" }]);
      expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);
      expect(readFileSync(outside, "utf8")).toBe("outside\n");
      expect(statSync(outside).mode & 0o777).toBe(0o644);
    },
  );

  it("accepts a delivered envelope without fabricating an event after a worker crash", async () => {
    const worker = new ControlledWorker();
    const stdout = new DeferredWritable();
    worker.postMessage = (message: unknown) => {
      worker.posted.push(message);
      queueMicrotask(() => worker.emitExit(1));
    };
    ready(worker);

    const result = runTaskKickoffProcess(processInput(worker, stdout));
    await stdout.started;
    stdout.finishWrite();

    await expect(result).resolves.toEqual({ wrote: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(worker.posted).toEqual([{ kind: "record" }]);
    expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);
  });
});
import { spawn } from "node:child_process";
