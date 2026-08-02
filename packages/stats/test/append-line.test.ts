import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
