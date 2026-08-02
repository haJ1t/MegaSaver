import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, expect, it, vi } from "vitest";

const forcedWrite = vi.hoisted(() => ({ byteCount: 1 }));

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
      if (forcedWrite.byteCount <= 0) return forcedWrite.byteCount;
      if (typeof data === "string") {
        return fs.writeSync(descriptor, Buffer.from(data).subarray(0, forcedWrite.byteCount));
      }
      return fs.writeSync(
        descriptor,
        data,
        offset ?? 0,
        Math.min(length ?? data.byteLength - (offset ?? 0), forcedWrite.byteCount),
        position,
      );
    },
  };
});

import { appendPrivateLine } from "../src/append-line.js";

const roots: string[] = [];
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
fs.writeSync = (descriptor, data, offset = 0, length, position) => {
  if (Atomics.load(state, 0) !== workerData.id) {
    Atomics.wait(state, 0, 1 - workerData.id, 20);
  }
  const written =
    typeof data === "string"
      ? originalWrite(descriptor, Buffer.from(data).subarray(0, 1))
      : originalWrite(descriptor, data, offset, Math.min(length ?? data.byteLength - offset, 1), position);
  Atomics.store(state, 0, 1 - workerData.id);
  Atomics.notify(state, 0);
  return written;
};
syncBuiltinESMExports();
const { appendPrivateLine } = await import(workerData.moduleUrl);
appendPrivateLine(workerData.path, workerData.line);
parentPort.postMessage("appended");
`;

afterEach(() => {
  forcedWrite.byteCount = 1;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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

it("keeps concurrent short writes as complete JSONL records", async () => {
  const root = mkdtempSync(`${tmpdir()}/megasaver-concurrent-append-`);
  roots.push(root);
  const path = join(root, "events.jsonl");
  const workerPath = join(root, "short-write-worker.mjs");
  writeFileSync(workerPath, SHORT_WRITE_WORKER);
  const state = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
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
