---
"@megasaver/stats": minor
---

The savings headline prices the signed NET (S4-1). `SavingsHeadlineTotals`
accepts an optional `deltaBytesTotal` (gross minus expansion debits);
`computeSavingsHeadline` prices that net — clamped at zero — instead of the
gross `bytesSavedTotal`, and `SavingsHeadline` gains `grossTokensSaved` and
`tokensRefetched` so surfaces can render "X saved − Y re-fetched = Z net"
exactly. Absent `deltaBytesTotal` falls back to gross (legacy callers,
pre-B1 stores). `savingsHeadlineFromTokens` reports gross == net with zero
refetch — a bare token count carries no expansion split. The stats event
schema is unchanged. The GUI overview and workspace strip now show the net
as the primary figure with the gross breakdown secondary.
