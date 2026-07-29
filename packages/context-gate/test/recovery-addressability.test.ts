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
// markers were numbered in post-collapse space while the stored chunks index
// the raw output. The footer publishes only "~40 lines each, i = 0..N-1", so an
// agent reading a marker had no sound way to pick a chunk.
//
// Measured before the fix, on the fixture below: the marker read
// `… [lines 165-1700 omitted]`; the only published rule resolved it to chunk 4,
// which holds raw lines 161-200 — unrelated heartbeat noise. The correct marker
// is `… [lines 962-1700 omitted]`, chunk 24. The agent then probes, and
// compressed-view + N blind expansions cost more than the raw read would have.
//
// WHAT HAS BITE, AND WHAT DOES NOT. The obvious per-marker check — resolve a
// marker's line N to chunk floor((N-1)/L) and assert that chunk contains raw
// line N — is a tautology. `recoverableChunks` cuts the raw output into fixed
// L-line slices, so chunk floor((N-1)/L) contains raw line N BY CONSTRUCTION,
// for every N in range. It holds for any marker value whatsoever. So is the
// extent check `max(named) === rawLines.length`: the tail marker's total is
// read straight off `rawLineCount` no matter which space its `cursor` is in,
// so it can only catch a wrong TOTAL, never a wrong interior span.
//
// The discriminating property is that a marker must name exactly the gap it
// sits in. Two independent forms of that, both asserted below:
//   * ADJACENCY — the delivered line immediately before a marker is raw line
//     start-1, and the one immediately after is raw line end+1.
//   * DISJOINTNESS — no line a marker calls omitted is present verbatim in the
//     delivered text.
// A marker naming the wrong span fails these even when its extent is right.

const WK = "0123456789abcdef";
const LSID = "44444444-4444-4444-8444-444444444444";

// Every line is UNIQUE, and the first block still collapses. That combination is
// load-bearing: `collapseSimilar` folds a run whose timestamp-masked template
// matches, so 800 distinct timestamped lines become one synthesized line, and
// collapsed line numbers diverge from raw line numbers by ~797.
//
// Uniqueness is what lets the assertions map a delivered line back to its one
// raw index. An earlier version of this fixture used 800 copies of one noise
// line; `toContain` then succeeded against ANY chunk from the noise region and
// the test passed while the defect was fully present.
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

// A SECOND fixture, for a failure the first one structurally cannot express.
//
// The first fixture delivers exactly ONE run of verbatim raw lines (raw
// 801-961), so every gap marker it produces sits at an edge of that single run.
// Suppress an interior marker there and the only assertion that reacts is the
// anti-vacuity counter, which reports a change of SHAPE — it never says a line
// was spliced. That is the M6d residual.
//
// Here the intent term is planted in one 40-line block out of every eight, so
// the fit step keeps several NON-ADJACENT blocks and the delivered text is
// three verbatim runs with real holes between them. Now a suppressed marker has
// an observable consequence: two lines that are 280 apart in the raw output
// become neighbours in the delivered text.
//
// Deliberately free of any collapse run — no repeated line, and every line
// carries a `file.ts:line:col` position, which normalize's POSITION guard
// exempts from similarity folding. A collapse stand-in (`… [N similar: …]`) is
// itself a legitimate in-band account of a discontinuity, so its presence would
// force the walk below to carry an exemption; without one the walk is
// unconditional. Coordinate-space divergence is the FIRST fixture's job, and
// suppression is independent of which space the numbers live in.
function splicedCorpus(): string {
  const lines: string[] = [];
  for (let i = 0; i < 1600; i += 1) {
    const intentBlock = Math.floor(i / OVERLAY_CHUNK_LINES) % 8 === 1;
    lines.push(
      intentBlock
        ? `  at parseConfig (/repo/src/pkg-${i}/config-${i}.ts:${i}:7) payload ${i}`
        : `  at moduleLoader.require (/repo/src/pkg-${i}/loader-${i}.ts:${i}:1) payload ${i}`,
    );
  }
  return lines.join("\n");
}

const GAP_MARKER = /^… \[lines (\d+)-(\d+) omitted\]$/;
// normalize.ts's two collapse stand-ins. Asserted ABSENT from the second
// fixture's delivery — see splicedCorpus.
const COLLAPSE_STAND_IN = /^… \[(?:repeated \d+ times|\d+ similar: )/;

let store: string;
beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "cg-addr-"));
});
afterEach(async () => rm(store, { recursive: true, force: true }));

describe("recovery addressability", () => {
  it("every delivered gap marker names exactly the raw lines it stands in for", async () => {
    const raw = driftingCorpus();
    const rawLines = raw.split("\n");
    const chunkSetId = "cs-addr";

    // Enforced, not merely documented: a duplicate raw line would silently
    // collapse the text->index map below and weaken every assertion in this
    // test to a tautology, which is the exact way its predecessor rotted.
    expect(new Set(rawLines).size, "fixture raw lines must be unique").toBe(rawLines.length);

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

    const deliveredLines = result.returnedText.split("\n");
    const rawIndexOfLine = new Map(rawLines.map((line, i) => [line, i + 1]));
    // Position-preserving: rawIndexAt[i] is the raw line number of delivered
    // line i, or undefined when that line is synthesized (the summary, a
    // collapse stand-in, a gap marker, the footer).
    const rawIndexAt = deliveredLines.map((line) => rawIndexOfLine.get(line));
    const deliveredRawLines = new Set(rawIndexAt.filter((n): n is number => n !== undefined));

    const markers = deliveredLines.flatMap((line, at) => {
      const m = GAP_MARKER.exec(line);
      return m === null ? [] : [{ at, text: line, start: Number(m[1]), end: Number(m[2]) }];
    });
    expect(markers.length, "fixture must actually produce gap markers").toBeGreaterThan(0);
    expect(
      deliveredRawLines.size,
      "fixture must deliver raw lines verbatim, or disjointness is vacuous",
    ).toBeGreaterThan(0);

    // EXTENT — weak on its own (see header), but it is the only check that
    // reaches the tail marker's total, and it runs first so a lost tail marker
    // reports as a wrong total rather than as a starved adjacency loop.
    expect(
      Math.max(...markers.map((m) => m.end)),
      "the highest line number the delivered text names must be the raw output's last line",
    ).toBe(rawLines.length);

    // ADJACENCY — the primary contract. A marker sits between two delivered
    // neighbours; the span it names must be exactly the hole between them.
    // Wrong-space numbering puts the named span somewhere else entirely, and an
    // off-by-one puts it one line off, both with the extent still intact.
    let adjacencyChecks = 0;
    for (const marker of markers) {
      const before = rawIndexAt[marker.at - 1];
      if (before !== undefined) {
        adjacencyChecks += 1;
        expect(
          marker.start,
          `${marker.text} follows raw line ${before}, so the gap it names must open at ` +
            `${before + 1} (chunk ${Math.floor(before / OVERLAY_CHUNK_LINES)}); it names ` +
            `${marker.start} (chunk ${Math.floor((marker.start - 1) / OVERLAY_CHUNK_LINES)})`,
        ).toBe(before + 1);
      }
      const after = rawIndexAt[marker.at + 1];
      if (after !== undefined) {
        adjacencyChecks += 1;
        expect(
          marker.end,
          `${marker.text} is followed by raw line ${after}, so the gap it names must ` +
            `close at ${after - 1}`,
        ).toBe(after - 1);
      }
    }
    // Neighbours that are themselves synthesized are skipped above, so a
    // fixture drift could leave the loop asserting nothing at all.
    expect(adjacencyChecks, "adjacency must be exercised, not skipped away").toBeGreaterThanOrEqual(
      2,
    );

    // DISJOINTNESS — a marker claims its span is NOT in the delivered text. If
    // any named line is sitting right there, the marker is lying about which
    // lines the agent still has to fetch.
    for (const marker of markers) {
      const alsoDelivered = [...deliveredRawLines]
        .filter((n) => n >= marker.start && n <= marker.end)
        .slice(0, 3);
      expect(
        alsoDelivered,
        `${marker.text} calls lines omitted that the delivered text still contains ` +
          `verbatim (raw ${alsoDelivered.join(", ")}) — the marker is numbered in a ` +
          `different space from the ${rawLines.length}-line one the agent reads them in`,
      ).toEqual([]);
    }

    // FETCH — following the published rule on a marker must hand back content
    // the model does not already have. `toContain` here is true by
    // construction; the bite is the two assertions around it.
    for (const marker of markers) {
      expect(marker.end).toBeLessThanOrEqual(rawLines.length);
      const firstOmitted = rawLines[marker.start - 1];
      expect(
        deliveredLines,
        `${marker.text} names raw line ${marker.start} as omitted, but it was delivered`,
      ).not.toContain(firstOmitted);

      const chunkId = String(Math.floor((marker.start - 1) / OVERLAY_CHUNK_LINES));
      const res = await fetchChunk({ storeRoot: store, chunkSetId, chunkId });
      expect(res.ok, `chunk ${chunkId} for ${marker.text} must exist`).toBe(true);
      if (!res.ok) continue;
      expect(res.chunk.text).toContain(firstOmitted);

      const recovered = res.chunk.text.split("\n").filter((l) => !deliveredLines.includes(l));
      expect(
        recovered.length,
        `chunk ${chunkId} for ${marker.text} recovers nothing the model was not already handed`,
      ).toBeGreaterThan(0);
    }
  });

  it("accounts for every discontinuity between delivered excerpts with a marker", async () => {
    const raw = splicedCorpus();
    const rawLines = raw.split("\n");
    expect(new Set(rawLines).size, "fixture raw lines must be unique").toBe(rawLines.length);

    const result = await recordAndFilterOverlayOutput({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      raw,
      sourceKind: "command",
      label: "pnpm test",
      mode: "balanced",
      storeRawOutput: true,
      includeFooter: true,
      intent: "parseConfig",
      newId: () => "cs-splice",
    });
    expect(result.decision).toBe("compressed");

    const deliveredLines = result.returnedText.split("\n");
    const rawIndexOfLine = new Map(rawLines.map((line, i) => [line, i + 1]));
    expect(
      deliveredLines.filter((line) => COLLAPSE_STAND_IN.test(line)),
      "this fixture must fold nothing — a stand-in accounts for a discontinuity " +
        "without a marker, and the walk below deliberately models no such exemption",
    ).toEqual([]);

    // Positions holding verbatim raw content, in delivery order, bracketed by
    // two sentinels: raw line 0 before the text starts and raw line
    // rawLines.length + 1 after it ends. The sentinels turn "the excerpts are
    // separated by markers" into the stronger "the delivered text accounts for
    // all rawLines.length lines", which reaches the leading and tail gaps too.
    const anchors = [
      { at: -1, raw: 0 },
      ...deliveredLines.flatMap((line, at) => {
        const n = rawIndexOfLine.get(line);
        return n === undefined ? [] : [{ at, raw: n }];
      }),
      { at: deliveredLines.length, raw: rawLines.length + 1 },
    ];

    // CONTINUITY — the contract the marker mechanism exists for. Excerpts are
    // spliced end to end; a marker is the ONLY thing telling the reader that
    // two neighbouring lines were not neighbours in the raw output. Where a
    // marker is missing there is no wrong number to catch and no shape to
    // notice — the delivered text simply reads as continuous code that never
    // existed. Each hole between consecutive anchors must therefore be named,
    // exactly once and to the line.
    let interiorGaps = 0;
    for (let k = 1; k < anchors.length; k += 1) {
      const prev = anchors[k - 1] as { at: number; raw: number };
      const next = anchors[k] as { at: number; raw: number };
      if (next.raw === prev.raw + 1) continue;

      const between = deliveredLines.slice(prev.at + 1, next.at);
      const named = between.flatMap((line) => {
        const m = GAP_MARKER.exec(line);
        return m === null ? [] : [[Number(m[1]), Number(m[2])]];
      });
      expect(
        named,
        named.length === 0
          ? `raw lines ${prev.raw} and ${next.raw} are delivered with no gap marker ` +
              `between them, so the ${next.raw - prev.raw - 1} lines in between are omitted ` +
              `with no sign of it — raw ${prev.raw} and raw ${next.raw} read as contiguous`
          : `the hole between delivered raw lines ${prev.raw} and ${next.raw} must be ` +
              `named exactly once, as ${prev.raw + 1}-${next.raw - 1}`,
      ).toEqual([[prev.raw + 1, next.raw - 1]]);

      const interior = prev.raw > 0 && next.raw <= rawLines.length;
      if (interior) interiorGaps += 1;
    }

    // The sentinels make the leading and tail gaps checkable, but only an
    // INTERIOR hole — verbatim content on both sides — can be silently spliced.
    // This counts how many suppressions the walk above is able to catch.
    expect(
      interiorGaps,
      "fixture must deliver non-adjacent excerpts, or no suppression is observable",
    ).toBeGreaterThanOrEqual(2);
  });

  it("stores every chunk under line numbers that locate its text in the raw output", async () => {
    const raw = splicedCorpus();
    const rawLines = raw.split("\n");
    const chunkSetId = "cs-coords";

    const result = await recordAndFilterOverlayOutput({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      raw,
      sourceKind: "command",
      label: "pnpm test",
      mode: "balanced",
      storeRawOutput: true,
      includeFooter: true,
      intent: "parseConfig",
      newId: () => chunkSetId,
    });
    expect(result.decision).toBe("compressed");

    // The footer publishes the addressable range; an agent that fetches outside
    // it gets nothing, and content inside a chunk the footer never advertises is
    // unrecoverable however correctly it was stored.
    const advertised = /\(i = 0\.\.(\d+)\)/.exec(result.returnedText);
    const expectedCount = Math.ceil(rawLines.length / OVERLAY_CHUNK_LINES);
    expect(advertised?.[1], "footer must advertise every stored chunk").toBe(
      String(expectedCount - 1),
    );

    // Every chunk, not only the ones a marker points at: a marker resolves to a
    // chunk id through the published ~L-lines-each rule, so wrong numbers on an
    // unvisited chunk are what makes the NEXT marker resolve to the wrong place.
    for (let i = 0; i < expectedCount; i += 1) {
      const res = await fetchChunk({ storeRoot: store, chunkSetId, chunkId: String(i) });
      expect(res.ok, `chunk ${i} must exist`).toBe(true);
      if (!res.ok) continue;
      const startLine = i * OVERLAY_CHUNK_LINES + 1;
      const endLine = Math.min(startLine + OVERLAY_CHUNK_LINES - 1, rawLines.length);
      expect(
        [res.chunk.startLine, res.chunk.endLine],
        `chunk ${i} is the ${OVERLAY_CHUNK_LINES}-line slice the footer's rule resolves to`,
      ).toEqual([startLine, endLine]);
      expect(
        res.chunk.text,
        `chunk ${i} claims raw lines ${res.chunk.startLine}-${res.chunk.endLine}; its text ` +
          `must be exactly those ${res.chunk.endLine - res.chunk.startLine + 1} lines`,
      ).toBe(rawLines.slice(res.chunk.startLine - 1, res.chunk.endLine).join("\n"));
    }

    const past = await fetchChunk({
      storeRoot: store,
      chunkSetId,
      chunkId: String(expectedCount),
    });
    expect(past.ok, "the raw output must not extend past the last stored chunk").toBe(false);
  });
});
