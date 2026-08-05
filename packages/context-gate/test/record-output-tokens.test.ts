import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countTokens } from "@megasaver/output-filter";
import { readOverlayEvents } from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMPRESS_FLOOR_BYTES,
  ENCODING_LOAD_BUDGET_MS,
  recordAndFilterOverlayOutput,
} from "../src/record-output.js";

const LARGE_RAW = Array.from(
  { length: 200 },
  (_, i) => `line ${i}: sample code for token testing`,
).join("\n");

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "cg-tokens-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function runFixture(opts: {
  raw: string;
  countTokensImpl?: (text: string) => Promise<number | null>;
}) {
  const res = await recordAndFilterOverlayOutput({
    storeRoot: tempDir,
    workspaceKey: "wsk-test",
    liveSessionId: "sess-test",
    raw: opts.raw,
    sourceKind: "file",
    label: "test.ts",
    mode: "balanced",
    storeRawOutput: true,
    compressFloorBytes: COMPRESS_FLOOR_BYTES,
    ...(opts.countTokensImpl !== undefined ? { countTokensImpl: opts.countTokensImpl } : {}),
  });

  const events = readOverlayEvents({ root: tempDir }, "wsk-test", "sess-test");
  const event = events[events.length - 1];
  if (!event) throw new Error("no event recorded");

  return { res, event };
}

describe("record-output measured tokens", () => {
  it("keeps the load budget above the tokenizer's measured cold start", () => {
    // Cold-start first-call cost measured at 101-132 ms on 2026-08-01. That is
    // the lazy import, which is exactly what this budget bounds; a value at or
    // below it omits the fields on every spawned-hook invocation.
    expect(ENCODING_LOAD_BUDGET_MS).toBeGreaterThan(300);
  });

  it("carries measured token counts matching the tokenizer on the same text", async () => {
    const { event } = await runFixture({ raw: LARGE_RAW });

    expect(event.rawTokens).toBe(await countTokens(LARGE_RAW));
    expect(event.returnedTokens).toBeGreaterThan(0);
    expect(event.deltaTokens).toBe((event.rawTokens ?? 0) - (event.returnedTokens ?? 0));
    expect(event.tokenCountOutcome).toBeUndefined();
  });

  it("OMITS the token fields when the tokenizer fails — never bytes/4", async () => {
    const { event } = await runFixture({
      raw: LARGE_RAW,
      countTokensImpl: async () => {
        throw new Error("boom");
      },
    });

    expect(event.rawTokens).toBeUndefined();
    expect(event.returnedTokens).toBeUndefined();
    expect(event.deltaTokens).toBeUndefined();
    // A throw is a bug and must not read as a routine decline: swapping this
    // test's impl with the decline test's has to fail, or neither guards.
    expect(event.tokenCountOutcome).toBe("failed");
    // The rest of the row is intact — a tokenizer failure is not an event failure.
    expect(event.deltaBytes).toBeGreaterThan(0);
  });

  it("records store freshness", async () => {
    const { event } = await runFixture({ raw: LARGE_RAW });
    expect(typeof event.isFreshStore).toBe("boolean");
  });

  it("OMITS all three fields when the counter declines", async () => {
    const { event } = await runFixture({ raw: LARGE_RAW, countTokensImpl: async () => null });

    expect(event.rawTokens).toBeUndefined();
    expect(event.returnedTokens).toBeUndefined();
    expect(event.deltaTokens).toBeUndefined();
    expect(event.tokenCountOutcome).toBe("declined");
  });

  // The production shape: the large `raw` is over the work budget while the
  // small compressed `finalText` measures fine. A single-sided check writes
  // `rawTokens: null`, which event.ts rejects (it accepts undefined, not null),
  // so the store throws, the hook emits nothing, and the tool output is passed
  // through UNCOMPRESSED — worse than a lost row.
  it("OMITS all three fields when only the raw side declines", async () => {
    const { res, event } = await runFixture({
      raw: LARGE_RAW,
      countTokensImpl: async (text) => (text === LARGE_RAW ? null : 7),
    });

    expect(event.rawTokens).toBeUndefined();
    expect(event.returnedTokens).toBeUndefined();
    expect(event.deltaTokens).toBeUndefined();
    // The event was still written and the output still compressed.
    expect(event.deltaBytes).toBeGreaterThan(0);
    expect(res.decision).not.toBe("passthrough");
    expect(event.tokenCountOutcome).toBe("declined");
  });
});
