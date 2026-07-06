import { INPUT_PRICE_PER_MTOK_USD, type TokenSaverEvent, tokensFromBytes } from "@megasaver/stats";

export type WasteBy = "source" | "label";

export interface WasteRow {
  key: string;
  events: number;
  rawBytes: number;
  returnedBytes: number;
  bytesSaved: number;
  tokensReturned: number;
  tokensSaved: number;
  dollarsReturned: number;
  dollarsSaved: number;
  savingRatio: number;
  returnedShare: number;
}

// Same flat per-MTok input price the free headline + module 1 use.
function dollarsFromTokens(tokens: number): number {
  return (tokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD;
}

type Acc = { rawBytes: number; returnedBytes: number; bytesSaved: number; events: number };

export function computeWasteBreakdown(
  events: readonly TokenSaverEvent[],
  opts: { by: WasteBy },
): WasteRow[] {
  const keyOf = opts.by === "label" ? (e: TokenSaverEvent) => e.label : (e: TokenSaverEvent) => e.sourceKind;
  const byKey = new Map<string, Acc>();
  let totalReturned = 0;
  for (const e of events) {
    const k = keyOf(e);
    const acc = byKey.get(k) ?? { rawBytes: 0, returnedBytes: 0, bytesSaved: 0, events: 0 };
    acc.rawBytes += e.rawBytes;
    acc.returnedBytes += e.returnedBytes;
    acc.bytesSaved += e.bytesSaved;
    acc.events += 1;
    byKey.set(k, acc);
    totalReturned += e.returnedBytes;
  }
  return [...byKey.entries()]
    .map(([key, a]) => {
      const tokensReturned = tokensFromBytes(a.returnedBytes);
      const tokensSaved = tokensFromBytes(a.bytesSaved);
      return {
        key,
        events: a.events,
        rawBytes: a.rawBytes,
        returnedBytes: a.returnedBytes,
        bytesSaved: a.bytesSaved,
        tokensReturned,
        tokensSaved,
        dollarsReturned: dollarsFromTokens(tokensReturned),
        dollarsSaved: dollarsFromTokens(tokensSaved),
        savingRatio: a.rawBytes === 0 ? 0 : a.bytesSaved / a.rawBytes,
        returnedShare: totalReturned === 0 ? 0 : a.returnedBytes / totalReturned,
      };
    })
    .sort((x, y) => y.returnedBytes - x.returnedBytes || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}
