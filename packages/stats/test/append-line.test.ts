import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
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
const SHORT_WRITE_WORKER = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

const originalWrite = fs.writeSync;
const state = new Int32Array(workerData.state);
Atomics.add(state, 1, 1);
Atomics.notify(state, 1);
while (Atomics.load(state, 1) < 2) Atomics.wait(state, 1, 1, 1000);
let participates = false;
let coordinated = false;
fs.writeSync = (descriptor, data, offset = 0, length, position) => {
  if (!participates) {
    participates = true;
    Atomics.add(state, 2, 1);
    Atomics.notify(state, 2);
    const deadline = Date.now() + 100;
    while (Atomics.load(state, 2) < 2 && Date.now() < deadline) {
      Atomics.wait(state, 2, 1, deadline - Date.now());
    }
    coordinated = Atomics.load(state, 2) === 2;
  }
  if (coordinated) {
    while (Atomics.load(state, 0) !== workerData.id) {
      Atomics.wait(state, 0, 1 - workerData.id);
    }
  }
  const written =
    typeof data === "string"
      ? originalWrite(descriptor, Buffer.from(data).subarray(0, 1))
      : originalWrite(descriptor, data, offset, Math.min(length ?? data.byteLength - offset, 1), position);
  if (coordinated) {
    Atomics.store(state, 0, 1 - workerData.id);
    Atomics.notify(state, 0);
  }
  return written;
};
syncBuiltinESMExports();
const { appendPrivateLine } = await import(workerData.moduleUrl);
try {
  appendPrivateLine(workerData.path, workerData.line);
  parentPort.postMessage("appended");
} finally {
  if (participates) Atomics.sub(state, 2, 1);
}
`;
const LIVE_WRITER_WORKER = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

const originalWrite = fs.writeSync;
fs.writeSync = (...args) => {
  parentPort.postMessage("writing");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700);
  return originalWrite(...args);
};
syncBuiltinESMExports();
const { appendPrivateLine } = await import(workerData.moduleUrl);
appendPrivateLine(workerData.path, workerData.line);
parentPort.postMessage("appended");
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

it("keeps concurrent short writes as complete JSONL records", async () => {
  const root = mkdtempSync(`${tmpdir()}/megasaver-concurrent-append-`);
  roots.push(root);
  const path = join(root, "events.jsonl");
  const workerPath = join(root, "short-write-worker.mjs");
  writeFileSync(workerPath, SHORT_WRITE_WORKER);
  const state = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 3);
  const lines = ['{"writer":"a"}\n', '{"writer":"b"}\n'];

  await Promise.all(
    lines.map(
      (line, id) =>
        new Promise<void>((resolve, reject) => {
          const worker = new Worker(pathToFileURL(workerPath), {
            execArgv: ["--experimental-strip-types", "--no-warnings=ExperimentalWarning"],
            workerData: { id, line, moduleUrl: APPEND_LINE_SOURCE_URL, path, state },
          });
          worker.once("message", () => resolve());
          worker.once("error", reject);
          worker.once("exit", (code) => {
            if (code !== 0) reject(new Error(`short-write worker exited ${code}`));
          });
        }),
    ),
  );

  expect(['{"writer":"a"}\n{"writer":"b"}\n', '{"writer":"b"}\n{"writer":"a"}\n']).toContain(
    readFileSync(path, "utf8"),
  );
}, 60_000);

it("does not evict a live append lock with an old mtime", async () => {
  const root = mkdtempSync(`${tmpdir()}/megasaver-live-append-`);
  roots.push(root);
  const path = join(root, "events.jsonl");
  const workerPath = join(root, "live-writer.mjs");
  writeFileSync(workerPath, LIVE_WRITER_WORKER);
  const worker = new Worker(pathToFileURL(workerPath), {
    execArgv: ["--experimental-strip-types", "--no-warnings=ExperimentalWarning"],
    workerData: { line: '{"writer":"child"}\n', moduleUrl: APPEND_LINE_SOURCE_URL, path },
  });
  const writing = new Promise<void>((resolve, reject) => {
    worker.once("message", (message) => (message === "writing" ? resolve() : reject(message)));
    worker.once("error", reject);
  });
  const appended = new Promise<void>((resolve, reject) => {
    worker.on("message", (message) => {
      if (message === "appended") resolve();
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`live writer exited ${code}`));
    });
  });

  await writing;
  const lockPath = `${path}.lock`;
  expect(existsSync(lockPath)).toBe(true);
  const old = new Date(0);
  utimesSync(lockPath, old, old);
  try {
    expect(() => appendPrivateLine(path, '{"writer":"parent"}\n')).toThrow();
  } finally {
    await appended;
  }

  expect(readFileSync(path, "utf8")).toBe('{"writer":"child"}\n');
}, 60_000);

it("reclaims an append lock held by a dead process", () => {
  const root = mkdtempSync(`${tmpdir()}/megasaver-dead-append-`);
  roots.push(root);
  const path = join(root, "events.jsonl");
  writeFileSync(`${path}.lock`, "99999999\n");

  appendPrivateLine(path, '{"writer":"live"}\n');

  expect(readFileSync(path, "utf8")).toBe('{"writer":"live"}\n');
});
