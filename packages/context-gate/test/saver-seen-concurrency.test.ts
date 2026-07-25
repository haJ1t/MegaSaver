import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasSeenOutput, hashToolOutput } from "../src/saver-seen.js";

// Real OS processes, because that is the real defect: Claude Code spawns one
// `mega hooks saver` process per tool result, and every tool result of one
// assistant turn shares a sessionId — hence one ledger file. An in-process mock
// of the interleaving would prove nothing about a read-modify-write that only
// races across processes.
//
// The assertion is the lost-update property itself, not a survivor count: each
// writer reports back only the records it SAW land, and none of those may be
// missing at the end. A hash that a writer never got to write (withFileLock is
// best-effort and skips past its deadline under contention — the pre-existing
// fail-open) is therefore not counted against the ledger, so machine load can
// make this test slower but never wrong.

const SEEN_SRC = resolve(import.meta.dirname, "../src/saver-seen.ts");

// The barrier SLEEPS (Atomics.wait) rather than spinning: withFileLock busy-waits
// with no backoff, so a spinning barrier would starve the lock holder on a loaded
// box and skew what the run measures.
const WORKER = `
const [, , modulePath, store, wk, sid, prefix, rounds, startAt, spacing] = process.argv;
const { recordSeenOutput, hasSeenOutput, hashToolOutput } = await import(modulePath);
const clock = new Int32Array(new SharedArrayBuffer(4));
const landed = [];
for (let r = 0; r < Number(rounds); r++) {
  const waitMs = Number(startAt) + r * Number(spacing) - Date.now();
  if (waitMs > 0) Atomics.wait(clock, 0, 0, waitMs);
  const content = prefix + "-" + r;
  recordSeenOutput(store, wk, sid, hashToolOutput(content));
  if (hasSeenOutput(store, wk, sid, hashToolOutput(content))) landed.push(content);
}
process.stdout.write(JSON.stringify(landed));
`;

const WRITERS = 4;
const ROUNDS = 24;
const SPACING_MS = 25;
const WK = "wk1";
const SID = "sess-race";

let store: string;
let workerPath: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-seen-race-"));
  workerPath = join(store, "writer.mjs");
  writeFileSync(workerPath, WORKER);
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

function runWriter(prefix: string, startAt: number): Promise<string[]> {
  return new Promise((ok, fail) => {
    const child = spawn(
      process.execPath,
      [
        workerPath,
        pathToFileURL(SEEN_SRC).href,
        store,
        WK,
        SID,
        prefix,
        String(ROUNDS),
        String(startAt),
        String(SPACING_MS),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0
        ? ok(JSON.parse(stdout) as string[])
        : fail(new Error(`writer ${prefix} exited ${code}: ${stderr}`)),
    );
  });
}

describe("saver seen-hash ledger under parallel same-session hooks", () => {
  it("never drops a hash another process already landed in the same session", async () => {
    const startAt = Date.now() + 1_000; // covers process boot + module load
    const prefixes = Array.from({ length: WRITERS }, (_, w) => `w${w}`);
    const landed = (await Promise.all(prefixes.map((p) => runWriter(p, startAt)))).flat();

    // Guard against a vacuous pass: the run must actually have written a ledger.
    expect(landed.length).toBeGreaterThan((WRITERS * ROUNDS) / 2);
    expect(landed.length).toBeLessThanOrEqual(WRITERS * ROUNDS); // stays under the 500 FIFO cap

    const lost = landed.filter(
      (content) => !hasSeenOutput(store, WK, SID, hashToolOutput(content)),
    );
    expect(lost).toEqual([]);
  });
});
