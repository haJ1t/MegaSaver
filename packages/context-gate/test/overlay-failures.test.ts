import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_OVERLAY_FAILURES,
  type OverlayFailureRecord,
  appendOverlayFailure,
  buildOverlayHints,
  readOverlayFailures,
} from "../src/overlay-failures.js";

const WK = "0123456789abcdef";
const LSID = "22222222-2222-4222-8222-222222222222";

function record(overrides: Partial<OverlayFailureRecord> = {}): OverlayFailureRecord {
  return {
    command: "pnpm test",
    errorOutput: "error TS2322: Type 'string' is not assignable at src/x.ts:42",
    source: "proxy-classifier",
    createdAt: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("overlay failure store", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-overlay-failures-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("append then read round-trips under failures/<wk>/<lsid>.jsonl", async () => {
    appendOverlayFailure(store, WK, LSID, record());
    const raw = await readFile(join(store, "failures", WK, `${LSID}.jsonl`), "utf8");
    expect(raw.trimEnd().split("\n")).toHaveLength(1);
    expect(readOverlayFailures(store, WK, LSID)).toEqual([record()]);
  });

  it("reading a missing store returns []", () => {
    expect(readOverlayFailures(store, WK, LSID)).toEqual([]);
  });

  it("trims to the newest MAX_OVERLAY_FAILURES on append", () => {
    for (let i = 0; i < MAX_OVERLAY_FAILURES + 5; i++) {
      appendOverlayFailure(store, WK, LSID, record({ command: `cmd-${i}` }));
    }
    const read = readOverlayFailures(store, WK, LSID);
    expect(read).toHaveLength(MAX_OVERLAY_FAILURES);
    expect(read[0]?.command).toBe("cmd-5");
    expect(read.at(-1)?.command).toBe(`cmd-${MAX_OVERLAY_FAILURES + 4}`);
  });

  it("skips corrupt and mis-shaped lines on read", async () => {
    const dir = join(store, "failures", WK);
    await mkdir(dir, { recursive: true });
    const lines = [
      JSON.stringify(record()),
      "not json {{{",
      JSON.stringify({ command: "x", source: "proxy-classifier", createdAt: "t" }),
      JSON.stringify(record({ command: "second" })),
    ];
    await writeFile(join(dir, `${LSID}.jsonl`), `${lines.join("\n")}\n`);
    const read = readOverlayFailures(store, WK, LSID);
    expect(read).toHaveLength(2);
    expect(read[1]?.command).toBe("second");
  });

  it.each([
    ["../evil", LSID],
    [WK, "a/b"],
    ["", LSID],
  ])("rejects unsafe segments (%s, %s)", (wk, lsid) => {
    // Shared guard from @megasaver/content-store — same message as chunk paths.
    expect(() => appendOverlayFailure(store, wk, lsid, record())).toThrow(
      /Unsafe chunkSetId segment/,
    );
    expect(() => readOverlayFailures(store, wk, lsid)).toThrow(/Unsafe chunkSetId segment/);
  });
});

describe("buildOverlayHints", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-overlay-hints-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("distills stored failures into recentFailures signatures", () => {
    appendOverlayFailure(store, WK, LSID, record());
    const hints = buildOverlayHints(store, WK, LSID);
    expect(hints.recentFailures).toEqual(
      expect.arrayContaining(["TS2322", "src/x.ts:42", "src/x.ts"]),
    );
  });

  it("missing store yields empty recentFailures", () => {
    expect(buildOverlayHints(store, WK, LSID)).toEqual({ recentFailures: [] });
  });

  it("keeps the 12 newest signatures when stored failures overflow the cap", () => {
    for (let i = 0; i < 13; i++) {
      appendOverlayFailure(
        store,
        WK,
        LSID,
        record({ errorOutput: `error in src/f${String(i).padStart(2, "0")}.ts` }),
      );
    }

    const hints = buildOverlayHints(store, WK, LSID);

    expect(hints.recentFailures).toHaveLength(12);
    expect(hints.recentFailures).toContain("src/f12.ts");
    expect(hints.recentFailures).not.toContain("src/f00.ts");
  });
});
