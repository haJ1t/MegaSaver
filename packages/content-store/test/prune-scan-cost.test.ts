import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pruneOlderThan, saveOverlayChunkSet } from "../src/store.js";

// pruneOlderThan runs inside `mega hooks saver` (apps/cli/src/hooks/gc.ts:98,
// awaited by apps/cli/src/hooks/saver-run.ts:190), so its cost is charged to a
// real user tool call. Retention is 30 days with no byte cap, so each daily
// sweep looks at ~30 days of stored output to delete ~1/30 of it: the RETAINED
// files, not the deleted ones, are the sweep's workload.
//
// Reading a timestamp must therefore cost the same per file whether that file
// holds 4 KB of tool output or 512 KB. What it must NOT do is read and parse the
// body: measured through the built CLI hook on a real store, an empty store cost
// 351-369 ms per hook call, 300 sets (38 MB) 419-435 ms and 600 sets (75 MB)
// 476-506 ms, while a fresh .last-gc marker on the same 75 MB store returned to
// 336-360 ms — the delta is the prune scan, and it is linear in stored BYTES.
const FILES = 24;
const SMALL_BYTES = 4_096;
const LARGE_BYTES = 524_288; // 128x the bytes, same file count

// Why a growth RATIO across input SIZE and not a wall-clock ceiling: a ceiling
// is load- and runtime-dependent, and this defect is a constant factor on a
// scan that is fast in absolute terms on an idle runner. The ratio isolates the
// one thing that must not happen — cost tracking body size. A per-file-constant
// implementation stats each file and ignores its body, so 128x the bytes costs
// the same — measured 0.9-1.1x. Reading the bodies measured 76x on the same
// stores, so the threshold has ~25x of red margin and ~3x of green margin.
const MAX_GROWTH = 3;
const TRIALS = 5;

// Calibrated against the LARGE store, not the small one: it bounds total test
// time in BOTH directions. Calibrating on the cheap sample would make a
// body-reading implementation run the expensive sample hundreds of times.
const TARGET_SAMPLE_MS = 80;

const RETENTION_MS = 30 * 86_400_000;

const stores: string[] = [];
afterAll(() => {
  for (const store of stores) rmSync(store, { recursive: true, force: true });
});

// One 1 KB chunk per KB of output, mirroring the real chunker (record-output.ts
// builds chunks with chunkByLines). Body-parse cost scales with chunk COUNT as
// well as bytes, and a store of 1 KB chunks is what the saver actually writes.
async function seedStore(bytesPerSet: number): Promise<string> {
  const store = mkdtempSync(join(tmpdir(), "megasaver-prune-cost-"));
  stores.push(store);
  const createdAt = new Date().toISOString();
  const text = `${"x".repeat(127)}\n`.repeat(8);
  const chunkCount = Math.round(bytesPerSet / text.length);
  for (let i = 0; i < FILES; i += 1) {
    await saveOverlayChunkSet({
      storeRoot: store,
      chunkSet: {
        chunkSetId: `cs-${String(i).padStart(4, "0")}`,
        workspaceKey: "7da3a87ecc581dd6",
        liveSessionId: "11111111-1111-4111-8111-111111111111",
        createdAt,
        source: { kind: "command", command: "pnpm", args: ["verify"] },
        rawBytes: bytesPerSet,
        redacted: true,
        chunks: Array.from({ length: chunkCount }, (_, c) => ({
          id: String(c),
          startLine: c * 8 + 1,
          endLine: (c + 1) * 8,
          bytes: text.length,
          text,
        })),
      },
    });
  }
  return store;
}

// Every seeded set is young, so nothing is deleted and every repeat measures the
// same work — the retained-file scan the daily sweep actually spends its time on.
async function scan(store: string, repeats: number): Promise<number> {
  const started = performance.now();
  for (let i = 0; i < repeats; i += 1) {
    const { removed } = await pruneOlderThan({
      storeRoot: store,
      olderThan: new Date(Date.now() - RETENTION_MS),
    });
    if (removed !== 0) throw new Error(`prune deleted ${removed} young chunk sets`);
  }
  return performance.now() - started;
}

describe("pruneOlderThan — scan cost is per file, not per stored byte", () => {
  it(`grows under ${MAX_GROWTH}x when the same ${FILES} retained sets hold 128x the output`, async () => {
    const small = await seedStore(SMALL_BYTES);
    const large = await seedStore(LARGE_BYTES);

    await scan(large, 1); // warm up: keep JIT and page-cache cost out of the estimate
    const one = await scan(large, 1);
    const repeats = Math.max(1, Math.round(TARGET_SAMPLE_MS / Math.max(one, 0.05)));

    // min-of-trials, not mean: scheduler noise can only INFLATE a duration, so a
    // spike in the large sample inflates that trial's ratio and a spike in the
    // small sample deflates it. The minimum discards the inflated trials and can
    // only make the assertion harder to pass.
    let ratio = Number.POSITIVE_INFINITY;
    for (let trial = 0; trial < TRIALS; trial += 1) {
      ratio = Math.min(ratio, (await scan(large, repeats)) / (await scan(small, repeats)));
    }

    expect(ratio).toBeLessThan(MAX_GROWTH);
  });
});
