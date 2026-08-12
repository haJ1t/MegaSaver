import {
  BOARD_DELTA_CHECK_INTERVAL_MS,
  BOARD_INJECT_MAX_TOKENS,
  formatBoardFacts,
  selectBoardDigest,
  selectFactsForInjection,
} from "@megasaver/mesh";

export { BOARD_DELTA_CHECK_INTERVAL_MS, BOARD_INJECT_MAX_TOKENS };

export function buildBoardDigestForSession(
  storeRoot: string,
  liveSessionId: string,
): string | undefined {
  try {
    if (typeof liveSessionId !== "string" || liveSessionId.trim().length === 0) return undefined;
    const { facts } = selectBoardDigest(storeRoot, liveSessionId);
    if (facts.length === 0) return undefined;
    const formatted = formatBoardFacts(facts);
    if (formatted === "") return undefined;
    return formatted;
  } catch {
    return undefined;
  }
}

export function buildBoardDeltaForSession(
  storeRoot: string,
  liveSessionId: string,
): string | undefined {
  try {
    if (typeof liveSessionId !== "string" || liveSessionId.trim().length === 0) return undefined;
    const { facts } = selectFactsForInjection(storeRoot, liveSessionId);
    if (facts.length === 0) return undefined;
    const formatted = formatBoardFacts(facts);
    if (formatted === "") return undefined;
    return formatted;
  } catch {
    return undefined;
  }
}
