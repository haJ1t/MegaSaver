// Fake saver outputs that honour the REAL saver's per-call contract, so tests
// exercising prepareArms are not accidentally testing a transform production
// could never produce.
//
// The contract is enforced by the saver itself, not by convention:
//   - apps/cli/src/hooks/saver.ts passes includeFooter:true + storeRawOutput:true
//     and returns updatedToolOutput ONLY for a "compressed" decision, so
//     record-output.ts appends buildRecoveryFooter to every applied output;
//   - record-output.ts's net-negative guard degrades to passthrough whenever the
//     replacement (footer included) is >= the raw, so an applied output is
//     strictly smaller.
//
// Not imported from @megasaver/context-gate on purpose: bench-replay must be
// able to detect a saver that stopped honouring the contract, which it cannot do
// if it derives its expectation from the same code.

// ASCII filler only, so byte length equals character count and callers can hit an
// exact target size.
export function rawOutput(seed: number | string, bytes: number): string {
  const head = `RAW-${seed}-`;
  if (bytes < head.length)
    throw new Error(`rawOutput: ${bytes} B is too small for the ${head} tag`);
  return head + "r".repeat(bytes - head.length);
}

function footer(rawBytes: number, returnedBytes: number): string {
  const pct = rawBytes === 0 ? "0.0" : ((1 - returnedBytes / rawBytes) * 100).toFixed(1);
  return `\n\n[Mega Saver: compressed ${rawBytes}→${returnedBytes} B (~${Math.ceil(rawBytes / 4)}→${Math.ceil(returnedBytes / 4)} tokens, ${pct}%). Full output recoverable — run: mega output chunk "fixture" "0".]`;
}

// An applied output of EXACTLY `targetBytes`, carrying the recovery footer.
export function savedOutput(rawBytes: number, targetBytes: number): string {
  const tail = footer(rawBytes, targetBytes);
  const fillerBytes = targetBytes - Buffer.byteLength(tail, "utf8");
  if (fillerBytes < 0) {
    throw new Error(
      `savedOutput: ${targetBytes} B cannot hold the ${Buffer.byteLength(tail, "utf8")} B recovery footer`,
    );
  }
  return "s".repeat(fillerBytes) + tail;
}
