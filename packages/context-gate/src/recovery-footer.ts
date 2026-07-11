// Matches the generic chunker default; the recovery footer's chunk wording
// mirrors this. Lives here (not record-output.ts) so record-output can
// import the footer builder without a cycle.
export const OVERLAY_CHUNK_LINES = 40;

// ~4 bytes/token, mirroring output-filter estimateTokens and
// @megasaver/stats tokensFromBytes. Local copy: one line is cheaper than a
// package dependency on stats.
function tokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}

// The harness can truncate a tool output BEFORE the PostToolUse hook sees it; the
// stored chunk is then incomplete and "Full output recoverable" would be a lie.
// Anchored near the END of the buffer (last 256 bytes) to keep false positives low:
// a mid-text mention of truncation is normal content, not a real cutoff.
const TRUNCATION_MARKER = /\[truncated\b|output truncated|<truncated\b/i;
const TRUNCATION_TAIL_BYTES = 256;
export function looksPreTruncated(raw: string): boolean {
  const tail = raw.length > TRUNCATION_TAIL_BYTES ? raw.slice(-TRUNCATION_TAIL_BYTES) : raw;
  return TRUNCATION_MARKER.test(tail);
}

export type RecoveryFooterInput = {
  rawBytes: number;
  returnedBytes: number;
  chunkSetId: string;
  chunkCount: number;
  rawLooksTruncated: boolean;
};

// Canonical recovery footer (F30): built INSIDE record-output so the
// persisted returnedBytes/bytesSaved count it. Wording is byte-identical to
// the pre-wave-5 hook footer so e2e fixtures shift minimally. Advertise
// chunk IDS, never a line->id formula: chunks index the REDACTED stored
// text, while the agent sees the original tool output's line numbers.
export function buildRecoveryFooter(input: RecoveryFooterInput): string {
  const rawTokens = tokensFromBytes(input.rawBytes);
  const returnedTokens = tokensFromBytes(input.returnedBytes);
  const tokenPct = rawTokens === 0 ? "0.0" : ((1 - returnedTokens / rawTokens) * 100).toFixed(1);
  const n = input.chunkCount;
  const L = OVERLAY_CHUNK_LINES;
  const expandCmd =
    n > 1
      ? `— stored in ${n} chunks of ~${L} lines each; fetch any with: mega output chunk "${input.chunkSetId}" "<i>" (i = 0..${n - 1})`
      : `— run: mega output chunk "${input.chunkSetId}" "0"`;
  const partialNoun = n > 1 ? "recovered chunks are" : "recovered chunk is";
  const recovery = input.rawLooksTruncated
    ? `NOTE: upstream output appears truncated, ${partialNoun} PARTIAL, not complete ${expandCmd} (or MCP proxy_expand_chunk if connected)`
    : `Full output recoverable ${expandCmd} (or MCP proxy_expand_chunk if connected)`;
  return `\n\n[Mega Saver: compressed ${input.rawBytes}→${input.returnedBytes} B (~${rawTokens}→${returnedTokens} tokens, ${tokenPct}%). ${recovery}.]`;
}
