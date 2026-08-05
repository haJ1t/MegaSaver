import { createHash } from "node:crypto";

export const BATCH_WINDOW_MS = 60_000;

const MAX_OFFERED_DIRECTORIES = 64;
const MAX_RECENT_CALLS = 128;

export type CacheAdviceCall = {
  tool: "Read" | "Grep" | "Glob" | "Bash";
  directoryKey: string;
  at: number;
};

export type OutputRouteFamilyTag = "grep" | "find";

export const CACHE_ADVICE_STATE_V3_MARKER = "megasaver:cache-advice:state:v3\0";

// Output-route calls carry no real directory: the family tag is the only
// fact worth remembering, and a content-free HMAC keeps the call-shape
// uniform without persisting anything about the command.
export function outputRouteCallKey(family: OutputRouteFamilyTag): string {
  return createHash("sha256")
    .update(CACHE_ADVICE_STATE_V3_MARKER, "utf8")
    .update(family, "utf8")
    .digest("hex");
}

export type CacheAdviceState = {
  version: 2 | 3;
  offeredDirectoryKeys: string[];
  offeredOutputRouteFamilies?: OutputRouteFamilyTag[];
  recent: CacheAdviceCall[];
};

// State evolution (§4): a valid v2 state gains an empty family list and is
// durably written as v3. Malformed/v1/future state never reaches this
// function — the store's schema gate suppresses it untouched.
export function evolveCacheAdviceState(state: CacheAdviceState): CacheAdviceState {
  if (state.version === 3) return state;
  return { ...state, version: 3, offeredOutputRouteFamilies: [] };
}

// Once-per-family-per-session offer. The family is consumed only by the
// caller after the durable write succeeds.
export function recordOutputRouteOffer(
  state: CacheAdviceState,
  family: OutputRouteFamilyTag,
  at: number,
): { state: CacheAdviceState; advise: boolean } {
  const offered = state.offeredOutputRouteFamilies ?? [];
  const advise = !offered.includes(family);
  const call: CacheAdviceCall = { tool: "Bash", directoryKey: outputRouteCallKey(family), at };
  const next: CacheAdviceState = {
    ...state,
    version: 3,
    offeredOutputRouteFamilies: advise ? [...offered, family] : offered,
    recent: [...state.recent, call].slice(-MAX_RECENT_CALLS),
  };
  return { state: next, advise };
}

export function recordBatchCall(
  state: CacheAdviceState,
  call: CacheAdviceCall,
): { state: CacheAdviceState; advise: boolean } {
  if (call.directoryKey === "") {
    throw new Error("directory key must not be empty");
  }

  const liveRecent = state.recent.filter(
    (recentCall) => recentCall.at >= call.at - BATCH_WINDOW_MS,
  );
  const recent = keepTwoCallsPerDirectory(liveRecent).slice(-MAX_RECENT_CALLS);
  const offeredDirectoryKeys = state.offeredDirectoryKeys.slice(-MAX_OFFERED_DIRECTORIES);

  if (recent.length === MAX_RECENT_CALLS) {
    return { state: { ...state, offeredDirectoryKeys, recent }, advise: false };
  }

  const matchingPriorCalls = recent.filter(
    (recentCall) => recentCall.directoryKey === call.directoryKey,
  );
  const advise =
    matchingPriorCalls.length === 1 &&
    !offeredDirectoryKeys.includes(call.directoryKey) &&
    offeredDirectoryKeys.length < MAX_OFFERED_DIRECTORIES;
  const nextRecent = keepTwoCallsPerDirectory([...recent, call]);
  const nextOfferedDirectoryKeys = advise
    ? [...offeredDirectoryKeys, call.directoryKey]
    : offeredDirectoryKeys;

  return {
    state: { ...state, offeredDirectoryKeys: nextOfferedDirectoryKeys, recent: nextRecent },
    advise,
  };
}

function keepTwoCallsPerDirectory(calls: CacheAdviceCall[]): CacheAdviceCall[] {
  const counts = new Map<string, number>();
  const mostRecentFirst: CacheAdviceCall[] = [];

  for (const call of calls.toReversed()) {
    const count = counts.get(call.directoryKey) ?? 0;
    if (count < 2) {
      counts.set(call.directoryKey, count + 1);
      mostRecentFirst.push(call);
    }
  }

  return mostRecentFirst.toReversed();
}
