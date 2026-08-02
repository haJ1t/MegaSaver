export const BATCH_WINDOW_MS = 60_000;

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
  const matchingPriorCalls = liveRecent.filter(
    (recentCall) => recentCall.directory === call.directory,
  );
  const advise =
    matchingPriorCalls.length === 1 &&
    !state.offeredDirectories.includes(call.directory);
  const recent = keepTwoCallsPerDirectory([...liveRecent, call]);
  const offeredDirectories = advise
    ? [...state.offeredDirectories, call.directory].slice(-64)
    : state.offeredDirectories.slice(-64);

  return { state: { offeredDirectories, recent }, advise };
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
