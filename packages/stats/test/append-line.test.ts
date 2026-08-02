import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const forcedWrite = vi.hoisted(() => ({ byteCount: 1, sequence: [] as Array<number | "throw"> }));

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    writeSync(
      descriptor: number,
      data: string | Uint8Array,
      offset?: number,
      length?: number,
      position?: number,
    ): number {
      const byteCount = forcedWrite.sequence.shift() ?? forcedWrite.byteCount;
      if (byteCount === "throw") throw new Error("forced write failure");
      if (byteCount <= 0) return byteCount;
      if (typeof data === "string") {
        return fs.writeSync(descriptor, Buffer.from(data).subarray(0, byteCount));
      }
      return fs.writeSync(
        descriptor,
        data,
        offset ?? 0,
        Math.min(length ?? data.byteLength - (offset ?? 0), byteCount),
        position,
      );
    },
  };
});

import { appendPrivateLine } from "../src/append-line.js";
import {
  readTaskKickoffEvents,
  taskKickoffEventPath,
  taskKickoffEventSchema,
} from "../src/task-kickoff-event.js";

const roots: string[] = [];
const WORKSPACE_KEY = "1a2b3c4d5e6f7a8b";
const APPEND_LINE_SOURCE_URL = new URL("../src/append-line.ts", import.meta.url).href;
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
const SHORT_WRITE_PROCESS = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const [moduleUrl, path, line, readyPath, startPath] = process.argv.slice(2);
fs.writeFileSync(readyPath, "");
while (!fs.existsSync(startPath)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
process.stdout.write("event-write\\n");
const originalWrite = fs.writeSync;
fs.writeSync = (descriptor, data, offset = 0, length, position) => {
  if (typeof data === "string") return originalWrite(descriptor, Buffer.from(data).subarray(0, 1));
  return originalWrite(descriptor, data, offset, Math.min(length ?? data.byteLength - offset, 1), position);
};
syncBuiltinESMExports();
const { appendPrivateLine } = await import(moduleUrl);
appendPrivateLine(path, line);
process.stdout.write("appended\\n");
`;

afterEach(() => {
  forcedWrite.byteCount = 1;
  forcedWrite.sequence = [];
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function kickoffEvent(id: string) {
  return taskKickoffEventSchema.parse({
    id,
    workspaceKey: WORKSPACE_KEY,
    sessionId: "session-1",
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

function runAppendProcess(
  script: string,
  args: string[],
): { exited: Promise<string>; process: ReturnType<typeof spawn> } {
  const child = spawn(process.execPath, ["--experimental-strip-types", script, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const exited = new Promise<string>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`append process exited ${code}: ${stderr}`));
    });
  });
  return { exited, process: child };
}

it("completes a JSONL append after a short filesystem write", () => {
  const root = mkdtempSync(`${tmpdir()}/megasaver-short-append-`);
  roots.push(root);
  const path = join(root, "events.jsonl");

  appendPrivateLine(path, '{"id":"event-1"}\n');

  expect(readFileSync(path, "utf8")).toBe('{"id":"event-1"}\n');
});

it.each([0, -1])("fails closed when the filesystem reports %i append progress", (byteCount) => {
  forcedWrite.byteCount = byteCount;
  const root = mkdtempSync(`${tmpdir()}/megasaver-stalled-append-`);
  roots.push(root);
  const path = join(root, "events.jsonl");

  expect(() => appendPrivateLine(path, '{"id":"event-1"}\n')).toThrow();
  expect(readFileSync(path, "utf8")).toBe("");
});

for (const [failure, sequence] of [
  ["no progress", [1, 0]],
  ["an exception", [1, "throw"]],
] as const) {
  it(`restores the prior JSONL tail after ${failure}`, () => {
    const root = mkdtempSync(`${tmpdir()}/megasaver-rollback-append-`);
    roots.push(root);
    const path = taskKickoffEventPath(root, WORKSPACE_KEY);
    const first = kickoffEvent("11111111-1111-4111-8111-111111111111");
    const failed = kickoffEvent("22222222-2222-4222-8222-222222222222");
    const second = kickoffEvent("33333333-3333-4333-8333-333333333333");
    appendPrivateLine(path, `${JSON.stringify(first)}\n`);

    forcedWrite.sequence = [...sequence];
    expect(() => appendPrivateLine(path, `${JSON.stringify(failed)}\n`)).toThrow();
    appendPrivateLine(path, `${JSON.stringify(second)}\n`);

    expect(readTaskKickoffEvents({ root }, WORKSPACE_KEY)).toEqual([first, second]);
  });
}

it("repairs a crashed JSONL tail before appending a valid event", () => {
  const root = mkdtempSync(`${tmpdir()}/megasaver-repair-append-`);
  roots.push(root);
  const path = taskKickoffEventPath(root, WORKSPACE_KEY);
  const first = kickoffEvent("11111111-1111-4111-8111-111111111111");
  const second = kickoffEvent("33333333-3333-4333-8333-333333333333");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(first)}\n{"crashed":`);

  appendPrivateLine(path, `${JSON.stringify(second)}\n`);

  expect(readTaskKickoffEvents({ root }, WORKSPACE_KEY)).toEqual([first, second]);
});

it.skipIf(process.platform === "win32")("ignores a FIFO at the former sidecar lock path", () => {
  const root = mkdtempSync(`${tmpdir()}/megasaver-sidecar-append-`);
  roots.push(root);
  const path = join(root, "events.jsonl");
  execFileSync("mkfifo", [`${path}.lock`]);

  appendPrivateLine(path, '{"id":"event-1"}\n');

  expect(readFileSync(path, "utf8")).toBe('{"id":"event-1"}\n');
  expect(existsSync(`${path}.lock`)).toBe(true);
});

it("keeps concurrent short writes as complete JSONL records", async () => {
  const root = mkdtempSync(`${tmpdir()}/megasaver-concurrent-append-`);
  roots.push(root);
  const path = join(root, "events.jsonl");
  const script = join(root, "short-write-process.mjs");
  writeFileSync(script, SHORT_WRITE_PROCESS);
  const startPath = join(root, "start");
  const lines = ['{"writer":"a"}\n', '{"writer":"b"}\n'];
  const writers = lines.map((line, id) =>
    runAppendProcess(script, [
      APPEND_LINE_SOURCE_URL,
      path,
      line,
      join(root, `ready-${id}`),
      startPath,
    ]),
  );

  await Promise.all(lines.map((_, id) => waitForPath(join(root, `ready-${id}`))));
  writeFileSync(startPath, "");
  const outputs = await Promise.all(writers.map(({ exited }) => exited));

  expect(['{"writer":"a"}\n{"writer":"b"}\n', '{"writer":"b"}\n{"writer":"a"}\n']).toContain(
    readFileSync(path, "utf8"),
  );
  expect(outputs.every((output) => output.includes("event-write\n"))).toBe(true);
}, 60_000);

it.skipIf(process.platform === "win32")(
  "releases a terminated child descriptor lock before the next append",
  async () => {
    const root = mkdtempSync(`${tmpdir()}/megasaver-worker-append-`);
    roots.push(root);
    const path = join(root, "events.jsonl");
    const script = join(root, "descriptor-lock-process.mjs");
    writeFileSync(script, DESCRIPTOR_LOCK_PROCESS);
    const lockHolder = runAppendProcess(script, [path, FS_EXT_MODULE_PATH]);
    await new Promise<void>((resolve, reject) => {
      lockHolder.process.stdout.once("data", (chunk) =>
        String(chunk).includes("locked") ? resolve() : reject(new Error(String(chunk))),
      );
      lockHolder.process.once("error", reject);
    });

    try {
      expect(() => appendPrivateLine(path, '{"writer":"parent"}\n')).toThrow();
    } finally {
      lockHolder.process.kill();
      await lockHolder.exited.catch(() => undefined);
    }
    appendPrivateLine(path, '{"writer":"after-termination"}\n');

    expect(readFileSync(path, "utf8")).toBe('{"writer":"after-termination"}\n');
  },
);
