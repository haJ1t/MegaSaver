import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalize } from "@megasaver/output-filter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchChunk } from "../src/fetch-chunk.js";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";
import { OVERLAY_CHUNK_LINES } from "../src/recovery-footer.js";

// The delivered gap markers and the stored recovery chunks must inhabit ONE
// coordinate system. Marker numbers are derived from `normalize()`d text
// (output-filter types.ts), and `normalize()` is not line-count-preserving:
// a bare CR becomes a newline, so every progress-bar redraw ADDS a line to
// marker space. When the chunkers index un-normalized text the two spaces
// drift and the footer advertises chunk ids that either do not exist or hold
// unrelated content.
//
// Bare CR is not exotic here: npm, pip, curl, docker and cargo all draw
// progress bars with it, and the highest-volume entry point of this pipeline
// is a Bash PostToolUse hook.

const WK = "0123456789abcdef";
const LSID = "44444444-4444-4444-8444-444444444444";

// Progress-bar redraws interleaved with distinct, individually-identifiable
// log lines. The distinct lines keep ranking generic (no specialized
// compressor synthesises text, so the markers stay addressable) and the CR
// runs are what pushes marker space past chunk space.
function progressCorpus(): string {
  const lines: string[] = [];
  for (let i = 0; i < 400; i += 1) {
    lines.push(`downloading pkg-${i} 40%\rdownloading pkg-${i} 80%\rdownloading pkg-${i} 100%`);
    lines.push(`resolved pkg-${i} from /repo/node_modules/pkg-${i}/entry-${i}.ts ok`);
  }
  return lines.join("\n");
}

// Every line number an agent could act on: each `… [lines N-M omitted]` names
// M as reachable, so M is the number that must resolve to a stored chunk.
function markerLines(delivered: string): number[] {
  const out: number[] = [];
  for (const m of delivered.matchAll(/… \[lines (\d+)-(\d+) omitted\]/g)) {
    out.push(Number(m[2]));
  }
  return out;
}

// The footer is the interface the agent reads, so the advertised chunk count
// comes from the footer text — not from the result object.
function advertisedChunkCount(delivered: string): number {
  const many = delivered.match(/stored in (\d+) chunks of ~(\d+) lines each/);
  if (many !== null) return Number(many[1]);
  return delivered.includes("mega output chunk") ? 1 : 0;
}

// Everything the footer instructs the agent to do, read back out of the footer
// itself. An agent cannot enumerate the store empirically — it can only issue
// the command it was handed — so the id and the range are as load-bearing as
// the stored bytes, and neither may be taken from the result object here.
function advertisedRecovery(delivered: string): { chunkSetId: string; lastIndex: number } {
  const m = /mega output chunk "([^"]+)" "<i>" \(i = 0\.\.(\d+)\)/.exec(delivered);
  if (m === null) throw new Error("delivered text carried no multi-chunk recovery instruction");
  const [, id, last] = m;
  if (id === undefined || last === undefined) throw new Error("recovery instruction incomplete");
  return { chunkSetId: id, lastIndex: Number(last) };
}

async function reachableEndLine(storeRoot: string, chunkSetId: string): Promise<number> {
  let last = 0;
  for (let i = 0; ; i += 1) {
    const res = await fetchChunk({ storeRoot, chunkSetId, chunkId: String(i) });
    if (!res.ok) break;
    last = Math.max(last, res.chunk.endLine);
  }
  return last;
}

let store: string;

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "cg-skew-store-"));
});
afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

function record(chunkSetId: string, storeRawOutput = true) {
  return recordAndFilterOverlayOutput({
    storeRoot: store,
    workspaceKey: WK,
    liveSessionId: LSID,
    raw: progressCorpus(),
    sourceKind: "command",
    label: "npm install",
    mode: "balanced",
    storeRawOutput,
    includeFooter: true,
    newId: () => chunkSetId,
  });
}

describe("marker space and chunk space agree on bare-CR output", () => {
  it("never names a line the stored chunks cannot reach", async () => {
    const chunkSetId = "cs-skew-balanced";
    const result = await record(chunkSetId);

    expect(result.decision).toBe("compressed");

    const delivered = result.returnedText;
    const named = markerLines(delivered);
    // Guards against a vacuous pass: an unaddressable result emits a countless
    // marker and would satisfy every bound below with zero numbers.
    expect(named.length, "delivered text carried no numbered gap marker").toBeGreaterThan(0);

    const maxNamed = Math.max(...named);
    const storedEnd = await reachableEndLine(store, chunkSetId);
    expect(
      maxNamed,
      `marker space ${maxNamed} vs chunk space ${storedEnd} (skew ${maxNamed - storedEnd})`,
    ).toBeLessThanOrEqual(storedEnd);

    const advertised = advertisedChunkCount(delivered);
    expect(
      maxNamed,
      `footer advertises ${advertised} chunks of ~${OVERLAY_CHUNK_LINES} lines, covering ${
        advertised * OVERLAY_CHUNK_LINES
      } lines, but a marker names line ${maxNamed}`,
    ).toBeLessThanOrEqual(advertised * OVERLAY_CHUNK_LINES);
  });

  // The footer is the ONLY recovery instruction the model gets. It cannot probe
  // the store, so "i = 0..N-1" is not a hint about the store — for the agent it
  // IS the store. A count that undershoots buries evidence behind ids nobody is
  // told to ask for; one that overshoots sends the agent after chunks that do
  // not exist. Both are invisible to any test that enumerates ids empirically.
  it("advertises exactly the chunk ids that resolve, and no others", async () => {
    const result = await record("cs-skew-footer");
    expect(result.decision).toBe("compressed");

    const { chunkSetId, lastIndex } = advertisedRecovery(result.returnedText);
    // The footer states its size twice — "N chunks" and "i = 0..N-1" — and the
    // agent may act on either.
    expect(lastIndex + 1).toBe(advertisedChunkCount(result.returnedText));
    // Guards against a vacuous pass: the single-chunk footer is a different
    // sentence, and a one-chunk set would make the range check trivial.
    expect(lastIndex).toBeGreaterThan(0);

    for (let i = 0; i <= lastIndex; i += 1) {
      const res = await fetchChunk({ storeRoot: store, chunkSetId, chunkId: String(i) });
      expect(res.ok, `footer advertises i = 0..${lastIndex} but chunk ${i} does not resolve`).toBe(
        true,
      );
    }

    const past = await fetchChunk({ storeRoot: store, chunkSetId, chunkId: String(lastIndex + 1) });
    expect(
      past.ok,
      `footer advertises i = 0..${lastIndex}, but chunk ${lastIndex + 1} also resolves — stored evidence the agent is never told to fetch`,
    ).toBe(false);
  });

  // A chunk id is an address. Its startLine/endLine are what let an agent
  // holding "… [lines 146-902 omitted]" pick one, so storing the right text
  // under the wrong numbers is the same failure as storing the wrong text.
  it("stores chunks whose line numbers address the delivered coordinate space", async () => {
    const chunkSetId = "cs-skew-lines";
    const result = await record(chunkSetId);
    expect(result.decision).toBe("compressed");

    // The oracle re-derives the SPACE (normalize, which is what the marker
    // numbers are counted in) but never the NUMBERING — chunkByLines /
    // recoverableChunks are what is under test. Redaction is the identity on
    // this corpus; were that to stop holding, the text equality below breaks
    // rather than hides it.
    const lines = normalize(progressCorpus()).split("\n");

    let expectedStart = 1;
    let fetched = 0;
    // Bounded: an unbounded walk turns a fetch that always resolves into a hang
    // instead of a failure.
    for (let i = 0; i < 200; i += 1) {
      const res = await fetchChunk({ storeRoot: store, chunkSetId, chunkId: String(i) });
      if (!res.ok) break;
      fetched += 1;
      expect(res.chunk.startLine, `chunk ${i} should address line ${expectedStart} onward`).toBe(
        expectedStart,
      );
      expect(
        lines.slice(res.chunk.startLine - 1, res.chunk.endLine).join("\n"),
        `chunk ${i} claims lines ${res.chunk.startLine}-${res.chunk.endLine}, which hold other text`,
      ).toBe(res.chunk.text);
      expectedStart = res.chunk.endLine + 1;
    }

    expect(fetched).toBeGreaterThan(1);
    expect(expectedStart - 1, "stored addresses do not partition normalized space").toBe(
      lines.length,
    );
  });

  // storeRawOutput=false is lossy AND permanent: the delivered text is all the
  // agent will ever have. Advertising recovery there would be a lie no fetch
  // can repair, so the claim must be absent, not merely broken.
  it("advertises no recovery at all when raw storage is off", async () => {
    const chunkSetId = "cs-skew-nostore";
    const result = await record(chunkSetId, false);

    // Guards against a vacuous pass: a passthrough carries no footer for
    // reasons that have nothing to do with the storage gate.
    expect(result.decision).toBe("compressed");
    expect(result.chunkSetId).toBeUndefined();
    expect(result.returnedText).not.toContain("mega output chunk");
    // "recover", not "recoverable": the delivered text has more than one way to
    // promise recovery ("Full output recoverable", "recovered chunks are",
    // "recover any part with the chunk ids below") and none of them may appear.
    expect(result.returnedText).not.toContain("recover");

    // `newId` is pinned, so a gate that persisted anyway wrote the set here.
    const probe = await fetchChunk({ storeRoot: store, chunkSetId, chunkId: "0" });
    expect(probe.ok).toBe(false);
  });
});
