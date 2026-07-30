import type { PreparedArms } from "./transform.js";
import type { RecordedRequest } from "./types.js";

// The A4 gate wants NET cost reduction. The replay measures the input-side
// saving; it is structurally blind to the other first-order term — the agent
// pulling dropped content back with `mega output chunk` / proxy_expand_chunk.
// A fixed-trajectory replay cannot produce those turns, so that term is not
// measurable here and never will be.
//
// It is BOUNDABLE, though, and that is enough to decide with. Both the saving
// and the cost of an expansion are the same physical quantity — bytes sent —
// so they can be compared without a token estimate or a rate card:
//
//   saving   = SUM over requests of (baseline bytes - megasaver bytes)
//   cost(i)  = bytes output i can give back  x  requests it would ride in
//
// The unit is the BYTE-APPEARANCE. The Messages API resends the whole history
// every turn, so a byte sitting in the transcript at request k is sent again in
// every request after it; its cost is proportional to how many requests it
// appears in, not to its size alone. Counting plain bytes would price an
// expansion in the last turn the same as one in the first, which is wrong by
// the length of the session.
//
// Result: "net cheaper as long as fewer than R* of compressed outputs get
// expanded." A boundary, honestly derived, instead of a number no instrument in
// this repo can produce.

export type ExpandableOutput = {
  toolUseId: string;
  // What compression removed. Reported because it is the intuitive figure, but
  // NOT what an expansion costs — see `costBytes`.
  recoverableBytes: number;
  // The uncompressed content, which is what the chunk store hands back.
  rawBytes: number;
  // 1-based index of the first request the compressed output appears in.
  firstRequest: number;
  // Requests the recovered bytes would ride in, assuming the agent expands
  // immediately after first seeing the compressed result. Expanding LATER is
  // cheaper, so this is the pessimistic reading.
  ridesInRequests: number;
  // rawBytes x ridesInRequests — NOT recoverableBytes x ridesInRequests.
  //
  // Expanding does not un-compress in place. `mega output chunk` appends the
  // stored chunks as NEW tool_results while the compressed summary stays in
  // history, so a fully expanded output leaves the session carrying BOTH. The
  // bytes that re-enter are the raw content, not the delta:
  //
  //   baseline               r(N-j+1)
  //   megasaver, expanded    c(N-j+1) + r(N-j)
  //   affordable  <=>  (N-j+1)(r-c) >= r(N-j)
  //
  // Charging only the delta understated this by c(N-j) and made every expansion
  // look affordable by construction — the arithmetic collapses to "saving beats
  // cost" for all inputs, so R* was pinned at 100% no matter what was measured.
  costBytes: number;
};

export type RecoveryBreakeven = {
  savedBytes: number;
  expandable: readonly ExpandableOutput[];
  breakevenCount: number;
  breakevenRate: number;
};

function bodyBytes(body: RecordedRequest): number {
  return Buffer.byteLength(JSON.stringify(body), "utf8");
}

// tool_use_id -> bytes of its tool_result content, per request. Content is
// either a string or a block array; JSON length covers both without special
// casing, and the two arms are measured the same way so the shape cancels.
function toolResultBytes(body: RecordedRequest): Map<string, number> {
  const found = new Map<string, number>();
  for (const message of body.messages) {
    if (typeof message !== "object" || message === null) continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as { type?: unknown; tool_use_id?: unknown; content?: unknown };
      if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") continue;
      found.set(b.tool_use_id, Buffer.byteLength(JSON.stringify(b.content ?? ""), "utf8"));
    }
  }
  return found;
}

export function recoveryBreakeven(arms: PreparedArms): RecoveryBreakeven {
  const { baseline, megasaver } = arms;
  if (baseline.length !== megasaver.length) {
    throw new Error(
      `recoveryBreakeven: the two arms must have the same number of requests to be compared request-by-request, but baseline has ${baseline.length} and megasaver has ${megasaver.length}`,
    );
  }
  const total = baseline.length;

  let savedBytes = 0;
  for (const [i, base] of baseline.entries()) {
    savedBytes += bodyBytes(base) - bodyBytes(megasaver[i] as RecordedRequest);
  }

  // First appearance wins: a tool_result's bytes are immutable once written
  // (verified across both recorded corpora — 26/26 recurring ids byte-stable),
  // so the first sighting fixes both the recoverable size and the position.
  const expandable: ExpandableOutput[] = [];
  const seen = new Set<string>();
  for (const [i, base] of baseline.entries()) {
    const rawSizes = toolResultBytes(base);
    const compressedSizes = toolResultBytes(megasaver[i] as RecordedRequest);
    for (const [id, rawBytes] of rawSizes) {
      if (seen.has(id)) continue;
      seen.add(id);
      const compressed = compressedSizes.get(id);
      if (compressed === undefined) continue;
      const recoverableBytes = rawBytes - compressed;
      if (recoverableBytes <= 0) continue; // passthrough, or the saver inflated it
      const firstRequest = i + 1;
      const ridesInRequests = total - firstRequest;
      expandable.push({
        toolUseId: id,
        recoverableBytes,
        rawBytes,
        firstRequest,
        ridesInRequests,
        costBytes: rawBytes * ridesInRequests,
      });
    }
  }

  // Costliest first: the agent is assumed to expand the worst-case outputs, so
  // the reported rate is a floor the real recovery rate must beat, not an
  // average it might straddle.
  expandable.sort((a, b) => b.costBytes - a.costBytes);

  let spent = 0;
  let breakevenCount = 0;
  for (const item of expandable) {
    if (spent + item.costBytes > savedBytes) break;
    spent += item.costBytes;
    breakevenCount += 1;
  }
  // Nothing was compressed, so there is no expansion to price and no decision to
  // make. NaN rather than 0: a rate of zero is a real and damning answer — the
  // saving could not buy back a single expansion — and printing it for "the
  // saver never fired" would report a failure that did not happen. Same posture
  // as `pooledCostRatio`: never hand back a number the data cannot stand behind.
  if (expandable.length === 0) {
    return { savedBytes, expandable, breakevenCount: 0, breakevenRate: Number.NaN };
  }
  // Compression DID happen but bought nothing back. Zero is the honest rate.
  if (savedBytes <= 0) return { savedBytes, expandable, breakevenCount: 0, breakevenRate: 0 };

  return {
    savedBytes,
    expandable,
    breakevenCount,
    breakevenRate: breakevenCount / expandable.length,
  };
}
