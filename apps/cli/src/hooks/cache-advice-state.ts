export const BATCH_WINDOW_MS = 60_000;

const MAX_OFFERED_DIRECTORIES = 64;
const MAX_RECENT_CALLS = 128;

export type AdviceCall = {
  tool: "Read" | "Grep" | "Glob";
  directory: string;
  at: number;
};

export type BatchAdviceState = {
  offeredDirectories: string[];
  recent: AdviceCall[];
};

export function recordBatchCall(
  state: BatchAdviceState,
  call: AdviceCall,
): { state: BatchAdviceState; advise: boolean } {
  if (call.directory === "") {
    throw new Error("directory must not be empty");
  }

  const liveRecent = state.recent.filter(
    (recentCall) => recentCall.at >= call.at - BATCH_WINDOW_MS,
  );
  const recent = keepTwoCallsPerDirectory(liveRecent).slice(-MAX_RECENT_CALLS);
  const offeredDirectories = state.offeredDirectories.slice(-MAX_OFFERED_DIRECTORIES);

  if (recent.length === MAX_RECENT_CALLS) {
    return { state: { offeredDirectories, recent }, advise: false };
  }

  const matchingPriorCalls = recent.filter((recentCall) => recentCall.directory === call.directory);
  const advise =
    matchingPriorCalls.length === 1 &&
    !offeredDirectories.includes(call.directory) &&
    offeredDirectories.length < MAX_OFFERED_DIRECTORIES;
  const nextRecent = keepTwoCallsPerDirectory([...recent, call]);
  const nextOfferedDirectories = advise
    ? [...offeredDirectories, call.directory]
    : offeredDirectories;

  return {
    state: { offeredDirectories: nextOfferedDirectories, recent: nextRecent },
    advise,
  };
}

function keepTwoCallsPerDirectory(calls: AdviceCall[]): AdviceCall[] {
  const counts = new Map<string, number>();
  const mostRecentFirst: AdviceCall[] = [];

  for (const call of calls.toReversed()) {
    const count = counts.get(call.directory) ?? 0;
    if (count < 2) {
      counts.set(call.directory, count + 1);
      mostRecentFirst.push(call);
    }
  }

  return mostRecentFirst.toReversed();
}
