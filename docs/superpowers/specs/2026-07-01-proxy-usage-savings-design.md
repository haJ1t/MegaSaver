---
title: Proxy-fused "% of total Claude usage saved" metric
risk: medium
status: approved
created: 2026-07-01
---

# Proxy usage savings (`mega audit usage`)

## Problem

`mega audit honest` reports token reduction over the *mediated tool-output* slice
only (saver_hook events). Users want savings expressed against their **real total
Claude usage**. The honest-metrics `sessionEvents`/`proxy` path was built for a
context-*compressing* proxy (raw→returned reductions); today's proxy is
**metering-only** (`usage.jsonl` = token counts, no reduction), so feeding it into
that path is semantically wrong (double-counts, mixes bytes/tokens). This is a
separate, purpose-built read-only metric.

## Metric

- **Numerator** `saved` = `tokensFromBytes` of Σ `bytesSaved` over this
  workspace's overlay **event** logs, **windowed** to `createdAt ≥ earliest proxy
  usage ts** (`sumBytesSavedSince`). Windowing is load-bearing: without it an
  all-time savings total divided by a few recent proxy calls yields a meaningless
  90%+. byte/4 model; passthrough events save 0 bytes so contribute nothing.
- **Real usage** from `listProxyUsage` (all recorded `usage.jsonl`): sum of
  `inputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `outputTokens`.
- `newContext = inputTokens + cacheCreationTokens` (context written once).
- `totalContext = newContext + cacheReadTokens` (adds cached re-reads).
- Shares add `saved` back to the *actual* processed tokens (which already reflect
  the compressed outputs), so each tool output is counted once at full size — **no
  double counting**:
  - `savedShareOfNewContext   = saved / (saved + newContext)`
  - `savedShareOfTotalContext = saved / (saved + totalContext)`

Both are shown (user choice), plus raw numbers.

## Reliability guard (fail-closed)

`saved > newContext` is the fingerprint of an untrustworthy ratio — the proxy
captured only part of the workload, or a stray old `usage.jsonl` row skewed the
window back. In that state the % saturates toward 100% and reads as "saves 97% of
my bill". So `proxyUsageSavings` sets `reliable = newContext > 0 && saved <=
newContext`, and the renderer **suppresses both percentages** (showing raw counts
+ a "route all traffic through `mega proxy`" hint) when it is false. A confident %
on partial coverage is worse than no %.

## Honest caveats (surfaced in output)

- One-shot estimate: `saved` is removed once, but a saved token also avoids
  cache-*reads* on every later turn, so the true impact ≥ these figures (floor).
- `usage.jsonl` is not session-scoped (no session id, only `ts`) — the denominator
  is **all recorded proxy traffic**, the numerator is **all tool compression in
  this workspace**. Comparable for a single-user/single-proxy setup; labeled.
- Byte/4 token estimate on the numerator; real token counts on the denominator.

## Non-goals

- Not changing `audit honest` (stays session-scoped byte-based).
- Not per-session correlation of proxy usage (future; needs session id in usage).
