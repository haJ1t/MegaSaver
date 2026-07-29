import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("marker space and chunk space agree on bare-CR output", () => {
  it("never names a line the stored chunks cannot reach", async () => {
    const raw = progressCorpus();
    const chunkSetId = "cs-skew-balanced";
    const result = await recordAndFilterOverlayOutput({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      raw,
      sourceKind: "command",
      label: "npm install",
      mode: "balanced",
      storeRawOutput: true,
      includeFooter: true,
      newId: () => chunkSetId,
    });

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
});
