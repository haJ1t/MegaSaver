---
"@megasaver/stats": minor
---

The savings headline prices the signed NET (S4-1). `SavingsHeadlineTotals`
accepts an optional `deltaBytesTotal` (gross minus expansion debits);
`computeSavingsHeadline` prices that net — clamped at zero — instead of the
gross `bytesSavedTotal`, and `SavingsHeadline` gains `grossTokensSaved`,
`netTokensSigned` (the UNCLAMPED signed net), and `tokensRefetched`
(derived from the unclamped delta, so it can exceed gross) so surfaces can
render "X saved − Y re-fetched + overhead = Z net" exactly, including
windows that lost more than they saved. The negative-delta pool includes
envelope overhead, not only refetches — hence the label. Absent
`deltaBytesTotal` falls back to gross (legacy callers, pre-B1 stores).
`savingsHeadlineFromTokens` reports gross == net with zero refetch — a bare
token count carries no expansion split. The stats event schema is
unchanged. The GUI overview and workspace strip now show the net as the
primary figure with the gross breakdown secondary.
