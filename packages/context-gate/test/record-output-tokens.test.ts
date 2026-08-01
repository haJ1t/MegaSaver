import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countTokens } from "@megasaver/output-filter";
import { readOverlayEvents } from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMPRESS_FLOOR_BYTES,
  TOKEN_COUNT_BUDGET_MS,
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
  countTokensImpl?: (text: string) => Promise<number>;
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
  it("keeps the budget above the tokenizer's measured cold start", () => {
    // Cold-start first-call cost measured at 101-132 ms on 2026-08-01. A budget
    // at or below that omits the token fields on every spawned-hook invocation.
    expect(TOKEN_COUNT_BUDGET_MS).toBeGreaterThan(300);
  });

  it("carries measured token counts matching the tokenizer on the same text", async () => {
    const { event } = await runFixture({ raw: LARGE_RAW });

    expect(event.rawTokens).toBe(await countTokens(LARGE_RAW));
    expect(event.returnedTokens).toBeGreaterThan(0);
    expect(event.deltaTokens).toBe((event.rawTokens ?? 0) - (event.returnedTokens ?? 0));
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
    // The rest of the row is intact — a tokenizer failure is not an event failure.
    expect(event.deltaBytes).toBeGreaterThan(0);
  });

  it("records store freshness", async () => {
    const { event } = await runFixture({ raw: LARGE_RAW });
    expect(typeof event.isFreshStore).toBe("boolean");
  });
});
