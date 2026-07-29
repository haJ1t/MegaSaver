import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchChunk } from "../src/fetch-chunk.js";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";
import { OVERLAY_CHUNK_LINES } from "../src/recovery-footer.js";

// A3 (spec 2026-07-28-saver-compression-integrity §W3): recovery must be
// ADDRESSABLE, not merely present.
//
// A2 made every path store the whole output. That closes the "it exists
// nowhere" hole and leaves the other one: the delivered `… [lines X-Y omitted]`
// markers are numbered in post-collapse space, while the stored chunks index
// the raw output. The footer publishes only "~40 lines each, i = 0..N-1", so an
// agent reading a marker has no sound way to pick a chunk.
//
// Measured before this fix, on the fixture below: the marker read
// `… [lines 146-902 omitted]`; the only published rule resolved it to chunk 3,
// which holds raw lines 121-160 — unrelated noise. The correct chunk was ~23.
// The agent then probes, and compressed-view + N blind expansions cost more
// than the raw read would have.
//
// SHIPS RED.

const WK = "0123456789abcdef";
const LSID = "44444444-4444-4444-8444-444444444444";

// Every line is UNIQUE, and the first block still collapses. That combination is
// load-bearing: `collapseSimilar` folds a run whose timestamp-masked template
// matches, so 800 distinct timestamped lines become three, and collapsed line
// numbers diverge from raw line numbers by ~797.
//
// Uniqueness is what makes the assertion discriminating. An earlier version of
// this fixture used 800 copies of one noise line; `toContain` then succeeded
// against ANY chunk from the noise region and the test passed while the defect
// was fully present.
function driftingCorpus(): string {
  const lines: string[] = [];
  for (let i = 0; i < 800; i += 1) {
    const hh = String(10 + Math.floor(i / 3600)).padStart(2, "0");
    const mm = String(Math.floor(i / 60) % 60).padStart(2, "0");
    const ss = String(i % 60).padStart(2, "0");
    lines.push(`2026-07-28T${hh}:${mm}:${ss} heartbeat`);
  }
  for (let i = 0; i < 900; i += 1) {
    lines.push(`  at moduleLoader.require (/repo/src/pkg-${i}/loader-${i}.ts:${i}:1) payload ${i}`);
  }
  return lines.join("\n");
}

let store: string;
beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "cg-addr-"));
});
afterEach(async () => rm(store, { recursive: true, force: true }));

describe("recovery addressability", () => {
  it("every delivered gap marker names lines that resolve to the right chunk", async () => {
    const raw = driftingCorpus();
    const rawLines = raw.split("\n");
    const chunkSetId = "cs-addr";

    const result = await recordAndFilterOverlayOutput({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      raw,
      sourceKind: "command",
      label: "pnpm build",
      mode: "balanced",
      storeRawOutput: true,
      includeFooter: true,
      intent: "find the failing module",
      newId: () => chunkSetId,
    });
    expect(result.decision).toBe("compressed");

    const markers = [...result.returnedText.matchAll(/… \[lines (\d+)-(\d+) omitted\]/g)];
    expect(markers.length, "fixture must actually produce gap markers").toBeGreaterThan(0);

    // THE CONTRACT. Delivered line numbers and stored chunks must inhabit one
    // coordinate system, and the only sound one is the raw output's — that is
    // what the agent sees line numbers in, and what the chunks index.
    //
    // A local per-marker check cannot catch this. Resolving marker line N to
    // chunk floor((N-1)/L) and asking whether that chunk contains raw line N is
    // self-consistent under the WRONG mapping too: both sides apply the same
    // bad assumption, so it passes while the marker points at unrelated
    // content. What gives the divergence away is the extent — collapse folds
    // lines, so post-collapse numbering runs out early.
    const namedLines = markers.map((m) => Number(m[2]));
    expect(
      Math.max(...namedLines),
      "the highest line number the delivered text names must be the raw output's " +
        "last line; anything smaller means the markers are numbered in " +
        "post-collapse space while the chunks index the raw output",
    ).toBe(rawLines.length);

    for (const m of markers) {
      const start = Number(m[1]);
      expect(Number(m[2])).toBeLessThanOrEqual(rawLines.length);

      // The published rule: fixed-size chunks of OVERLAY_CHUNK_LINES lines, so
      // the chunk holding line N is floor((N-1)/L).
      const chunkId = String(Math.floor((start - 1) / OVERLAY_CHUNK_LINES));
      const res = await fetchChunk({ storeRoot: store, chunkSetId, chunkId });
      expect(res.ok, `chunk ${chunkId} for marker ${m[0]} must exist`).toBe(true);
      if (!res.ok) continue;

      expect(
        res.chunk.text,
        `marker ${m[0]} resolved to chunk ${chunkId}, which does not contain the line it names`,
      ).toContain(rawLines[start - 1]);
    }
  });
});
