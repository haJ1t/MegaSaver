---
"@megasaver/cli": patch
"@megasaver/llm-proxy": patch
"@megasaver/pro-analytics": patch
---

Address the independent code-reviewer and critic passes on the cache-advice
range. Every fix is behavior- or durability-hardening; the public CLI and
hook surfaces are unchanged.

- Durability (review P1): capsule state/suppression deletion, the GC sweep
  lock release, and future-timestamp normalization now fsync the parent
  directory after the unlink/futimes, so a deleted entry or normalized node
  is durable across a crash — matching the fair-GC spec §2.2 promise.
- Queue liveness (review P1): the off-hook maintainer now compacts the
  append-only v3 work log under the no-wait queue lock, dropping fully
  consumed bytes and rewriting control offsets via a durable
  new-file + fsync + rename + parent-directory fsync. Without compaction the
  1 MiB log cap eventually silenced new enrollments permanently.
- Output-route gate (critic): the default-store gate compares canonical real
  paths, so a symlinked or relatively-spelled path to the default store is
  correctly treated as the same store instead of suppressing advice.
- Composition integrity (critic): usage-event token counts are capped far
  below 2**53 at the schema boundary, and `cacheComposition` reports an
  `overrange` status with null shares rather than a corrupted 0%/100% when a
  sum loses float64 integer precision.

The cache-advice GC spec §2.1 records the accepted single-JSONL work log +
control-offset design (head/inflight replay is the WAL) in place of the
originally-specified `transition.json`, and the output-route grammar's
SAFE_WORD is pinned to its exact implemented ASCII-safe class. No token or
cost-savings claim is made.
