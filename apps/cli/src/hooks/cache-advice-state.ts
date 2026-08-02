export const BATCH_WINDOW_MS = 60_000;

const MAX_OFFERED_DIRECTORIES = 64;
const MAX_RECENT_CALLS = 128;

export type CacheAdviceCall = {
  tool: "Read" | "Grep" | "Glob";
  directoryKey: string;
  at: number;
};

export type CacheAdviceState = {
  version: 2;
  offeredDirectoryKeys: string[];
  recent: CacheAdviceCall[];
};

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
    return { state: { version: 2, offeredDirectoryKeys, recent }, advise: false };
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
    state: { version: 2, offeredDirectoryKeys: nextOfferedDirectoryKeys, recent: nextRecent },
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
