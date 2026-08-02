import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/append-line.js", () => ({
  appendPrivateLine: () => {
    const error = new Error("fs-ext is unavailable") as NodeJS.ErrnoException;
    error.code = "MODULE_NOT_FOUND";
    throw error;
  },
}));

const {
  appendTaskKickoffEvent,
  appendTaskKickoffEventFallback,
  readTaskKickoffEvents,
  taskKickoffEventSchema,
} = await import("../src/task-kickoff-event.js");

const roots: string[] = [];
const WORKSPACE_KEY = "1a2b3c4d5e6f7a8b";
const TASK_KICKOFF_EVENT_MODULE_URL = new URL("../dist/index.js", import.meta.url).href;
const FALLBACK_APPEND_PROCESS = `
import { existsSync, writeFileSync } from "node:fs";

const [moduleUrl, root, encodedEvent, readyPath, startPath] = process.argv.slice(2);
writeFileSync(readyPath, "");
while (!existsSync(startPath)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
const { appendTaskKickoffEventFallback } = await import(moduleUrl);
appendTaskKickoffEventFallback({ root }, JSON.parse(encodedEvent));
`;

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function event(id: string, sessionId: string) {
  return taskKickoffEventSchema.parse({
    id,
    workspaceKey: WORKSPACE_KEY,
    sessionId,
    createdAt: "2026-08-01T10:00:00.000Z",
    tokenCount: 321,
  });
}

function waitForPath(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5_000;
    const poll = (): void => {
      if (existsSync(path)) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for ${path}`));
        return;
      }
      setTimeout(poll, 5);
    };
    poll();
  });
}

function runFallbackAppendProcess(script: string, args: string[]): Promise<void> {
  const child = spawn(process.execPath, ["--experimental-strip-types", script, ...args], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`fallback append process exited ${code}: ${stderr}`));
    });
  });
}

describe("TaskKickoffEvent native-free fallback", () => {
  it("publishes an immutable owner-only event part when descriptor locking is unavailable", () => {
    const root = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-fallback-"));
    roots.push(root);
    const delivered = event("11111111-1111-4111-8111-111111111111", "fallback-one");

    appendTaskKickoffEvent({ root }, delivered);

    const partPath = join(
      root,
      "stats",
      WORKSPACE_KEY,
      "task-kickoff-parts",
      delivered.id,
      "event.json",
    );
    expect(existsSync(partPath)).toBe(true);
    expect(lstatSync(partPath).isSymbolicLink()).toBe(false);
    expect(readFileSync(partPath, "utf8")).toBe(`${JSON.stringify(delivered)}\n`);
    expect(readTaskKickoffEvents({ root }, WORKSPACE_KEY)).toEqual([delivered]);
  });

  it("merges immutable fallback parts deterministically", () => {
    const root = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-fallback-"));
    roots.push(root);
    const first = event("11111111-1111-4111-8111-111111111111", "fallback-one");
    const second = event("22222222-2222-4222-8222-222222222222", "fallback-two");

    appendTaskKickoffEvent({ root }, second);
    appendTaskKickoffEvent({ root }, first);

    expect(readTaskKickoffEvents({ root }, WORKSPACE_KEY)).toEqual([first, second]);
  });

  it("retains concurrent native-free fallback parts", async () => {
    const root = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-fallback-"));
    roots.push(root);
    const script = join(root, "fallback-append-process.mjs");
    const startPath = join(root, "start");
    const first = event("11111111-1111-4111-8111-111111111111", "fallback-one");
    const second = event("22222222-2222-4222-8222-222222222222", "fallback-two");
    writeFileSync(script, FALLBACK_APPEND_PROCESS);
    const writers = [first, second].map((entry, index) =>
      runFallbackAppendProcess(script, [
        TASK_KICKOFF_EVENT_MODULE_URL,
        root,
        JSON.stringify(entry),
        join(root, `ready-${index}`),
        startPath,
      ]),
    );

    await Promise.all([waitForPath(join(root, "ready-0")), waitForPath(join(root, "ready-1"))]);
    writeFileSync(startPath, "");
    await Promise.all(writers);

    expect(readTaskKickoffEvents({ root }, WORKSPACE_KEY)).toEqual([first, second]);
  }, 60_000);

  it.skipIf(process.platform === "win32")(
    "refuses a stable symlink at the immutable parts root",
    () => {
      const root = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-fallback-"));
      roots.push(root);
      const delivered = event("11111111-1111-4111-8111-111111111111", "fallback-one");
      const partsPath = join(root, "stats", WORKSPACE_KEY, "task-kickoff-parts");
      const outside = join(root, "outside");
      mkdirSync(dirname(partsPath), { recursive: true });
      mkdirSync(outside);
      symlinkSync(outside, partsPath, "dir");

      expect(() => appendTaskKickoffEvent({ root }, delivered)).toThrow();
      expect(existsSync(join(outside, delivered.id, "event.json"))).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a stable symlink at an immutable event-part directory",
    () => {
      const root = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-fallback-"));
      roots.push(root);
      const delivered = event("11111111-1111-4111-8111-111111111111", "fallback-one");
      const partsPath = join(root, "stats", WORKSPACE_KEY, "task-kickoff-parts");
      const outside = join(root, "outside");
      mkdirSync(partsPath, { recursive: true });
      mkdirSync(outside);
      symlinkSync(outside, join(partsPath, delivered.id), "dir");

      expect(() => appendTaskKickoffEvent({ root }, delivered)).toThrow();
      expect(existsSync(join(outside, "event.json"))).toBe(false);
    },
  );

  it("does not publish a fallback part after the Task Kickoff deadline", () => {
    const root = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-fallback-"));
    roots.push(root);
    const delivered = event("11111111-1111-4111-8111-111111111111", "fallback-one");

    expect(() => appendTaskKickoffEvent({ root, deadlineAtMs: 1 }, delivered)).toThrow(
      "task kickoff event deadline expired",
    );
    expect(readTaskKickoffEvents({ root }, WORKSPACE_KEY)).toEqual([]);
  });

  it("does not publish a fallback part when its deadline expires during preparation", () => {
    const root = mkdtempSync(join(tmpdir(), "megasaver-task-kickoff-fallback-"));
    roots.push(root);
    const delivered = event("11111111-1111-4111-8111-111111111111", "fallback-one");
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(100);

    expect(() => appendTaskKickoffEvent({ root, deadlineAtMs: 50 }, delivered)).toThrow(
      "task kickoff event deadline expired",
    );
    const eventRoot = join(root, "stats", WORKSPACE_KEY, "task-kickoff-parts", delivered.id);
    expect(existsSync(join(eventRoot, "event.json"))).toBe(false);
    expect(existsSync(join(eventRoot, ".event.json.tmp"))).toBe(false);
  });
});
