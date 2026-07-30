import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOverlayEvents } from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";

const WK = "0123456789abcdef";
const SID = "11111111-1111-4111-8111-111111111111";
const RAW = Array.from({ length: 400 }, (_, i) => `line ${i} lorem ipsum dolor sit amet`).join(
  "\n",
);

let storeRoot: string;
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "ms-record-idem-"));
});
afterEach(() => rmSync(storeRoot, { recursive: true, force: true }));

function record(nowIso: string) {
  return recordAndFilterOverlayOutput({
    storeRoot,
    workspaceKey: WK,
    liveSessionId: SID,
    raw: RAW,
    sourceKind: "command",
    label: "run tests",
    mode: "aggressive",
    storeRawOutput: true,
    now: () => nowIso,
  });
}

describe("recordAndFilterOverlayOutput — B11 deterministic event identity", () => {
  it("two writers in the same creation bucket record ONE savings event", async () => {
    // The daemon-write-then-client-timeout race: same inputs, clocks seconds
    // apart — well inside one bucket.
    const r1 = await record("2026-07-31T12:00:00.000Z");
    const r2 = await record("2026-07-31T12:00:01.500Z");
    expect(r1.decision).toBe("compressed");
    expect(r2.decision).toBe("compressed");
    expect(readOverlayEvents({ root: storeRoot }, WK, SID)).toHaveLength(1);
  });

  it("a genuine later re-delivery of identical output still counts", async () => {
    // First-sight ledger failing open: the model really received the
    // compressed rendering twice, buckets apart — both are honest savings.
    const r1 = await record("2026-07-31T12:00:00.000Z");
    const r2 = await record("2026-07-31T13:00:00.000Z");
    expect(r1.decision).toBe("compressed");
    expect(r2.decision).toBe("compressed");
    expect(readOverlayEvents({ root: storeRoot }, WK, SID)).toHaveLength(2);
  });
});
